import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { encriptarCampo } from '@/lib/facturacion/arca/crypto';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET() {
  const guard = await moduloGuard('facturador_arca');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo admin puede acceder' }, { status: 403 });
  }

  const { data: config } = await session.supabase
    .from('arca_config')
    .select('id, cuit_emisor, punto_de_venta, ambiente, ultimo_comprobante, created_at, updated_at')
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  return NextResponse.json({
    config: config
      ? {
          ...config,
          tiene_certificado: true,
          tiene_clave: true,
        }
      : null,
  });
}

interface ConfigBody {
  certificado_pem: string;
  clave_privada_pem: string;
  cuit_emisor: string;
  punto_de_venta: number;
  ambiente: 'homologacion' | 'produccion';
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_arca');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo admin puede acceder' }, { status: 403 });
  }

  let body: ConfigBody;
  try {
    body = (await request.json()) as ConfigBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.cuit_emisor || !body.punto_de_venta) {
    return NextResponse.json(
      { error: 'Faltan campos obligatorios: cuit_emisor, punto_de_venta' },
      { status: 400 },
    );
  }

  if (!['homologacion', 'produccion'].includes(body.ambiente)) {
    return NextResponse.json({ error: 'Ambiente debe ser homologacion o produccion' }, { status: 400 });
  }

  const cuitLimpio = body.cuit_emisor.replace(/[-\s]/g, '');
  if (cuitLimpio.length !== 11 || !/^\d+$/.test(cuitLimpio)) {
    return NextResponse.json({ error: 'CUIT inválido (debe tener 11 dígitos)' }, { status: 400 });
  }

  const { data: existing } = await session.supabase
    .from('arca_config')
    .select('id, ambiente')
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  const isKeepCert = body.certificado_pem === '__KEEP_EXISTING__';
  const isKeepKey = body.clave_privada_pem === '__KEEP_EXISTING__';

  if (!existing && (isKeepCert || isKeepKey || !body.certificado_pem || !body.clave_privada_pem)) {
    return NextResponse.json(
      { error: 'El certificado y la clave privada son obligatorios en la primera configuración' },
      { status: 400 },
    );
  }

  const upsertData: Record<string, unknown> = {
    tenant_id: session.tenantId,
    cuit_emisor: cuitLimpio,
    punto_de_venta: body.punto_de_venta,
    ambiente: body.ambiente,
  };

  if (!isKeepCert && body.certificado_pem) {
    upsertData.certificado_pem = encriptarCampo(body.certificado_pem);
  }
  if (!isKeepKey && body.clave_privada_pem) {
    upsertData.clave_privada_pem = encriptarCampo(body.clave_privada_pem);
  }

  if (existing && existing.ambiente !== body.ambiente) {
    upsertData.ticket_acceso = null;
    upsertData.ticket_sign = null;
    upsertData.ticket_expiracion = null;
  }

  const { error } = await session.supabase
    .from('arca_config')
    .upsert(upsertData as never, { onConflict: 'tenant_id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: 'Configuración ARCA guardada' }, { status: 200 });
}
