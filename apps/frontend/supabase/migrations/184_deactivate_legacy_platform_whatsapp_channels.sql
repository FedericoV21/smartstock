-- El numero central de plataforma ya no debe enrutar por whatsapp_channel legacy.
UPDATE whatsapp_channel wc
SET activa = false,
    updated_at = now()
WHERE wc.activa = true
  AND EXISTS (
    SELECT 1
    FROM whatsapp_platform_channel pc
    WHERE pc.activa = true
      AND pc.phone_number_id = wc.phone_number_id
  );
