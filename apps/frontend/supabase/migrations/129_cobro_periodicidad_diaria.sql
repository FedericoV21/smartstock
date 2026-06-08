-- Periodicidad diaria para cuenta corriente en modalidad periódico (vencimiento +1 día desde la emisión).

ALTER TYPE public.cobro_periodicidad ADD VALUE IF NOT EXISTS 'diaria';
