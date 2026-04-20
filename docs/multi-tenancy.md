---
estado: 🔴 Pendiente
version: v0.1
ultima_actualizacion: 2026-04-13
---

# Nexus — Multi-tenancy

## Modelo: Shared Database con `tenant_id`

Nexus usa un modelo de multi-tenancy **shared database, shared schema**: todos los tenants comparten la misma base de datos PostgreSQL y las mismas tablas. Cada fila tiene una columna `tenant_id` (UUID, FK a `tenant`) que identifica a qué negocio pertenece.

El aislamiento de datos se garantiza con **Row Level Security (RLS)** de PostgreSQL: las policies verifican que el `tenant_id` de cada fila coincida con el `tenant_id` del JWT del usuario autenticado. Esto ocurre a nivel de base de datos, independientemente de la aplicación.

### Ventajas

| Ventaja | Detalle |
|---|---|
| **Un solo deploy** | Un único codebase, una única instancia de la app, una única base de datos. Simplifica enormemente el deploy, CI/CD y las migraciones |
| **Migraciones simples** | Un `ALTER TABLE` o un `CREATE INDEX` afecta a todos los tenants de una vez. No hay que iterar sobre N bases de datos |
| **Onboarding instantáneo** | Crear un nuevo tenant es un `INSERT` en la tabla `tenant` + un `INSERT` en `modulo_config`. No hay que provisionar infraestructura |
| **Costo bajo en tenants chicos** | Un kiosco con 50 productos no necesita su propia base de datos. El overhead por tenant es mínimo |
| **Queries cross-tenant (admin)** | Si en el futuro se necesita un panel de super-admin para métricas globales, es un `SELECT` sin `WHERE tenant_id` (con un rol de servicio) |

### Trade-offs

| Trade-off | Detalle | Mitigación |
|---|---|---|
| **Riesgo de fuga de datos** | Si una query olvida el filtro por `tenant_id`, un tenant podría ver datos de otro | RLS a nivel de base de datos. No depende de la app. Tests de aislamiento automatizados |
| **Noisy neighbor** | Un tenant con muchos datos puede impactar la performance de los demás | Índices optimizados con `tenant_id` como primer campo. Monitoreo. Posibilidad de upgrade de tier en Supabase |
| **Complejidad de backup selectivo** | No se puede hacer backup/restore de un solo tenant fácilmente | Para v0.1-v2.0 no es necesario. Si se necesita, se puede exportar con `COPY ... WHERE tenant_id = X` |
| **Escalabilidad vertical** | Hay un techo en cuántos tenants puede manejar una sola DB | Supabase permite upgrade de tier. Si se supera, migrar a schema-per-tenant o sharding por tenant_id |

---

## `custom_access_token_hook` — Inyección de `tenant_id` en el JWT

Esta función se ejecuta automáticamente en Supabase cada vez que se genera un JWT (login, refresh). Busca el `tenant_id` del usuario en la tabla `usuario` y lo agrega como claim al JWT.

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Busca el tenant_id del usuario que está haciendo login
  SELECT tenant_id INTO v_tenant_id
  FROM public.usuario
  WHERE id = (event->>'user_id')::UUID;

  -- Si el usuario tiene tenant asignado, lo agrega al JWT
  IF v_tenant_id IS NOT NULL THEN
    event := jsonb_set(
      event,
      '{claims,tenant_id}',
      to_jsonb(v_tenant_id::TEXT)
    );
  END IF;

  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### Cómo funciona paso a paso

1. Un usuario hace login (email/password o magic link).
2. Supabase Auth genera un JWT con claims default (`sub`, `email`, `role`, etc.).
3. Antes de firmar el JWT, Supabase invoca `custom_access_token_hook` pasando el JWT como JSONB en el parámetro `event`.
4. La función busca el `tenant_id` del usuario en la tabla `usuario`.
5. Si lo encuentra, agrega `"tenant_id": "<uuid>"` al objeto `claims` del JWT.
6. El JWT firmado ahora contiene el claim `tenant_id` que las RLS policies pueden leer.

### Registro del hook en Supabase

El hook se registra desde el **Supabase Dashboard**:

1. Ir a **Authentication** → **Hooks**.
2. En **Customize Access Token (JWT) Claims**, activar el hook.
3. Seleccionar la función `public.custom_access_token_hook`.
4. Guardar.

No se puede registrar por SQL ni por CLI. Es una operación manual en el dashboard.

### Permisos necesarios

