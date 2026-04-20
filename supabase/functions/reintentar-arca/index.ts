import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_REINTENTOS = 3;
const BATCH_SIZE = 10;

interface ArcaConfig {
  tenant_id: string;
  cuit_emisor: string;
  punto_de_venta: number;
  ambiente: 'homologacion' | 'produccion';
  certificado_pem: string;
  clave_privada_pem: string;
}

function getEndpoints(ambiente: 'homologacion' | 'produccion') {
  if (ambiente === 'produccion') {
    return {
      wsaa: 'https://wsaa.afip.gob.ar/ws/services/LoginCms',
      wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    };
  }
  return {
    wsaa: 'https://wsaahomo.afip.gob.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  };
}

const TIPO_COMPROBANTE_ARCA: Record<string, number> = {
  factura_a: 1,
  factura_b: 6,
  factura_c: 11,
  nota_credito_a: 3,
  nota_credito_b: 8,
  nota_credito_c: 13,
};

function mapAlicuotaIVAId(porcentaje: number): number {
  const mapa: Record<number, number> = {
    0: 3, 10.5: 4, 21: 5, 27: 6, 5: 8, 2.5: 9,
  };
  return mapa[porcentaje] ?? 5;
}

function desencriptarCampo(valorEncriptado: string): string {
  // Deno crypto for AES-256-CBC
  const key = Deno.env.get('ARCA_ENCRYPTION_KEY');
  if (!key) throw new Error('ARCA_ENCRYPTION_KEY no configurada');

  const [ivHex, encrypted] = valorEncriptado.split(':');

  // Use Web Crypto API available in Deno
  // For Edge Functions, we use a simpler approach with TextEncoder
  const keyBytes = new TextEncoder().encode(key.padEnd(32, '0').substring(0, 32));
  const iv = hexToBytes(ivHex);
  const encryptedBytes = hexToBytes(encrypted);

  // AES-CBC decrypt using Deno's native crypto
  return aes256CbcDecrypt(keyBytes, iv, encryptedBytes);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function aes256CbcDecryptAsync(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data);
  return new TextDecoder().decode(decrypted);
}

function aes256CbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): string {
  // Sync wrapper - in Edge Functions we'll use async version
  throw new Error('Use aes256CbcDecryptAsync instead');
}

