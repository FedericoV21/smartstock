---
estado: 🟢 Activo
version: v0.1
ultima_actualizacion: 2026-05-06
---

# Permisos por rol y permisos extra por usuario (RBAC)

Este documento describe cómo está armado el RBAC en Nexus y **cómo agregar nuevas claves de permiso**, en particular las que un administrador puede otorgar **por usuario** (operadores) además del rol.

## Modelo en base de datos

| Pieza | Tabla / función | Rol |
|--------|------------------|-----|
| Catálogo global de acciones | `public.permiso` (`clave` única, `modulo`, `descripcion`) | Define *qué* se puede chequear |
| Permisos del rol del tenant | `public.rol_permiso` (`rol_id`, `permiso_id`) | Cada rol de cada tenant tiene un conjunto de permisos |
| Usuario ↔ roles RBAC | `public.usuario_rol` | Un usuario puede tener uno o más `rol` del tenant |
| **Permisos adicionales por usuario** | `public.usuario_permiso` (`usuario_id`, `permiso_id`) | Otorga claves concretas sin cambiar el slug del rol (p. ej. `operador`) |
| Evaluación unificada | `public.has_permiso(p_clave TEXT)` | `SECURITY DEFINER`: super admin → `usuario_rol`+`rol_permiso` → `usuario_permiso` |

La migración de referencia para contactos y la tabla `usuario_permiso` es **`supabase/migrations/134_usuario_permiso_contactos.sql`**.

En la aplicación Next.js, el helper `hasPermission` (en `src/lib/api/permissions.ts`) llama al RPC `has_permiso` y conserva un fallback para `rol === 'admin'` cuando el RPC aún no está desplegado.

## Permisos “asignables” desde Configuración → Usuarios

Solo un subconjunto de claves se puede marcar en el diálogo **Permisos** de un operador. Eso evita que, por error, se otorguen permisos de administración desde esa UI.

1. **Allowlist en código:** `src/lib/api/permisos-asignables-usuario.ts` — array `PERMISOS_ASIGNABLES_USUARIO` y constantes por clave.
2. **API:** `src/app/api/configuracion/usuarios/[id]/permisos-extra/route.ts` — el `PATCH` solo acepta claves que estén en esa allowlist (además debe existir la fila en `permiso`).
3. **UI:** `src/app/(dashboard)/configuracion/usuarios/page.tsx` — checkboxes y textos del diálogo.

Para **mostrar u ocultar secciones del menú** (p. ej. operador acotado por rutas), además suele hacer falta:

- Cargar el permiso efectivo en el servidor (`getSessionProfile` usa `has_permiso` para las claves de contactos).
- Pasar flags al layout → `DashboardShell` → `DashboardChrome` y ajustar la lista de rutas permitidas / redirect del operador.

## Cómo agregar un permiso nuevo (checklist)

Seguí los pasos que apliquen a tu caso: solo rol, solo asignable por usuario, o ambos.

### 1. Migración SQL (obligatorio para nuevas claves)

En una **nueva** migración bajo `supabase/migrations/`:

```sql
-- Catálogo (idempotente)
INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('mi_modulo.mi_accion', 'mi_modulo', 'Descripción corta para admins')
ON CONFLICT (clave) DO NOTHING;
```

Decidir **qué roles base** del tenant deben tenerlo por defecto:

```sql
-- Ejemplo: todos los roles slugs listados reciben el permiso
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave = 'mi_modulo.mi_accion'
WHERE lower(r.slug) IN ('superadmin', 'admin', 'operador')  -- ajustar lista
ON CONFLICT (rol_id, permiso_id) DO NOTHING;
```

Si querés que **tenants nuevos** reciban el mismo mapa al bootstrap, actualizá también la función **`bootstrap_security_for_tenant`** en esa migración (bloque `target(role_slug, permiso_clave) AS ( VALUES ... )`), igual que en la migración 134. Si no, nuevos tenants podrían quedar sin esa fila en `rol_permiso` hasta un arreglo manual.

### 2. Asignación opcional desde “Permisos” (operadores)

Si el permiso debe poder marcarse **solo para algunos** usuarios (sin dárselo a todos los `operador`):

- No lo incluyas en `rol_permiso` para el slug `operador` (sí podés dárselo a `admin`, `cajero`, `visor`, etc., si corresponde).
- Añadí la clave a **`PERMISOS_ASIGNABLES_USUARIO`** en `src/lib/api/permisos-asignables-usuario.ts`.
- Extendé el **diálogo** en la página de usuarios (labels y estado inicial / guardado).
- La ruta `permisos-extra` usa la misma allowlist; si solo actualizás el array en TS, recordá que el servidor filtra con ese conjunto.

### 3. Uso en API o RLS

- En rutas **`src/app/api/**`**, usá `hasPermission(supabase, 'mi_modulo.mi_accion', { rol, isSuperAdmin })` o los helpers en `permissions.ts` (p. ej. reglas compuestas como acceso a clientes/proveedores junto con otros permisos).
- En políticas **RLS** que llamen a `has_permiso`, la nueva clave funcionará en cuanto exista en `permiso` y esté ligada al usuario vía rol o `usuario_permiso`.

### 4. UI / navegación

- Si el permiso **abre pantallas nuevas** para el rol `operador`, revisá `src/components/dashboard/dashboard-chrome.tsx` (allowlist y `useEffect` de redirect).
- Si hace falta estado en el cliente, extendé `SessionProfile` en `src/lib/dashboard/session-profile.ts` y el cableado en `src/app/(dashboard)/layout.tsx` y `dashboard-shell.tsx`.

### 5. Tipos TypeScript

Tras cambiar el esquema, regenerá o actualizá `src/types/database.ts` si usás tipos generados desde Supabase.

## Convención de nombres de clave

Recomendado: `modulo.accion` o `modulo.subdominio.accion` (todo en minúsculas, puntos como separador), por ejemplo:

- `contactos.proveedores.ver`
- `reportes.exportar`

Mantener el **mismo string** en SQL, `has_permiso`, allowlist TS y documentación.

## Referencias cruzadas

- Roles legacy en UI: columna `usuario.rol` (`rol_usuario` enum) — sigue usándose para etiquetas y algunos atajos; el RPC `has_permiso` usa **`usuario_rol`** + **`usuario_permiso`** dentro del tenant del JWT.
- Documentación general de auth y flujos: [autenticacion.md](./autenticacion.md)
- ERD y migraciones: [base-de-datos.md](./base-de-datos.md)
