-- Autoriza Realtime Broadcast privado para los canales del POS:
-- `comprobante-{uuid}` usados por Mercado Pago Point y QR.

CREATE OR REPLACE FUNCTION public.realtime_comprobante_topic_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN (SELECT realtime.topic()) ~* '^comprobante-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN substring(
        (SELECT realtime.topic())
        FROM '^comprobante-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
      )::uuid
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.realtime_comprobante_topic_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.realtime_comprobante_topic_id() TO service_role;

DROP POLICY IF EXISTS realtime_pos_comprobante_broadcast_read
  ON realtime.messages;

CREATE POLICY realtime_pos_comprobante_broadcast_read
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.comprobante c
      WHERE c.id = public.realtime_comprobante_topic_id()
        AND c.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS realtime_pos_comprobante_broadcast_send_service
  ON realtime.messages;

CREATE POLICY realtime_pos_comprobante_broadcast_send_service
  ON realtime.messages
  FOR INSERT
  TO service_role
  WITH CHECK (
    realtime.messages.extension = 'broadcast'
    AND public.realtime_comprobante_topic_id() IS NOT NULL
  );
