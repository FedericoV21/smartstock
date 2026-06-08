import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { encriptarCampo } from '@/lib/facturacion/arca/crypto';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
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

  const { data, error } = await loadMpPointConfig(session.supabase, session.tenantId, sucursalScope.sucursalId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!data) {
    const empty = {
      habilitado: true,
      device_id: null,
      access_token_configurado: false,
      access_token_preview: null,
      webhook_secret_configurado: false,
    };
    if (session.rol !== 'admin') {
      return NextResponse.json({
        habilitado: empty.habilitado,
        device_id: empty.device_id,
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
      device_id: data.device_id,
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
    .from('mp_point_config')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId)
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
      .eq('tenant_id', session.tenantId)
      .eq('sucursal_id', sucursalScope.sucursalId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await session.supabase.from('mp_point_config').insert({
      tenant_id: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      habilitado: (updateRow.habilitado as boolean) ?? true,
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

/** Elimina la fila de configuración Point para el tenant y la sucursal operativa (token, terminal, webhook). */
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
    .from('mp_point_config')
    .delete()
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
