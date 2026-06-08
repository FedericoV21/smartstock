/** Base MIME sin parámetros (p. ej. `audio/ogg; codecs=opus` → `audio/ogg`). */
function normalizeMime(mime: string | null | undefined): string {
  const raw = (mime ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.split(';')[0]?.trim() ?? '';
}

export function resolveWhatsAppJobRoute(mimeType: string | null | undefined) {
  const mime = normalizeMime(mimeType);
  if (
    mime === 'application/pdf' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    mime === 'image/heic' ||
    mime === 'image/heif'
  ) {
    return { flow: 'lector_facturas' as const, documentType: 'factura_media' as const };
  }

  if (
    mime === 'text/csv' ||
    mime === 'application/csv' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return { flow: 'importador' as const, documentType: 'lista_spreadsheet' as const };
  }

  if (
    mime === 'audio/ogg' ||
    mime === 'audio/opus' ||
    mime === 'audio/mpeg' ||
    mime === 'audio/mp3' ||
    mime === 'audio/mp4' ||
    mime === 'audio/wav' ||
    mime === 'audio/webm' ||
    mime === 'audio/x-wav'
  ) {
    return { flow: 'audio_transcription' as const, documentType: 'voice_note' as const };
  }

  return { flow: 'unsupported' as const, documentType: 'unsupported' as const };
}