```sql
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT SELECT ON TABLE public.usuario TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

Solo el rol `supabase_auth_admin` (interno de Supabase) puede ejecutar esta función. Los usuarios normales no la pueden invocar directamente.

---

## `auth.tenant_id()` — Extracción de `tenant_id` del JWT

Función helper que las RLS policies usan para obtener el `tenant_id` del usuario autenticado desde el JWT.

```sql
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::JSONB ->> 'tenant_id')::UUID,
    NULL
  );
$$ LANGUAGE sql STABLE;
```

### Cómo funciona

1. `current_setting('request.jwt.claims', true)` obtiene los claims del JWT de la request actual. El segundo argumento `true` indica que no lance error si la variable no existe (retorna `NULL`).
2. Se castea a JSONB y se extrae el campo `tenant_id` con el operador `->>`.
3. Se castea a UUID.
4. `COALESCE(..., NULL)` devuelve `NULL` si no hay JWT, si no tiene el claim, o si el valor no es un UUID válido.

### Por qué `STABLE` y no `IMMUTABLE`

La función es `STABLE` porque depende del contexto de la request (el JWT cambia entre requests), pero dentro de una misma transacción el resultado no cambia. PostgreSQL puede cachear el resultado dentro de la transacción.

---

## RLS Policies — Ejemplo completo para `producto`

```sql
-- 1. Habilitar RLS en la tabla
ALTER TABLE producto ENABLE ROW LEVEL SECURITY;

-- 2. SELECT: solo ver productos de mi tenant
CREATE POLICY "tenant_select_producto"
  ON producto FOR SELECT
  USING (tenant_id = auth.tenant_id());

-- 3. INSERT: solo insertar productos en mi tenant
CREATE POLICY "tenant_insert_producto"
  ON producto FOR INSERT
  WITH CHECK (tenant_id = auth.tenant_id());

-- 4. UPDATE: solo actualizar productos de mi tenant
--    USING filtra las filas que puedo ver para actualizar
--    WITH CHECK verifica que no cambie el tenant_id a otro valor
CREATE POLICY "tenant_update_producto"
  ON producto FOR UPDATE
  USING (tenant_id = auth.tenant_id())
  WITH CHECK (tenant_id = auth.tenant_id());

-- 5. DELETE: solo eliminar productos de mi tenant
CREATE POLICY "tenant_delete_producto"
  ON producto FOR DELETE
  USING (tenant_id = auth.tenant_id());
```

### Explicación de cada policy

| Policy | Operación | Cláusula | Qué hace |
|---|---|---|---|
| `tenant_select_producto` | SELECT | `USING` | Filtra filas: solo retorna las que tienen `tenant_id` igual al del JWT. Si un usuario del tenant A hace `SELECT * FROM producto`, solo ve productos del tenant A |
| `tenant_insert_producto` | INSERT | `WITH CHECK` | Valida la fila nueva: solo permite insertar si el `tenant_id` de la fila coincide con el del JWT. Impide que un usuario inserte datos en otro tenant |
| `tenant_update_producto` | UPDATE | `USING` + `WITH CHECK` | `USING` filtra qué filas puede ver para actualizar. `WITH CHECK` verifica que la fila después del update siga teniendo el mismo `tenant_id`. Impide "mover" un producto a otro tenant |
| `tenant_delete_producto` | DELETE | `USING` | Filtra qué filas puede borrar. Solo las de su tenant |

---

## Lista completa de tablas que requieren RLS

Todas las tablas con columna `tenant_id` necesitan las 4 policies (SELECT, INSERT, UPDATE, DELETE). Las tablas hijas (`comprobante_item`, `pedido_item`) no tienen `tenant_id` directo pero están protegidas indirectamente por las FK a sus tablas padre.

| # | Tabla | `tenant_id` directo | RLS necesario | Notas |
|---|---|---|---|---|
| 1 | `tenant` | Si (es la PK) | Si | Policy especial: `USING (id = auth.tenant_id())`. Solo puede ver/editar su propio registro |
| 2 | `modulo_config` | Si | Si | Un registro por tenant. Solo admin puede modificar |
| 3 | `usuario` | Si | Si | Policy adicional futura: limitar qué roles pueden ver a otros usuarios |
| 4 | `categoria` | Si | Si | Estándar |
| 5 | `proveedor` | Si | Si | Estándar |
| 6 | `producto` | Si | Si | Estándar |
| 7 | `movimiento` | Si | Si | Insert-only para usuarios normales (no se editan ni borran movimientos) |
| 8 | `cliente` | Si | Si | Estándar |
| 9 | `comprobante` | Si | Si | Delete restringido: solo borradores se pueden eliminar |
| 10 | `comprobante_item` | No (via `comprobante_id`) | Si* | *Policy basada en JOIN: `USING (EXISTS (SELECT 1 FROM comprobante WHERE id = comprobante_item.comprobante_id AND tenant_id = auth.tenant_id()))` |
| 11 | `pedido` | Si | Si | Estándar |
| 12 | `pedido_item` | No (via `pedido_id`) | Si* | *Policy basada en JOIN, análoga a `comprobante_item` |
| 13 | `importacion_log` | Si | Si | Estándar. Insert-only para la app, select para consultar historial |
| 14 | `precio_historial` | Si | Si | Insert-only. Select para ver evolución de precios |
| 15 | `arca_config` | Si | Si | Solo admin puede ver/editar (contiene certificados) |
| 16 | `arca_log` | Si | Si | Select-only para el usuario. Insert por funciones SECURITY DEFINER |

### Policies para tablas hijas (sin `tenant_id` directo)

Para `comprobante_item` y `pedido_item` hay dos opciones:

**Opción A — Policy con subquery (recomendada por simplicidad):**
```sql
ALTER TABLE comprobante_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_comprobante_item"
  ON comprobante_item FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM comprobante
      WHERE comprobante.id = comprobante_item.comprobante_id
        AND comprobante.tenant_id = auth.tenant_id()
    )
  );

