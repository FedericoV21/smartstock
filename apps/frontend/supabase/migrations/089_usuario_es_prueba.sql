-- Cuentas de QA / internas: no deben mezclarse con clientes reales en listados operativos.
-- Default false: registros y seeds existentes siguen siendo "reales" hasta que marques explícitamente.

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS es_prueba boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuario.es_prueba IS
  'Si true, usuario pensado para pruebas internas. Filtrar en paneles (ej. Nexus); no es un control de autorización por sí solo.';
