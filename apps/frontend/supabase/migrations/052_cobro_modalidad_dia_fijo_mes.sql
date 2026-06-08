-- Nuevo valor de enum (debe ir en migración aparte: no usar en la misma transacción en PG).
ALTER TYPE public.cobro_modalidad ADD VALUE IF NOT EXISTS 'dia_fijo_mes';