CREATE POLICY "tenant_insert_comprobante_item"
  ON comprobante_item FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM comprobante
      WHERE comprobante.id = comprobante_item.comprobante_id
        AND comprobante.tenant_id = auth.tenant_id()
    )
  );

CREATE POLICY "tenant_update_comprobante_item"
  ON comprobante_item FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM comprobante
      WHERE comprobante.id = comprobante_item.comprobante_id
        AND comprobante.tenant_id = auth.tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM comprobante
      WHERE comprobante.id = comprobante_item.comprobante_id
        AND comprobante.tenant_id = auth.tenant_id()
    )
  );

CREATE POLICY "tenant_delete_comprobante_item"
  ON comprobante_item FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM comprobante
      WHERE comprobante.id = comprobante_item.comprobante_id
        AND comprobante.tenant_id = auth.tenant_id()
    )
  );
```

**Opción B — Agregar `tenant_id` a las tablas hijas (recomendada por performance):**
Agregar `tenant_id` directamente a `comprobante_item` y `pedido_item` para evitar el subquery en cada operación. Es redundante pero más rápido con muchos datos. Decisión a tomar antes de v1.5.

---

## Qué pasa si se llama sin `tenant_id` en el JWT

Esto puede ocurrir en dos escenarios:

### Escenario 1: Usuario sin registro en tabla `usuario`

Si un usuario se autentica en Supabase Auth pero no tiene un registro en la tabla `usuario` (por ejemplo, se creó el auth.user pero falló la inserción en `usuario`):

1. `custom_access_token_hook` se ejecuta.
2. `SELECT tenant_id ... WHERE id = user_id` no encuentra fila → `v_tenant_id` es `NULL`.
3. El JWT se genera **sin** el claim `tenant_id`.
4. `auth.tenant_id()` retorna `NULL`.
5. Todas las RLS policies evalúan `tenant_id = NULL`, que es `false` para cualquier fila (en SQL, `NULL = NULL` es `NULL`, no `true`).
6. **Resultado: el usuario no ve ningún dato de ningún tenant.** No hay fuga.

### Escenario 2: Request sin autenticación (anon)

1. No hay JWT en la request.
2. `current_setting('request.jwt.claims', true)` retorna `NULL`.
3. `auth.tenant_id()` retorna `NULL`.
4. **Resultado: misma lógica que arriba — no ve nada.**

### Escenario 3: JWT manipulado

Un atacante intenta inyectar un `tenant_id` falso en el JWT:

1. Supabase firma los JWT con su secret key.
2. Un JWT manipulado no pasa la verificación de firma en el middleware.
3. **Resultado: la request es rechazada antes de llegar a la base de datos.**

### Defensa en profundidad en la app

Además del RLS, la capa de aplicación debe verificar:

```typescript
// En un API route o Server Component
const { data: { user } } = await supabase.auth.getUser();
const tenantId = user?.app_metadata?.tenant_id 
  ?? user?.user_metadata?.tenant_id;

if (!tenantId) {
  redirect('/login');
  // o return NextResponse.json({ error: 'Sin tenant' }, { status: 403 });
}
```

---

## Tests de aislamiento entre tenants

Los tests de aislamiento verifican que las RLS policies funcionan correctamente: un tenant nunca puede ver, crear, modificar o eliminar datos de otro tenant.

### Estrategia de testing

1. **Crear dos tenants de prueba** con sus respectivos usuarios y datos.
2. **Ejecutar queries con el JWT de cada tenant** y verificar que solo retornen datos propios.
3. **Intentar operaciones cross-tenant** y verificar que fallen.

### Test de ejemplo: aislamiento de productos

```typescript
import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll } from 'vitest';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(supabaseUrl, serviceRoleKey);

