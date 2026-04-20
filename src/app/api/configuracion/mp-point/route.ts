import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { encriptarCampo } from '@/lib/facturacion/arca/crypto';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET() {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  const { data, error } = await loadMpPointConfig(session.supabase, session.tenantId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({
      habilitado: false,
      device_id: null,
      access_token_configurado: false,
      access_token_preview: null,
      webhook_secret_configurado: false,
    });
  }

  let preview: string | null = null;
  if (data.access_token) {
    const plain = decryptAccessToken(data.access_token);
    if (plain && plain.length >= 4) {
      preview = `…${plain.slice(-4)}`;
    } else if (data.access_token.length >= 4) {
      preview = `…${data.access_token.slice(-4)}`;
    }
  }

  return NextResponse.json({
    habilitado: data.habilitado,
    device_id: data.device_id,
    access_token_configurado: Boolean(data.access_token),
    access_token_preview: preview,
    webhook_secret_configurado: Boolean(data.webhook_secret?.trim()),
  });
}

interface PatchBody {
  access_token?: string;
  device_id?: string | null;
  webhook_secret?: string;
  habilitado?: boolean;
}

export async function PATCH(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { data: existing } = await session.supabase
    .from('mp_point_config')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  const updateRow: Record<string, unknown> = {};

  if (body.habilitado !== undefined) {
    updateRow.habilitado = Boolean(body.habilitado);
  }
  if (body.device_id !== undefined) {
    updateRow.device_id = body.device_id === '' || body.device_id === null ? null : body.device_id;
  }
  if (body.access_token !== undefined && body.access_token !== '') {
    updateRow.access_token = encriptarCampo(body.access_token.trim());
  }
  if (body.webhook_secret !== undefined) {
    updateRow.webhook_secret =
      body.webhook_secret === '' || body.webhook_secret === null ? null : body.webhook_secret.trim();
  }

  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ ok: true });
  }

  if (existing?.id) {
    const { error } = await session.supabase
      .from('mp_point_config')
      .update(updateRow as never)
      .eq('tenant_id', session.tenantId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await session.supabase.from('mp_point_config').insert({
      tenant_id: session.tenantId,
      habilitado: (updateRow.habilitado as boolean) ?? false,
      access_token: (updateRow.access_token as string) ?? null,
      device_id: (updateRow.device_id as string) ?? null,
      webhook_secret: (updateRow.webhook_secret as string) ?? null,
    } as never);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
