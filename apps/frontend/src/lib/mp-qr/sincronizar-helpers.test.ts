import { describe, expect, it } from 'vitest';

import { MpQrError } from '@/lib/mp-qr/client';
import { mpQrErrorEsConsultaOrdenNoDisponible } from '@/lib/mp-qr/sincronizar-helpers';

describe('mpQrErrorEsConsultaOrdenNoDisponible', () => {
  it('detecta 403 PolicyAgent', () => {
    expect(
      mpQrErrorEsConsultaOrdenNoDisponible(
        new MpQrError('At least one policy returned UNAUTHORIZED.', 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', 403),
      ),
    ).toBe(true);
  });

  it('detecta 404 y 405', () => {
    expect(mpQrErrorEsConsultaOrdenNoDisponible(new MpQrError('not found', 'x', 404))).toBe(true);
    expect(mpQrErrorEsConsultaOrdenNoDisponible(new MpQrError('405', 'x', 405))).toBe(true);
  });

  it('no confunde 401 con consulta omitida', () => {
    expect(mpQrErrorEsConsultaOrdenNoDisponible(new MpQrError('unauthorized', 'unauthorized', 401))).toBe(false);
  });
});
