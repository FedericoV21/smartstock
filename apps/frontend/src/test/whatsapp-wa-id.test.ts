import { describe, expect, it } from 'vitest';

import { waIdsMatch, canonicalWaId, waIdLookupVariants } from '@/lib/whatsapp/otp';

describe('whatsapp wa id normalization', () => {
  it('canonicaliza moviles argentinos al prefijo 549', () => {
    expect(canonicalWaId('543816285231')).toBe('5493816285231');
    expect(canonicalWaId('5493816285231')).toBe('5493816285231');
  });

  it('considera equivalentes formatos 54 y 549', () => {
    expect(waIdsMatch('543816285231', '5493816285231')).toBe(true);
    expect(waIdLookupVariants('5493816285231')).toContain('543816285231');
  });
});