// We'll use the async version in the handler
void aes256CbcDecrypt;
void desencriptarCampo;

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: pendientes } = await supabase
      .from('comprobante')
      .select('*')
      .eq('estado', 'pendiente_arca')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (!pendientes || pendientes.length === 0) {
      return new Response(JSON.stringify({ procesados: 0, mensaje: 'Sin comprobantes pendientes' }));
    }

    let procesados = 0;
    let exitosos = 0;
    let maxReintentos = 0;

    for (const comp of pendientes) {
      const { count } = await supabase
        .from('arca_log')
        .select('*', { count: 'exact', head: true })
        .eq('comprobante_id', comp.id)
        .eq('operacion', 'FECAESolicitar');

      const reintentos = count ?? 0;

      if (reintentos >= MAX_REINTENTOS) {
        await supabase
          .from('comprobante')
          .update({ estado: 'error_arca' })
          .eq('id', comp.id);

        await supabase.from('arca_log').insert({
          tenant_id: comp.tenant_id,
          servicio: 'WSFE',
          operacion: 'reintentar_arca',
          comprobante_id: comp.id,
          exitoso: false,
          error_codigo: 'MAX_REINTENTOS',
          error_mensaje: `Se agotaron los ${MAX_REINTENTOS} reintentos`,
        });

        maxReintentos++;
        procesados++;
        continue;
      }

      // Obtener config ARCA del tenant
      const { data: arcaConfig } = await supabase
        .from('arca_config')
        .select('*')
        .eq('tenant_id', comp.tenant_id)
        .single();

      if (!arcaConfig || !arcaConfig.cuit_emisor || !arcaConfig.punto_de_venta) {
        procesados++;
        continue;
      }

      // Obtener cliente del comprobante
      const { data: cliente } = await supabase
        .from('cliente')
        .select('cuit_dni')
        .eq('id', comp.cliente_id)
        .single();

      try {
        // Asegurar ticket vigente
        let token = arcaConfig.ticket_acceso;
        let sign = arcaConfig.ticket_sign;
        const expiracion = arcaConfig.ticket_expiracion ? new Date(arcaConfig.ticket_expiracion) : null;
        const ahora = new Date();
        const margen = 5 * 60 * 1000;

        if (!token || !expiracion || expiracion.getTime() - ahora.getTime() <= margen) {
          // Necesita renovar ticket - desencriptar cert y key
          const encKey = Deno.env.get('ARCA_ENCRYPTION_KEY')!;
          const keyBytes = new TextEncoder().encode(encKey.padEnd(32, '0').substring(0, 32));

          const [certIv, certEnc] = arcaConfig.certificado_pem!.split(':');
          const certPem = await aes256CbcDecryptAsync(keyBytes, hexToBytes(certIv), hexToBytes(certEnc));

          const [keyIv, keyEnc] = arcaConfig.clave_privada_pem!.split(':');
          const privKeyPem = await aes256CbcDecryptAsync(keyBytes, hexToBytes(keyIv), hexToBytes(keyEnc));

          // Call WSAA - simplified for Edge Function (delegamos al endpoint de la app)
          // En producción, se usaría la firma CMS directamente o se llamaría a un endpoint interno
          // Por ahora, si no hay ticket vigente, marcamos para reintento posterior
          void certPem;
          void privKeyPem;

          await supabase.from('arca_log').insert({
            tenant_id: comp.tenant_id,
            servicio: 'WSFE',
            operacion: 'reintentar_arca',
            comprobante_id: comp.id,
            exitoso: false,
            error_codigo: 'TICKET_EXPIRED',
            error_mensaje: 'Ticket WSAA expirado durante reintento. Se reintentará en el próximo ciclo.',
          });

          procesados++;
          continue;
        }

        // Construir y enviar request WSFE
        const tipoComprobante = TIPO_COMPROBANTE_ARCA[comp.tipo] ?? 6;
        const docTipo = cliente?.cuit_dni?.replace(/[-\s]/g, '').length === 11 ? 80 : 99;
        const docNro = cliente?.cuit_dni?.replace(/[-\s]/g, '') ?? '0';
        const fechaFormateada = comp.fecha.replace(/-/g, '');

        const endpoints = getEndpoints(arcaConfig.ambiente);

        const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${arcaConfig.cuit_emisor}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${arcaConfig.punto_de_venta}</ar:PtoVta>
          <ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${docTipo}</ar:DocTipo>
            <ar:DocNro>${docNro}</ar:DocNro>
            <ar:CbteDesde>${comp.numero}</ar:CbteDesde>
            <ar:CbteHasta>${comp.numero}</ar:CbteHasta>
            <ar:CbteFch>${fechaFormateada}</ar:CbteFch>
            <ar:ImpTotal>${comp.total.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${comp.subtotal.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>${comp.iva_monto.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:Iva>
              <ar:AlicIva>
                <ar:Id>${mapAlicuotaIVAId(comp.iva_porcentaje)}</ar:Id>
                <ar:BaseImp>${comp.subtotal.toFixed(2)}</ar:BaseImp>
                <ar:Importe>${comp.iva_monto.toFixed(2)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;

        const response = await fetch(endpoints.wsfe, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
          },
          body: soapBody,
          signal: AbortSignal.timeout(30000),
        });

        const responseXml = await response.text();

        const resultado = responseXml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
        const cae = responseXml.match(/<CAE>(.*?)<\/CAE>/)?.[1] || null;
        const caeVto = responseXml.match(/<CAEFchVto>(.*?)<\/CAEFchVto>/)?.[1] || null;

        const caeVencimiento = caeVto
          ? `${caeVto.substring(0, 4)}-${caeVto.substring(4, 6)}-${caeVto.substring(6, 8)}`
          : null;

        await supabase.from('arca_log').insert({
          tenant_id: comp.tenant_id,
          servicio: 'WSFE',
          operacion: 'FECAESolicitar',
          request_xml: soapBody,
          response_xml: responseXml,
          comprobante_id: comp.id,
          exitoso: resultado === 'A' && !!cae,
        });

        if (resultado === 'A' && cae) {
          await supabase
            .from('comprobante')
            .update({
              cae,
              cae_vencimiento: caeVencimiento,
              estado: 'emitido',
            })
            .eq('id', comp.id);

          exitosos++;
        }
        // If not approved, stays as pendiente_arca for next cycle
      } catch (err) {
        await supabase.from('arca_log').insert({
          tenant_id: comp.tenant_id,
          servicio: 'WSFE',
          operacion: 'FECAESolicitar',
          comprobante_id: comp.id,
          exitoso: false,
          error_codigo: 'NETWORK',
          error_mensaje: err instanceof Error ? err.message : String(err),
        });
      }

      procesados++;
    }

    return new Response(
      JSON.stringify({ procesados, exitosos, maxReintentos }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
