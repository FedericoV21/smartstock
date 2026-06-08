ALTER TABLE public.tenant
  ALTER COLUMN business_prefs SET DEFAULT '{"precioCostoSoloSube": false}'::jsonb,
  ALTER COLUMN pos_prefs SET DEFAULT '{"pvpRedondeoCentenasArriba": false, "pvpRedondeoMenores100ADecenas": false}'::jsonb;
