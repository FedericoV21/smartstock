-- Parte 1/2: el nuevo valor de enum no puede usarse (CHECK, casts, etc.) en la misma
-- transacción en que se agrega (PostgreSQL: 55P04). El resto está en 064_...

ALTER TYPE public.promocion_tipo ADD VALUE IF NOT EXISTS 'combo_precio_fijo';
