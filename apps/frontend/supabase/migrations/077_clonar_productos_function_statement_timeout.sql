-- Margen extra por sentencia: cada RPC procesa pocas filas (tandas desde la API) pero con muchas subconsultas.
ALTER FUNCTION public.clonar_productos_a_sucursal(uuid, uuid, uuid, uuid[]) SET statement_timeout = '120s';

NOTIFY pgrst, 'reload schema';
