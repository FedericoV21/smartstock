-- Si ya se aplicó la versión anterior de 126, puede existir una segunda firma de
-- `producto_ids_pagina_filtrar_proveedores` (11 args). Eso rompe PostgREST al elegir
-- la función RPC. Esta migración elimina solo esa firma; la de 8 args (125) y
-- `producto_ids_pagina_filtrar_proveedores_ext` (126) no se tocan.

DROP FUNCTION IF EXISTS public.producto_ids_pagina_filtrar_proveedores(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[], uuid, text, uuid[]
);
