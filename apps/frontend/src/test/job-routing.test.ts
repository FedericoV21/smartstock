import { describe, expect, it } from 'vitest';

import { resolveWhatsAppJobRoute } from '@/lib/whatsapp/job-routing';

describe('resolveWhatsAppJobRoute', () => {
  it('acepta audio/ogg con parámetros de codec (WhatsApp voice notes)', () => {
    const route = resolveWhatsAppJobRoute('audio/ogg; codecs=opus');
    expect(route.flow).toBe('audio_transcription');
    expect(route.documentType).toBe('voice_note');
  });

  it('acepta image/jpeg con parámetros extra', () => {
    const route = resolveWhatsAppJobRoute('image/jpeg; charset=binary');
    expect(route.flow).toBe('lector_facturas');
  });

  it('rechaza mime desconocido', () => {
    const route = resolveWhatsAppJobRoute('application/zip');
    expect(route.flow).toBe('unsupported');
  });
});
