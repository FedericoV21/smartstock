# Nexus — Especificación completa del proyecto

## 1. Visión general

Nexus es un sistema de gestión de stock inteligente, modular y adaptable a distintos tipos de negocio. Desde un almacén de barrio hasta una fábrica o distribuidora, cada cliente activa solo los módulos que necesita.

**Modelo de negocio:** suscripción mensual con dos planes (Base y Completo) que controlan qué módulos tiene habilitados cada cliente. Los módulos se activan/desactivan por configuración en base de datos, no por versiones distintas del código. Un mismo deploy sirve a todos los clientes.

**Filosofía:** el sistema se adapta al negocio, no al revés. Un kiosco no necesita facturador ni pedidos. Una distribuidora necesita todo. La modularidad es arquitectónica, no cosmética.

---

## 2. Stack tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Frontend + Backend | Next.js 14+ (App Router, TypeScript) | Full-stack en un solo framework, SSR, API routes, deploy simple |
| Base de datos | Supabase (PostgreSQL 15+) | Auth integrado, RLS nativo, Storage, Realtime, SDK para JS |
| Autenticación | Supabase Auth | JWT con claims custom (tenant_id), magic link, OAuth opcional |
| Storage | Supabase Storage | PDFs de comprobantes, logos de negocios, imágenes de productos |
| Facturación PDF | jsPDF | Generación de PDFs en el servidor sin dependencias externas pesadas |
| Lectura Excel | SheetJS (xlsx) | Parseo de .xlsx/.csv en el frontend, rápido, sin servidor |
| IA de precios | Gemini 1.5 Pro (API REST) | Visión: lee PDFs e imágenes de listas de precios |
| Integración fiscal | ARCA (ex-AFIP) — WSAA + WSFE | Facturación electrónica obligatoria en Argentina |
| Deploy | Vercel (inicial) / VPS con Docker (escalado) | Vercel para arrancar rápido, VPS si se necesita más control |

---

## 3. Planes de suscripción

### Plan Base
- Núcleo de stock (control en tiempo real, movimientos, alertas, vencimientos)
- Importador Excel/CSV (normalizador inteligente, mapeo, preview, upsert)
- Facturador simple (PDF en blanco y negro, sin ARCA)
- Clientes objetivo: almacenes, kioscos, comercios chicos

### Plan Completo
- Todo lo del Plan Base
- Módulo de pedidos y presupuestos
- IA de precios (extracción automática desde PDF/imagen con Gemini)
- Integración ARCA (facturación electrónica con CAE)
- Clientes objetivo: distribuidoras, fábricas, áreas comerciales

---

## 4. Perfiles de cliente

| Perfil | Stock | Excel | Facturación | Pedidos | IA precios | ARCA |
|---|---|---|---|---|---|---|
| Almacén de barrio | Sí | Sí | Simple (PDF) | No | No | No |
| Kiosco / maxikiosco | Sí | Sí | No | No | No | No |
| Distribuidora | Sí | Sí | Electrónica | Sí | Sí | Sí |
| Fábrica | Sí | Sí | Simple o electrónica | Sí | No | Opcional |
| Área de ventas | No | No | Electrónica | Sí (presup.) | No | Sí |

---

## 5. Arquitectura de módulos

El sistema tiene un registro de configuración por tenant en la tabla `modulo_config`. Cada campo booleano indica si el módulo está habilitado.

**Módulos disponibles:**
- `stock` — siempre activo, no se puede desactivar
- `importador_excel` — siempre activo, no se puede desactivar
- `facturador_simple` — habilitado en Plan Base y Completo
- `facturador_arca` — habilitado solo en Plan Completo
- `pedidos` — habilitado solo en Plan Completo
- `presupuestos` — habilitado solo en Plan Completo
- `ia_precios` — habilitado solo en Plan Completo

**Cómo se controla el acceso:**
1. Al iniciar sesión, el frontend consulta `modulo_config` del tenant
2. El layout del dashboard muestra/oculta items del menú según los módulos activos
3. Cada API route verifica el módulo correspondiente antes de procesar el request
4. Si un módulo está desactivado, la API devuelve 403 con mensaje descriptivo

---

## 6. Base de datos — Esquema completo

### 6.1 Configuración general de Supabase

**Extensiones requeridas:**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "moddatetime";
```

**Tipos enumerados (ENUMs):**
```sql
CREATE TYPE condicion_iva AS ENUM (
  'responsable_inscripto',
  'monotributista',
  'exento',
  'consumidor_final'
);

CREATE TYPE rol_usuario AS ENUM (
  'admin',
  'operador',
  'visor'
);

CREATE TYPE unidad_medida AS ENUM (
  'unidad',
  'kg',
  'litro',
  'metro',
  'caja',
  'pack',
  'gramo',
  'ml'
);

CREATE TYPE tipo_movimiento AS ENUM (
  'entrada',
  'salida',
  'ajuste'
);

CREATE TYPE referencia_tipo AS ENUM (
  'factura',
  'pedido',
  'importacion',
  'manual',
  'ajuste_inventario'
);

