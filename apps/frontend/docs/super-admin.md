---
version: v0.1
ultima_actualizacion: 2026-04-20
---

# Super admin (staff de plataforma)

Usuario interno que puede **entrar en contexto de otros negocios** (tenants) sin ser usuario de ese negocio. El rol normal de la app (`admin`, `operador`, `visor`) sigue siendo el de `usuario.rol`; el super admin es un flag aparte.

## Modelo de datos

| Elemento | Descripción |
|----------|-------------|
| `public.usuario.es_super_admin` | `true` = staff con capacidad de cambiar contexto. |
| `public.usuario.tenant_id` | Negocio **casa** del staff (sigue siendo su tenant “propio”). |
| `public.usuario.tenant_contexto_id` | Tenant efectivo cuando impersona; se actualiza vía RPC `super_admin_set_tenant_contexto`, no a mano. |
| `public.super_admin_tenant_acceso` | Lista blanca: qué otros `tenant_id` puede elegir en el selector. **No hace falta** repetir el tenant casa aquí para “volver a mi cuenta”. |

Migración base: `supabase/migrations/034_super_admin_contexto.sql`.

### RLS al cambiar de contexto

Con el JWT en un tenant cliente, la fila del staff en `usuario` sigue teniendo `tenant_id` = casa. Sin una policy extra, RLS puede ocultar la propia fila y la app deja de reconocer al usuario. Aplicar también:

- `supabase/migrations/043_usuario_rls_select_self.sql` (permite `SELECT` de la fila donde `id = auth.uid()`).

## Requisito: hook de JWT

Tiene que estar activo **`public.custom_access_token_hook`** en **Authentication → Hooks → Customize Access Token**, como en [multi-tenancy.md](./multi-tenancy.md). Esa función (versión del repo, con soporte super admin) pone en el token el `tenant_id` **efectivo** para RLS.

Sin el hook registrado, el claim puede no alinearse con el contexto y el comportamiento será inconsistente.

## Alta manual desde Supabase

### 1. Usuario en Auth

En el dashboard: **Authentication → Users → Add user** (o invitación). Copiá el **UUID** del usuario (`id`).

### 2. Fila en `public.usuario`

El `usuario.id` debe ser el mismo UUID que `auth.users.id`. Tiene que existir un `tenant_id` válido (negocio casa del staff). Si el usuario es solo staff y no tiene negocio propio, conviene crear un tenant “casa” mínimo y asignarlo como hace el registro público (`POST /api/auth/register` / flujo de registro).

Campos típicos: `nombre`, `apellido`, `email`, `rol` (por ejemplo `admin`), `tenant_id`, `activo`.

### 3. Activar super admin

En **SQL Editor** (como rol con permisos sobre `public`):

```sql
UPDATE public.usuario
SET es_super_admin = true
WHERE id = 'UUID-DEL-USUARIO-AUTH';
```

### 4. Adherir negocios a los que puede entrar

Por cada tenant al que debe poder cambiar (clientes / cuentas a atender):

```sql
INSERT INTO public.super_admin_tenant_acceso (usuario_id, tenant_id)
VALUES
  ('UUID-DEL-USUARIO-AUTH', 'UUID-DEL-TENANT-CLIENTE')
ON CONFLICT DO NOTHING;
```

Para listar IDs de tenants existentes:

```sql
SELECT id, nombre, cuit FROM public.tenant ORDER BY nombre;
```

### 5. Sesión

Después de cambios en `es_super_admin` o en el hook, conviene **cerrar sesión y volver a entrar** (o refrescar token) para que el JWT traiga los claims correctos.

## En la aplicación

Con la sesión de un super admin, en el header aparece el **selector de cuenta**. Al elegir otro negocio, la app llama a `POST /api/admin/cambiar-tenant`, refresca la sesión y recarga la página para aplicar el nuevo contexto.

## Referencias en código

- Perfil y flags: `src/lib/dashboard/session-profile.ts`, `src/lib/api/tenant-session.ts`.
- Cambio de tenant: `src/app/api/admin/cambiar-tenant/route.ts` (RPC `super_admin_set_tenant_contexto`).
- Lista de tenants permitidos: `src/app/api/admin/tenants-accesibles/route.ts`.
