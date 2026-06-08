ALTER TYPE public.origen_precio ADD VALUE IF NOT EXISTS 'despiece';

INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('despiece.ver', 'despiece', 'Ver plantillas de despiece y calcular precios'),
  ('despiece.editar', 'despiece', 'Crear y editar plantillas de despiece'),
  ('despiece.aplicar_precios', 'despiece', 'Aplicar una estrategia de pricing al catálogo')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN ('despiece.ver')
WHERE lower(r.slug) IN ('superadmin', 'admin', 'cajero', 'visor')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN ('despiece.editar', 'despiece.aplicar_precios')
WHERE lower(r.slug) IN ('superadmin', 'admin')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