CREATE TYPE tipo_comprobante AS ENUM (
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito_a',
  'nota_credito_b',
  'nota_credito_c',
  'remito',
  'presupuesto'
);

CREATE TYPE estado_comprobante AS ENUM (
  'borrador',
  'emitido',
  'pendiente_arca',
  'error_arca',
  'anulado'
);

CREATE TYPE estado_pedido AS ENUM (
  'borrador',
  'confirmado',
  'entregado',
  'cancelado'
);

CREATE TYPE plan_tipo AS ENUM (
  'base',
  'completo'
);

CREATE TYPE arca_ambiente AS ENUM (
  'homologacion',
  'produccion'
);

CREATE TYPE origen_precio AS ENUM (
  'manual',
  'importacion_excel',
  'ia_pdf'
);
```

### 6.2 Tabla `tenant`

Representa un negocio/cliente de Nexus. Es la raíz de todo el multi-tenancy.

```sql
CREATE TABLE tenant (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          TEXT NOT NULL,
  razon_social    TEXT,
  cuit            VARCHAR(13),
  domicilio       TEXT,
  telefono        VARCHAR(20),
  email           VARCHAR(255),
  logo_url        TEXT,
  punto_de_venta  INTEGER DEFAULT 1,
  condicion_iva   condicion_iva DEFAULT 'monotributista',
  plan            plan_tipo DEFAULT 'base',
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_tenant_updated_at
  BEFORE UPDATE ON tenant
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE INDEX idx_tenant_cuit ON tenant(cuit) WHERE cuit IS NOT NULL;
```

### 6.3 Tabla `modulo_config`

Un registro por tenant. Controla qué módulos tiene habilitados.

```sql
CREATE TABLE modulo_config (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL UNIQUE REFERENCES tenant(id) ON DELETE CASCADE,
  stock             BOOLEAN DEFAULT true,
  importador_excel  BOOLEAN DEFAULT true,
  facturador_simple BOOLEAN DEFAULT false,
  facturador_arca   BOOLEAN DEFAULT false,
  pedidos           BOOLEAN DEFAULT false,
  presupuestos      BOOLEAN DEFAULT false,
  ia_precios        BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_modulo_config_updated_at
  BEFORE UPDATE ON modulo_config
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE modulo_config
  ADD CONSTRAINT chk_arca_requiere_facturador
  CHECK (facturador_arca = false OR facturador_simple = true);
```

### 6.4 Tabla `usuario`

```sql
CREATE TABLE usuario (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  apellido    TEXT NOT NULL,
  email       VARCHAR(255) NOT NULL,
  rol         rol_usuario DEFAULT 'operador',
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usuario_tenant ON usuario(tenant_id);
CREATE INDEX idx_usuario_email ON usuario(email);
```

### 6.5 Tabla `categoria`

```sql
CREATE TABLE categoria (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activa      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categoria_tenant ON categoria(tenant_id);

CREATE UNIQUE INDEX idx_categoria_nombre_tenant
  ON categoria(tenant_id, LOWER(nombre))
  WHERE activa = true;
```

### 6.6 Tabla `proveedor`

```sql
CREATE TABLE proveedor (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  cuit          VARCHAR(13),
  telefono      VARCHAR(20),
  email         VARCHAR(255),
  direccion     TEXT,
  notas         TEXT,
  mapeo_excel   JSONB,
  activo        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_proveedor_updated_at
  BEFORE UPDATE ON proveedor
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE INDEX idx_proveedor_tenant ON proveedor(tenant_id);
```

En la app, un proveedor con `activo = false` se considera **inactivo**: la pantalla **Proveedores** muestra por defecto solo activos; el detalle permite marcar activo/inactivo y `GET /api/proveedores` admite el query `estado=activos|inactivos|todos` (defecto: solo activos). El listado de proveedores del **POS** sigue pidiendo solo `activo = true` (endpoint `GET /api/pos/proveedores`).

Al **inhabilitar** un proveedor (`activo` de `true` a `false`), la migración **`069_proveedor_inactivo_desactiva_productos.sql`** define el trigger `proveedor_inactivo_desactiva_productos`, que pone `producto.activo = false` (y actualiza `updated_at`) en todos los productos del mismo tenant cuyo **`proveedor_id`** es ese proveedor. No modifica artículos que solo lo relacionen en **`producto_proveedor`**. Reactivar el proveedor **no** reactiva esos productos automáticamente.

**Estructura del campo `mapeo_excel` (JSONB):**
```json
{
  "nombre_archivo_ejemplo": "lista_precios_marzo_2026.xlsx",
  "fila_header": 1,
  "mapeo": {
    "codigo": "COD ART",
    "nombre": "DESCRIPCION",
    "precio_costo": "COSTO",
    "precio_venta": "PVP",
    "stock_actual": null,
    "categoria": "RUBRO",
    "unidad": null
  },
  "columnas_ignoradas": ["OBSERVACIONES", "FOTO"],
  "ultima_importacion": "2026-04-10T14:30:00Z"
}
```

### 6.7 Tabla `producto`

```sql
CREATE TABLE producto (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo            VARCHAR(50) NOT NULL,
  nombre            TEXT NOT NULL,
  descripcion       TEXT,
  categoria_id      UUID REFERENCES categoria(id) ON DELETE SET NULL,
  proveedor_id      UUID REFERENCES proveedor(id) ON DELETE SET NULL,
  unidad            unidad_medida DEFAULT 'unidad',
  precio_costo      DECIMAL(12,2) DEFAULT 0,
  precio_venta      DECIMAL(12,2) DEFAULT 0,
  stock_actual      INTEGER DEFAULT 0,
  stock_minimo      INTEGER DEFAULT 0,
  fecha_vencimiento DATE,
  imagen_url        TEXT,
  activo            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_producto_updated_at
  BEFORE UPDATE ON producto
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- Migración 054: varios activos por tenant pueden compartir el mismo código; índice de búsqueda no único
CREATE INDEX idx_producto_codigo_tenant_lookup
  ON producto (tenant_id, LOWER(codigo))
  WHERE activo = true;

CREATE INDEX idx_producto_tenant ON producto(tenant_id);
CREATE INDEX idx_producto_categoria ON producto(categoria_id);
CREATE INDEX idx_producto_proveedor ON producto(proveedor_id);
CREATE INDEX idx_producto_nombre ON producto USING gin(to_tsvector('spanish', nombre));

CREATE INDEX idx_producto_stock_bajo
  ON producto(tenant_id)
  WHERE activo = true AND stock_actual <= stock_minimo AND stock_minimo > 0;

CREATE INDEX idx_producto_vencimiento
  ON producto(tenant_id, fecha_vencimiento)
  WHERE activo = true AND fecha_vencimiento IS NOT NULL;

ALTER TABLE producto
  ADD CONSTRAINT chk_precios_positivos
  CHECK (precio_costo >= 0 AND precio_venta >= 0);

ALTER TABLE producto
  ADD CONSTRAINT chk_stock_positivo
  CHECK (stock_actual >= 0);
```

### 6.8 Tabla `movimiento`

```sql
CREATE TABLE movimiento (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
  tipo            tipo_movimiento NOT NULL,
  cantidad        INTEGER NOT NULL,
  stock_anterior  INTEGER NOT NULL,
  stock_posterior INTEGER NOT NULL,
  motivo          TEXT,
  referencia_tipo referencia_tipo,
  referencia_id   UUID,
  usuario_id      UUID REFERENCES usuario(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_movimiento_tenant ON movimiento(tenant_id);
CREATE INDEX idx_movimiento_producto ON movimiento(producto_id);
CREATE INDEX idx_movimiento_fecha ON movimiento(tenant_id, created_at DESC);
CREATE INDEX idx_movimiento_referencia ON movimiento(referencia_tipo, referencia_id)
  WHERE referencia_id IS NOT NULL;

ALTER TABLE movimiento
  ADD CONSTRAINT chk_cantidad_positiva
  CHECK (cantidad > 0);
```

**Función para registrar un movimiento y actualizar stock atómicamente:**

```sql
CREATE OR REPLACE FUNCTION registrar_movimiento(
  p_tenant_id       UUID,
  p_producto_id     UUID,
  p_tipo            tipo_movimiento,
  p_cantidad        INTEGER,
  p_motivo          TEXT DEFAULT NULL,
  p_referencia_tipo referencia_tipo DEFAULT NULL,
  p_referencia_id   UUID DEFAULT NULL,
  p_usuario_id      UUID DEFAULT NULL
) RETURNS movimiento AS $$
DECLARE
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
  v_movimiento      movimiento;
BEGIN
  SELECT stock_actual INTO v_stock_anterior
  FROM producto
  WHERE id = p_producto_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN
      v_stock_posterior := v_stock_anterior + p_cantidad;
    WHEN 'salida' THEN
      v_stock_posterior := v_stock_anterior - p_cantidad;
      IF v_stock_posterior < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %',
          v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
  END CASE;

  UPDATE producto
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE id = p_producto_id AND tenant_id = p_tenant_id;

  INSERT INTO movimiento (
    tenant_id, producto_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    motivo, referencia_tipo, referencia_id, usuario_id
  ) VALUES (
    p_tenant_id, p_producto_id, p_tipo, p_cantidad,
    v_stock_anterior, v_stock_posterior,
    p_motivo, p_referencia_tipo, p_referencia_id, p_usuario_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 6.9 Tabla `cliente`

```sql
CREATE TABLE cliente (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  razon_social    TEXT,
  cuit_dni        VARCHAR(13),
  condicion_iva   condicion_iva DEFAULT 'consumidor_final',
  direccion       TEXT,
  telefono        VARCHAR(20),
  email           VARCHAR(255),
  notas           TEXT,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_cliente_updated_at
  BEFORE UPDATE ON cliente
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE INDEX idx_cliente_tenant ON cliente(tenant_id);
CREATE INDEX idx_cliente_cuit ON cliente(tenant_id, cuit_dni) WHERE cuit_dni IS NOT NULL;
```

### 6.10 Tabla `comprobante`

```sql
CREATE TABLE comprobante (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tipo              tipo_comprobante NOT NULL,
  numero            INTEGER NOT NULL,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id        UUID REFERENCES cliente(id) ON DELETE SET NULL,
  subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva_monto         DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva_porcentaje    DECIMAL(5,2) DEFAULT 21.00,
  total             DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado            estado_comprobante DEFAULT 'borrador',
  cae               VARCHAR(20),
  cae_vencimiento   DATE,
  pdf_url           TEXT,
  notas             TEXT,
  usuario_id        UUID REFERENCES usuario(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_comprobante_updated_at
  BEFORE UPDATE ON comprobante
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE UNIQUE INDEX idx_comprobante_numero
  ON comprobante(tenant_id, tipo, numero);

CREATE INDEX idx_comprobante_tenant ON comprobante(tenant_id);
CREATE INDEX idx_comprobante_cliente ON comprobante(cliente_id);
CREATE INDEX idx_comprobante_fecha ON comprobante(tenant_id, fecha DESC);
CREATE INDEX idx_comprobante_estado ON comprobante(tenant_id, estado);
```

**Función para obtener el siguiente número de comprobante:**

```sql
CREATE OR REPLACE FUNCTION siguiente_numero_comprobante(
  p_tenant_id UUID,
  p_tipo      tipo_comprobante
) RETURNS INTEGER AS $$
DECLARE
  v_siguiente INTEGER;
BEGIN
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_siguiente
  FROM comprobante
  WHERE tenant_id = p_tenant_id AND tipo = p_tipo;

  RETURN v_siguiente;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 6.11 Tabla `comprobante_item`

```sql
CREATE TABLE comprobante_item (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comprobante_id    UUID NOT NULL REFERENCES comprobante(id) ON DELETE CASCADE,
  producto_id       UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
  cantidad          INTEGER NOT NULL,
  precio_unitario   DECIMAL(12,2) NOT NULL,
  subtotal          DECIMAL(12,2) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comprobante_item_comprobante ON comprobante_item(comprobante_id);

ALTER TABLE comprobante_item
  ADD CONSTRAINT chk_item_positivo
  CHECK (cantidad > 0 AND precio_unitario >= 0 AND subtotal >= 0);
```

### 6.12 Tabla `pedido`

```sql
CREATE TABLE pedido (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  cliente_id      UUID REFERENCES cliente(id) ON DELETE SET NULL,
  estado          estado_pedido DEFAULT 'borrador',
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  total           DECIMAL(12,2) DEFAULT 0,
  notas           TEXT,
  comprobante_id  UUID REFERENCES comprobante(id) ON DELETE SET NULL,
  usuario_id      UUID REFERENCES usuario(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_pedido_updated_at
  BEFORE UPDATE ON pedido
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE INDEX idx_pedido_tenant ON pedido(tenant_id);
CREATE INDEX idx_pedido_cliente ON pedido(cliente_id);
CREATE INDEX idx_pedido_estado ON pedido(tenant_id, estado);
CREATE INDEX idx_pedido_fecha ON pedido(tenant_id, fecha DESC);
```

### 6.13 Tabla `pedido_item`

```sql
CREATE TABLE pedido_item (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id       UUID NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
  cantidad        INTEGER NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pedido_item_pedido ON pedido_item(pedido_id);

ALTER TABLE pedido_item
  ADD CONSTRAINT chk_pedido_item_positivo
  CHECK (cantidad > 0 AND precio_unitario >= 0 AND subtotal >= 0);
```

### 6.14 Tabla `importacion_log`

```sql
CREATE TABLE importacion_log (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  proveedor_id           UUID REFERENCES proveedor(id) ON DELETE SET NULL,
  archivo_nombre         TEXT NOT NULL,
  origen                 origen_precio NOT NULL,
  total_filas            INTEGER NOT NULL DEFAULT 0,
  filas_exitosas         INTEGER NOT NULL DEFAULT 0,
  filas_con_error        INTEGER NOT NULL DEFAULT 0,
  productos_creados      INTEGER NOT NULL DEFAULT 0,
  productos_actualizados INTEGER NOT NULL DEFAULT 0,
  detalle_errores        JSONB,
  usuario_id             UUID REFERENCES usuario(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_importacion_tenant ON importacion_log(tenant_id);
CREATE INDEX idx_importacion_fecha ON importacion_log(tenant_id, created_at DESC);
```

**Estructura del campo `detalle_errores` (JSONB):**
```json
[
  {
    "fila": 3,
    "campo": "precio_venta",
    "valor_original": "abc",
    "error": "El precio debe ser un número válido"
  },
  {
    "fila": 7,
    "campo": "nombre",
    "valor_original": "",
    "error": "El nombre del producto no puede estar vacío"
  }
]
```

### 6.15 Tabla `precio_historial`

```sql
CREATE TABLE precio_historial (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  producto_id           UUID NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
  precio_costo_anterior DECIMAL(12,2),
  precio_costo_nuevo    DECIMAL(12,2),
  precio_venta_anterior DECIMAL(12,2),
  precio_venta_nuevo    DECIMAL(12,2),
  margen_anterior       DECIMAL(5,2),
  margen_nuevo          DECIMAL(5,2),
  origen                origen_precio NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_precio_historial_producto ON precio_historial(producto_id, created_at DESC);
CREATE INDEX idx_precio_historial_tenant ON precio_historial(tenant_id, created_at DESC);
```

### 6.16 Tabla `arca_config`

```sql
CREATE TABLE arca_config (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL UNIQUE REFERENCES tenant(id) ON DELETE CASCADE,
  certificado_pem     TEXT,
  clave_privada_pem   TEXT,
  cuit_emisor         VARCHAR(13) NOT NULL,
  punto_de_venta      INTEGER NOT NULL DEFAULT 1,
  ambiente            arca_ambiente DEFAULT 'homologacion',
  ticket_acceso       TEXT,
  ticket_sign         TEXT,
  ticket_expiracion   TIMESTAMPTZ,
  ultimo_comprobante  INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_arca_config_updated_at
  BEFORE UPDATE ON arca_config
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);
```

### 6.17 Tabla `arca_log`

```sql
CREATE TABLE arca_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  servicio        VARCHAR(10) NOT NULL,
  operacion       VARCHAR(50) NOT NULL,
  request_xml     TEXT,
  response_xml    TEXT,
  comprobante_id  UUID REFERENCES comprobante(id) ON DELETE SET NULL,
  exitoso         BOOLEAN NOT NULL DEFAULT false,
  error_codigo    VARCHAR(20),
  error_mensaje   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_arca_log_tenant ON arca_log(tenant_id, created_at DESC);
CREATE INDEX idx_arca_log_comprobante ON arca_log(comprobante_id)
  WHERE comprobante_id IS NOT NULL;
```

### 6.18 Row Level Security (RLS)

**Principio:** todo usuario solo puede ver y modificar datos de su propio tenant.

**Función que inyecta tenant_id en el JWT:**
```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.usuario
  WHERE id = (event->>'user_id')::UUID;

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

**Función helper para obtener el tenant_id del JWT:**
```sql
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::JSONB ->> 'tenant_id')::UUID,
    NULL
  );
$$ LANGUAGE sql STABLE;
```

**Policies RLS (replicar para TODAS las tablas con tenant_id):**
```sql
ALTER TABLE producto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_producto"
  ON producto FOR SELECT
  USING (tenant_id = auth.tenant_id());

CREATE POLICY "tenant_insert_producto"
  ON producto FOR INSERT
  WITH CHECK (tenant_id = auth.tenant_id());

CREATE POLICY "tenant_update_producto"
  ON producto FOR UPDATE
  USING (tenant_id = auth.tenant_id())
  WITH CHECK (tenant_id = auth.tenant_id());

CREATE POLICY "tenant_delete_producto"
  ON producto FOR DELETE
  USING (tenant_id = auth.tenant_id());
```

**Tablas que necesitan RLS con las mismas policies:**
tenant, modulo_config, usuario, categoria, proveedor, producto, movimiento, cliente, comprobante, comprobante_item, pedido, pedido_item, importacion_log, precio_historial, arca_config, arca_log.

---

## 7. Arquitectura de importación de datos

### 7.1 Nivel 1 — Determinista (Excel/CSV)

Disponible desde el día uno. Procesamiento 100% en JavaScript sin IA.

**Flujo paso a paso:**

1. El usuario hace click en "Importar" y selecciona un archivo .xlsx o .csv
2. SheetJS parsea el archivo en el navegador (no se sube al servidor todavía)
3. Se extraen los headers de la primera fila (o la fila que el usuario indique)
4. El normalizador compara cada header contra el diccionario de aliases
5. Si el usuario seleccionó un proveedor que ya tiene perfil guardado, se aplica ese mapeo directamente
6. Se muestra la pantalla de mapeo: columnas del archivo a la izquierda, campos del sistema a la derecha, las coincidencias automáticas ya conectadas
7. El usuario confirma o corrige el mapeo, marca columnas para ignorar
8. El sistema pregunta si quiere guardar el perfil para ese proveedor
9. Se muestra el preview: tabla con datos normalizados. Las filas con errores se marcan en rojo con detalle del problema
10. El usuario puede corregir valores inline o descartar filas
11. Al confirmar, se envía el JSON normalizado a la API route `/api/importar/ejecutar`
12. La API ejecuta el upsert: por cada fila, con la sucursal y el proveedor de la importación, busca un producto con el **mismo código** y el **mismo nombre** (descripción) según la normalización del importador. Si existe → actualiza. Si no → crea. Así, el mismo código con el mismo proveedor puede existir en **varias** filas de catálogo si difieren en la descripción. En el preview, `deduplicarFilas` solo colapsa filas con el **mismo** código **y** el **mismo** nombre; ver `docs/importador.md` (Detección de duplicados)
13. Se registra un movimiento por cada producto afectado
14. Se registra la importación en `importacion_log`
15. Se registran los cambios de precio en `precio_historial`
16. Se muestra el resumen: X creados, Y actualizados, Z errores

**Diccionario de aliases:**

```typescript
const ALIASES: Record<string, string[]> = {
  codigo:            ["codigo", "cod", "code", "sku", "ref", "referencia", "art",
                      "articulo", "id_producto", "cod_art", "codart", "item"],
  nombre:            ["nombre", "descripcion", "producto", "item", "articulo",
                      "detalle", "desc", "name", "denominacion"],
  precio_costo:      ["costo", "precio_costo", "pcosto", "costo_unitario",
                      "precio_compra", "cost", "neto"],
  precio_venta:      ["precio", "pvp", "precio_venta", "pventa",
                      "precio_unitario", "punit", "valor", "price", "venta",
                      "precio_lista", "lista"],
  stock_actual:      ["stock", "cantidad", "cant", "qty", "existencia",
                      "disponible", "saldo", "inventario"],
  stock_minimo:      ["stock_minimo", "minimo", "min", "punto_pedido",
                      "reposicion"],
  categoria:         ["categoria", "cat", "rubro", "familia", "tipo",
                      "category", "grupo", "linea"],
  proveedor:         ["proveedor", "prov", "fabricante", "marca", "supplier"],
  fecha_vencimiento: ["vencimiento", "vto", "venc", "expira", "caducidad",
                      "fecha_venc", "expiry", "fvto"],
  unidad:            ["unidad", "um", "medida", "unit", "uom"],
};
```

La comparación normaliza ambos lados: convierte a minúsculas, elimina espacios, guiones, underscores, puntos y tildes. Así "Precio Unit." se transforma en "preciounit" y matchea con "precio_unitario" → campo `precio_venta`.

### 7.2 Nivel 2 — Con IA (PDF/imagen)

Disponible con el módulo `ia_precios`. Usa Gemini 1.5 Pro vía API REST.

**Flujo:**

1. El usuario sube un PDF o imagen de una lista de precios
2. El archivo se envía a la API route `/api/ia/extraer`
3. La API route envía el archivo a Gemini con un prompt estructurado
4. Gemini devuelve un JSON con el schema: `[{ codigo, nombre, precio, unidad }]`
5. Ese JSON entra al mismo pipeline del Nivel 1 a partir del paso 9 (preview)
6. El resto es idéntico: validación, preview, confirmación, upsert, log

**Prompt de extracción para Gemini:**

```
Analiza este documento que contiene una lista de precios de un proveedor.
Extrae TODOS los productos que encuentres en una tabla.

Devuelve ÚNICAMENTE un JSON válido con el siguiente formato, sin texto adicional:
{
  "productos": [
    {
      "codigo": "string o null",
      "nombre": "string",
      "precio": number,
      "unidad": "string o null"
    }
  ]
}

Reglas:
- Si no hay código visible, usa null
- El precio debe ser un número (sin símbolos de moneda)
- Si hay varios precios (costo, lista, oferta), usa el precio de lista
- Ignora encabezados, logos y texto que no sea parte de la tabla de productos
- Si hay categorías o secciones, incluye el nombre del producto completo
```

### 7.3 Pipeline común

Independientemente del origen (Excel o PDF), todos los datos pasan por:

1. **Validación de tipos:** precio numérico positivo, código no vacío (salvo importación IA donde puede ser null), fecha en formato reconocible
2. **Normalización de datos:** trim de espacios, capitalización consistente del nombre, formateo de precio a 2 decimales
3. **Detección de duplicados:** dentro del archivo (dos filas con el mismo código) y contra la base existente
4. **Preview interactivo:** tabla con datos normalizados, errores resaltados, edición inline
5. **Upsert atómico:** por código de producto dentro del tenant, usando la función RPC de Supabase
6. **Registro de precio_historial:** cuando un precio cambia, se graba el antes y después
7. **Log de importación:** resumen completo en `importacion_log`

---

## 8. Facturación

### 8.1 Facturación simple (PDF sin ARCA)

Disponible con el módulo `facturador_simple`. Genera PDFs con jsPDF.

**Layout del PDF:**
- Header: logo del negocio (de `tenant.logo_url`), razón social, CUIT, domicilio, condición IVA, punto de venta
- Tipo y número de comprobante (ej: "Factura C Nro 0001-00000045")
- Fecha de emisión
- Datos del cliente: nombre/razón social, CUIT/DNI, condición IVA, dirección
- Tabla de items: cantidad, descripción, precio unitario, subtotal
- Pie: subtotal, IVA (monto y porcentaje), total
- Leyenda fiscal según condición del emisor

**Flujo de emisión:**
1. El usuario selecciona cliente y agrega productos al comprobante
2. El sistema calcula subtotal, IVA y total
3. Al emitir, se obtiene el siguiente número de comprobante (función atómica)
4. Se genera el PDF con jsPDF
5. Se sube el PDF a Supabase Storage
6. Se crea el registro en `comprobante` con estado "emitido"
7. Se crean los registros en `comprobante_item`
8. Se registra un movimiento de salida por cada item
9. Se descuenta stock_actual de cada producto

### 8.2 Facturación electrónica con ARCA (v4.0)

Disponible con el módulo `facturador_arca`. Extiende el facturador simple.

**WSAA — Autenticación:**
- Se firma un Token Request (XML) con la clave privada del certificado del tenant
- Se envía al endpoint de WSAA
- WSAA devuelve un token y un sign que valen 12 horas
- Se almacenan en `arca_config.ticket_acceso`, `ticket_sign` y `ticket_expiracion`
- Antes de cada operación con WSFE, se verifica si el ticket sigue vigente. Si no, se renueva

**WSFE — Emisión:**
- Se construye el XML del comprobante según especificaciones de ARCA
- Datos requeridos: tipo de comprobante, punto de venta, concepto, número de documento del receptor, tipo de documento, importes neto, IVA y total, alícuotas de IVA aplicadas, fecha desde/hasta del servicio (si aplica)
- Si ARCA aprueba: devuelve CAE + fecha de vencimiento del CAE
- Se actualiza `comprobante.cae` y `comprobante.cae_vencimiento`
- Se regenera el PDF incluyendo el CAE y el código de barras
- Si ARCA rechaza: se almacena el error en `arca_log` y se notifica al usuario

**Manejo de errores:**
- Timeout o error 500: el comprobante queda en estado `pendiente_arca`
- Un job periódico (Supabase Edge Function con cron) procesa la cola de pendientes
- Después de 3 reintentos fallidos: estado `error_arca`, notificación al usuario
- La operación del negocio nunca se bloquea

**Endpoints de ARCA:**

| Servicio | Homologación | Producción |
|---|---|---|
| WSAA | `https://wsaahomo.afip.gob.ar/ws/services/LoginCms` | `https://wsaa.afip.gob.ar/ws/services/LoginCms` |
| WSFE | `https://wswhomo.afip.gob.ar/wsfev1/service.asmx` | `https://servicios1.afip.gob.ar/wsfev1/service.asmx` |

---

## 9. Módulo de pedidos y presupuestos (v3.0)

### Pedidos

Un pedido se arma seleccionando productos del stock con cantidades y precios.

**Estados del pedido:**
- `borrador` — se puede editar libremente, no afecta stock
- `confirmado` — se reserva stock (se muestra como "comprometido" pero no se descuenta)
- `entregado` — se descuenta stock, se puede generar factura
- `cancelado` — se libera la reserva si estaba confirmado

**Conversión a factura:** al marcar un pedido como entregado, el usuario puede generar una factura con un click. El sistema crea el comprobante con los mismos items del pedido y vincula `pedido.comprobante_id`.

### Presupuestos

Un presupuesto es un comprobante de tipo `presupuesto` que no afecta stock ni tiene implicancias fiscales.

**Conversión:** se puede convertir a pedido o directamente a factura, heredando todos los items.

---

## 10. Estructura de carpetas de Next.js

```
smartstock/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── productos/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── [id]/page.tsx
│   │   │   │   └── nuevo/page.tsx
│   │   │   ├── movimientos/page.tsx
│   │   │   ├── importar/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── mapeo/page.tsx
│   │   │   │   └── preview/page.tsx
│   │   │   ├── facturacion/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── nueva/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── clientes/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── proveedores/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── pedidos/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── nuevo/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── presupuestos/
│   │   │   ├── ia-precios/
│   │   │   │   ├── page.tsx
│   │   │   │   └── historial/page.tsx
│   │   │   └── configuracion/
│   │   │       ├── page.tsx
│   │   │       ├── plan/page.tsx
│   │   │       ├── arca/page.tsx
│   │   │       └── usuarios/page.tsx
│   │   └── api/
│   │       ├── auth/
│   │       │   └── callback/route.ts
│   │       ├── productos/
│   │       │   └── route.ts
│   │       ├── movimientos/
│   │       │   └── route.ts
│   │       ├── importar/
│   │       │   ├── validar/route.ts
│   │       │   └── ejecutar/route.ts
│   │       ├── facturacion/
│   │       │   ├── emitir/route.ts
│   │       │   └── arca/
│   │       │       ├── wsaa/route.ts
│   │       │       └── wsfe/route.ts
│   │       ├── pedidos/
│   │       │   └── route.ts
│   │       └── ia/
│   │           └── extraer/route.ts
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── middleware.ts
│   │   ├── normalizador/
│   │   │   ├── aliases.ts
│   │   │   ├── mapear.ts
│   │   │   ├── validar.ts
│   │   │   └── normalizar.ts
│   │   ├── facturacion/
│   │   │   ├── pdf-generator.ts
│   │   │   ├── numerador.ts
│   │   │   └── arca/
│   │   │       ├── wsaa.ts
│   │   │       ├── wsfe.ts
│   │   │       ├── tipos.ts
│   │   │       └── xml-builder.ts
│   │   ├── ia/
│   │   │   ├── gemini.ts
│   │   │   └── prompts.ts
│   │   └── utils/
│   │       ├── formatters.ts
│   │       └── validators.ts
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── stock/
│   │   ├── importar/
│   │   ├── facturacion/
│   │   ├── pedidos/
│   │   └── dashboard/
│   ├── hooks/
│   │   ├── useModulos.ts
│   │   ├── useTenant.ts
│   │   └── useProductos.ts
│   └── types/
│       ├── database.ts
│       ├── importacion.ts
│       └── facturacion.ts
├── public/
│   └── plantillas/
│       └── plantilla_importacion.xlsx
├── supabase/
│   ├── migrations/
│   │   ├── 001_enums.sql
│   │   ├── 002_tenant.sql
│   │   ├── 003_usuario.sql
│   │   ├── 004_producto.sql
│   │   ├── 005_movimiento.sql
│   │   ├── 006_facturacion.sql
│   │   ├── 007_pedidos.sql
│   │   ├── 008_importacion.sql
│   │   ├── 009_precios.sql
│   │   ├── 010_arca.sql
│   │   ├── 011_rls.sql
│   │   └── 012_funciones.sql
│   └── seed.sql
├── .env.local
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 11. Variables de entorno

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Gemini (módulo IA)
GEMINI_API_KEY=AIza...

# ARCA — clave de encriptación para certificados en DB
ARCA_ENCRYPTION_KEY=una-clave-larga-y-segura-de-32-chars

# App
NEXT_PUBLIC_APP_URL=https://smartstock.app
```

---

## 12. Roadmap por versiones

### v0.1 — Fundaciones
- Proyecto Next.js con App Router, TypeScript, Tailwind, estructura de carpetas
- Supabase configurado: proyecto creado, todas las migraciones ejecutadas
- Auth funcionando: login, registro, middleware de sesión
- Multi-tenancy: tenant_id en JWT, RLS en todas las tablas
- Seed con datos de prueba
- **Cierre:** un usuario se registra, loguea y ve un dashboard vacío

### v1.0 — Núcleo de stock + importador Excel
- CRUD de productos con búsqueda y filtros
- Movimientos de entrada/salida con función atómica
- Alertas de stock mínimo en dashboard
- Vencimientos con alerta
- Importador Excel completo: parseo, normalizador, mapeo, perfil proveedor, preview, upsert, log
- Plantilla .xlsx descargable
- **Cierre:** se importa un Excel real y el stock queda actualizado correctamente

### v1.5 — Facturador simple (PDF sin ARCA)
- Generador PDF con jsPDF (factura, remito, presupuesto)
- Configuración del negocio
- Numeración secuencial atómica
- CRUD de clientes
- Historial de comprobantes con reimpresión
- Facturar descuenta stock automáticamente
- **Cierre:** se emite una factura, el PDF se genera y el stock se descuenta

### v2.0 — Lanzamiento
- Dashboard con métricas y alertas
- Sistema de planes con feature flags
- Onboarding de primer uso
- Responsive
- Deploy producción
- Primer cliente real
- **Cierre:** primer cliente operando en producción

### v3.0 — Pedidos + IA de precios
- Pedidos con estados y conversión a factura
- Presupuestos con conversión a pedido/factura
- IA de extracción con Gemini
- Preview de cambios de precio
- Historial de precios y sugerencias de márgenes
- **Cierre:** una distribuidora actualiza precios subiendo un PDF

### v4.0 — Integración ARCA
- WSAA: auth con certificado, ticket, renovación automática
- WSFE: emisión de facturas A, B, C, obtención de CAE
- Manejo de errores: reintentos, cola, modo offline
- Testing contra homologación
- **Cierre:** factura electrónica emitida con CAE válido en producción

---

## 13. Nomenclatura del dominio

Estos nombres se usan siempre en código, tablas, variables, endpoints y documentación:

`producto`, `stock`, `movimiento`, `pedido`, `factura`, `presupuesto`, `proveedor`, `cliente`, `precio`, `vencimiento`, `plan`, `modulo`, `cae`, `comprobante`, `categoria`, `unidad`, `tenant`, `importacion`.

---

## 14. Riesgos técnicos

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| Caídas de ARCA | Facturas no se emiten | Alta | Cola de reintentos + modo offline + notificación |
| Certificados ARCA expiran | Bloquea facturación electrónica | Media | Alerta 30 días antes + documentación de renovación |
| Archivos Excel irregulares | Importación falla | Alta | Normalizador + perfil proveedor + preview + validación robusta |
| Costos API Gemini | Gasto excesivo en IA | Media | Límite mensual por plan + cache + fallback manual |
| Fuga multi-tenant | Datos visibles entre clientes | Baja pero crítica | RLS obligatorio + tenant_id en todo + tests de aislamiento |
| Escalabilidad | Saturación de infra | Baja (inicial) | Vercel auto-escala + Supabase tier upgrade + monitoreo |
| Cambios API ARCA | Endpoints o schemas cambian | Media | Capa de abstracción + monitoreo de cambios oficiales |

---

## 15. Estado actual

**Versión actual:** v0.1 — pendiente de inicio.

**Siguiente acción:** crear el proyecto Next.js y ejecutar las migraciones de Supabase.