describe('Aislamiento multi-tenant - productos', () => {
  let tenantA_id: string;
  let tenantB_id: string;
  let userA_token: string;
  let userB_token: string;
  let productoA_id: string;

  beforeAll(async () => {
    // Crear tenant A y su usuario
    const { data: tA } = await adminClient
      .from('tenant')
      .insert({ nombre: 'Test Tenant A' })
      .select()
      .single();
    tenantA_id = tA!.id;

    // Crear usuario A en auth y en tabla usuario
    const { data: authA } = await adminClient.auth.admin.createUser({
      email: 'usera@test.com',
      password: 'test123456',
      email_confirm: true,
    });
    await adminClient.from('usuario').insert({
      id: authA.user!.id,
      tenant_id: tenantA_id,
      nombre: 'User',
      apellido: 'A',
      email: 'usera@test.com',
      rol: 'admin',
    });

    // Crear tenant B y su usuario
    const { data: tB } = await adminClient
      .from('tenant')
      .insert({ nombre: 'Test Tenant B' })
      .select()
      .single();
    tenantB_id = tB!.id;

    const { data: authB } = await adminClient.auth.admin.createUser({
      email: 'userb@test.com',
      password: 'test123456',
      email_confirm: true,
    });
    await adminClient.from('usuario').insert({
      id: authB.user!.id,
      tenant_id: tenantB_id,
      nombre: 'User',
      apellido: 'B',
      email: 'userb@test.com',
      rol: 'admin',
    });

    // Login como cada usuario para obtener JWTs con tenant_id
    const clientA = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data: sessionA } = await clientA.auth.signInWithPassword({
      email: 'usera@test.com',
      password: 'test123456',
    });
    userA_token = sessionA.session!.access_token;

    const clientB = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data: sessionB } = await clientB.auth.signInWithPassword({
      email: 'userb@test.com',
      password: 'test123456',
    });
    userB_token = sessionB.session!.access_token;

    // Crear un producto en tenant A usando el service role
    const { data: prod } = await adminClient
      .from('producto')
      .insert({
        tenant_id: tenantA_id,
        codigo: 'PROD-001',
        nombre: 'Producto secreto de A',
        precio_costo: 100,
        precio_venta: 150,
      })
      .select()
      .single();
    productoA_id = prod!.id;
  });

  it('Tenant A puede ver sus propios productos', async () => {
    const clientA = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${userA_token}` } },
    });

    const { data, error } = await clientA.from('producto').select('*');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].nombre).toBe('Producto secreto de A');
  });

  it('Tenant B NO puede ver productos de Tenant A', async () => {
    const clientB = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${userB_token}` } },
    });

    const { data, error } = await clientB.from('producto').select('*');

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('Tenant B NO puede actualizar productos de Tenant A', async () => {
    const clientB = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${userB_token}` } },
    });

    const { data, error } = await clientB
      .from('producto')
      .update({ nombre: 'Hackeado' })
      .eq('id', productoA_id)
      .select();

    expect(data).toHaveLength(0);
  });

  it('Tenant B NO puede eliminar productos de Tenant A', async () => {
    const clientB = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${userB_token}` } },
    });

    const { data, error } = await clientB
      .from('producto')
      .delete()
      .eq('id', productoA_id)
      .select();

    expect(data).toHaveLength(0);
  });

  it('Tenant B NO puede insertar productos con tenant_id de Tenant A', async () => {
    const clientB = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${userB_token}` } },
    });

    const { data, error } = await clientB
      .from('producto')
      .insert({
        tenant_id: tenantA_id,
        codigo: 'HACK-001',
        nombre: 'Producto intruso',
      })
      .select();

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
```

### Checklist de tests de aislamiento

Replicar para cada tabla con `tenant_id`:

- [ ] Tenant A puede SELECT sus propios datos
- [ ] Tenant B NO puede SELECT datos de Tenant A
- [ ] Tenant B NO puede UPDATE datos de Tenant A
- [ ] Tenant B NO puede DELETE datos de Tenant A
- [ ] Tenant B NO puede INSERT con `tenant_id` de Tenant A
- [ ] Usuario sin tenant (JWT sin claim) no ve ningún dato
- [ ] Funciones `SECURITY DEFINER` (`registrar_movimiento`, `siguiente_numero_comprobante`) operan correctamente respetando el `tenant_id` pasado como parámetro
