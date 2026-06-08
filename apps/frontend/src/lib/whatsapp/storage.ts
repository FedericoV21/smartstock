function safeName(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').trim();
  if (!n) return fallback;
  return n.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function bucketForMime(mime: string | null | undefined): 'facturas-recibidas' | 'listas-precios' {
  const m = (mime ?? '').toLowerCase().trim();
  if (m === 'application/pdf' || m.startsWith('image/')) return 'facturas-recibidas';
  return 'listas-precios';
}

function folderForMime(mime: string | null | undefined): string {
  const m = (mime ?? '').toLowerCase().trim();
  if (m === 'application/pdf' || m.startsWith('image/')) return 'whatsapp/facturas';
  return 'whatsapp/listas';
}

export async function uploadWhatsAppAttachmentToStorage(params: {
  db: any;
  tenantId: string;
  bytes: ArrayBuffer;
  mimeType: string | null;
  filename: string | null;
}) {
  const { db, tenantId, bytes, mimeType, filename } = params;
  const bucket = bucketForMime(mimeType);
  const folder = folderForMime(mimeType);
  const name = safeName(filename, 'whatsapp-file');
  const path = `${tenantId}/${folder}/${Date.now()}_${name}`;

  const { error } = await db.storage.from(bucket).upload(path, Buffer.from(bytes), {
    contentType: mimeType ?? 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    throw new Error(`Storage upload error: ${error.message}`);
  }

  return { bucket, path };
}
