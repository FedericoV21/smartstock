-- Permiso explícito por usuario para crear pedidos (Nuevo pedido / POST). Los administradores del tenant no dependen de esta marca.

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS pedidos_puede_crear boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuario.pedidos_puede_crear IS
  'Si es verdadero, el usuario puede crear pedidos (pantalla Nuevo pedido, POST /api/pedidos, convertir presupuesto). Si es falso, no puede crear aunque el rol sea operador u otro (salvo rol admin del tenant o super admin).';
