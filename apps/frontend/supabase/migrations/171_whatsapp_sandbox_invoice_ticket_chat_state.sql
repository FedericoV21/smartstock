-- Agrega memoria conversacional a tickets de factura del sandbox.
-- Separada de la migracion 170 porque algunos entornos ya pueden tener
-- whatsapp_sandbox_invoice_ticket creado sin esta columna.

BEGIN;

ALTER TABLE public.whatsapp_sandbox_invoice_ticket
  ADD COLUMN IF NOT EXISTS chat_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.whatsapp_sandbox_invoice_ticket.chat_state IS
  'Memoria efimera del flujo conversacional del ticket, por ejemplo ultima busqueda de productos para enlazar por chat.';

COMMIT;
