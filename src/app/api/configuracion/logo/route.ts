import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';

const BUCKET = 'tenant-logos';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

function extForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  if (session.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo el administrador puede cambiar el logo' },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
  }

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED.has(mime)) {
    return NextResponse.json(
      { error: 'Formato no permitido. Usá PNG, JPG o WebP.' },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'El archivo supera 2 MB' },
      { status: 400 },
    );
  }

  const ext = extForMime(mime);
  const path = `${session.tenantId}/logo.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await session.supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: mime, upsert: true });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  const stale = ['png', 'jpg', 'webp']
    .map((e) => `${session.tenantId}/logo.${e}`)
    .filter((p) => p !== path);
  if (stale.length) {
    await session.supabase.storage.from(BUCKET).remove(stale);
  }

  const { data: pub } = session.supabase.storage.from(BUCKET).getPublicUrl(path);
  const logoUrl = pub.publicUrl;

  const { data: tenant, error: upTenant } = await session.supabase
    .from('tenant')
    .update({ logo_url: logoUrl })
    .eq('id', session.tenantId)
    .select('logo_url')
    .single();

  if (upTenant || !tenant) {
    return NextResponse.json(
      { error: upTenant?.message ?? 'No se pudo guardar la URL del logo' },
      { status: 400 },
    );
  }

  return NextResponse.json({ logo_url: tenant.logo_url });
}

export async function DELETE() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  if (session.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo el administrador puede quitar el logo' },
      { status: 403 },
    );
  }

  const prefixes = ['png', 'jpg', 'jpeg', 'webp'].map(
    (e) => `${session.tenantId}/logo.${e}`,
  );

  await session.supabase.storage.from(BUCKET).remove(prefixes);

  const { error: upTenant } = await session.supabase
    .from('tenant')
    .update({ logo_url: null })
    .eq('id', session.tenantId);

  if (upTenant) {
    return NextResponse.json({ error: upTenant.message }, { status: 400 });
  }

  return NextResponse.json({ logo_url: null });
}
