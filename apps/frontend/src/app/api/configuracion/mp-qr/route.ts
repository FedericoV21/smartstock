import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { encriptarCampo } from '@/lib/facturacion/arca/crypto';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;

  const { data, error } = await loadMpQrConfig(session.supabase, session.tenantId, sucursalScope.sucursalId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!data) {
    const empty = {
      habilitado: false,
      user_id: null as string | null,
      external_pos_id: null as string | null,
      access_token_configurado: false,
      access_token_preview: null as string | null,
      webhook_secret_configurado: false,
    };
    if (session.rol !== 'admin') {
      return NextResponse.json({
        habilitado: empty.habilitado,
        user_id: null,
        external_pos_id: null,
        access_token_configurado: false,
        access_token_preview: null,
        webhook_secret_configurado: false,
      });
    }
    return NextResponse.json(empty);
  }

  if (session.rol !== 'admin') {
    return NextResponse.json({
      habilitado: data.habilitado,
      user_id: data.user_id,
      external_pos_id: data.external_pos_id,
      access_token_configurado: false,
      access_token_preview: null,
      webhook_secret_configurado: Boolean(data.webhook_secret?.trim()),
    });
  }

  let preview: string | null = null;
  if (data.access_token) {
    const plain = decryptMpQrAccessToken(data.access_token);
    if (plain && plain.length >= 4) {
      preview = `…${plain.slice(-4)}`;
    } else if (data.access_token.length >= 4) {
      preview = `…${data.access_token.slice(-4)}`;
    }
  }

  return NextResponse.json({
    habilitado: data.habilitado,
    user_id: data.user_id,
    external_pos_id: data.external_pos_id,
    access_token_configurado: Boolean(data.access_token),
    access_token_preview: preview,
    webhook_secret_configurado: Boolean(data.webhook_secret?.trim()),
  });
}

interface PatchBody {
  access_token?: string;
  user_id?: string | null;
  external_pos_id?: string | null;
  webhook_secret?: string | null;
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

  const url = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal activa' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { data: existing } = await session.supabase
    .from('mp_qr_config')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId)
    .maybeSingle();

  const updateRow: Record<string, unknown> = {};

  if (body.habilitado !== undefined) {
    updateRow.habilitado = Boolean(body.habilitado);
  }
  if (body.user_id !== undefined) {
    updateRow.user_id = body.user_id === '' || body.user_id === null ? null : String(body.user_id).trim();
  }
  if (body.external_pos_id !== undefined) {
    updateRow.external_pos_id =
      body.external_pos_id === '' || body.external_pos_id === null
        ? null
        : String(body.external_pos_id).trim();
  }
  if (body.access_token !== undefined && body.access_token !== '') {
    updateRow.access_token = encriptarCampo(body.access_token.trim());
  }
  if (body.webhook_secret !== undefined) {
    updateRow.webhook_secret =
      body.webhook_secret === '' || body.webhook_secret === null ? null : String(body.webhook_secret).trim();
  }

  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ ok: true });
  }

  if (existing?.id) {
    const { error } = await session.supabase
      .from('mp_qr_config')
      .update(updateRow as never)
      .eq('tenant_id', session.tenantId)
      .eq('sucursal_id', sucursalScope.sucursalId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await session.supabase.from('mp_qr_config').insert({
      tenant_id: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      habilitado: (updateRow.habilitado as boolean) ?? false,
      access_token: (updateRow.access_token as string) ?? null,
      user_id: (updateRow.user_id as string) ?? null,
      external_pos_id: (updateRow.external_pos_id as string) ?? null,
      webhook_secret: (updateRow.webhook_secret as string) ?? null,
    } as never);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

/** Elimina la fila de configuración QR para el tenant y la sucursal operativa (token, caja, webhook). */
export async function DELETE(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  const url = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal activa' }, { status: 400 });
  }

  const { error } = await session.supabase
    .from('mp_qr_config')
    .delete()
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
