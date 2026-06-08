import { NextResponse } from 'next/server';
import sharp from 'sharp';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

const BUCKET = 'producto-imagenes';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 256;
const WEBP_QUALITY = 80;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

function storagePath(tenantId: string, productoId: string) {
  return `${tenantId}/${productoId}/preview.webp`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id: productoId } = await params;

  const { data: producto, error: pErr } = await session.supabase
    .from('producto')
    .select('id, tenant_id')
    .eq('id', productoId)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!producto || producto.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
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
    return NextResponse.json({ error: 'El archivo supera 2 MB' }, { status: 400 });
  }

  const raw = Buffer.from(await file.arrayBuffer());

  let webp: Buffer;
  try {
    webp = await sharp(raw)
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    return NextResponse.json(
      { error: 'No se pudo procesar la imagen. Probá con otra foto.' },
      { status: 400 },
    );
  }

  const path = storagePath(session.tenantId, productoId);

  const { error: upErr } = await session.supabase.storage
    .from(BUCKET)
    .upload(path, webp, { contentType: 'image/webp', upsert: true });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  const { data: pub } = session.supabase.storage.from(BUCKET).getPublicUrl(path);
  const imagenUrl = pub.publicUrl;

  const { data: updated, error: upRow } = await session.supabase
    .from('producto')
    .update({ imagen_url: imagenUrl })
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .select('imagen_url')
    .single();

  if (upRow || !updated) {
    return NextResponse.json(
      { error: upRow?.message ?? 'No se pudo guardar la imagen del producto' },
      { status: 400 },
    );
  }

  return NextResponse.json({ imagen_url: updated.imagen_url });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id: productoId } = await params;

  const { data: producto, error: pErr } = await session.supabase
    .from('producto')
    .select('id, tenant_id')
    .eq('id', productoId)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!producto || producto.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const path = storagePath(session.tenantId, productoId);
  await session.supabase.storage.from(BUCKET).remove([path]);

  const { error: upRow } = await session.supabase
    .from('producto')
    .update({ imagen_url: null })
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId);

  if (upRow) {
    return NextResponse.json({ error: upRow.message }, { status: 400 });
  }

  return NextResponse.json({ imagen_url: null });
}
