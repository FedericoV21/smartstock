import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { MpPointError } from '../errors/mp-point.error';
import { mapMpPointErrorToHttpException } from './mp-point-error.mapper';

describe('mapMpPointErrorToHttpException', () => {
  it('maps 401 to invalid token message', () => {
    const ex = mapMpPointErrorToHttpException(new MpPointError(401, 'unauthorized', 'Invalid access_token'));
    expect(ex).toBeInstanceOf(BadRequestException);
    expect(ex.getResponse()).toMatchObject({
      error: 'Token de MP inv├ílido o vencido',
      mp_error_code: 'unauthorized',
    });
  });

  it('maps 503 to ServiceUnavailableException', () => {
    const ex = mapMpPointErrorToHttpException(
      new MpPointError(503, 'device_offline', 'Device unavailable'),
    );
    expect(ex).toBeInstanceOf(ServiceUnavailableException);
  });

  it('maps standalone 422 to friendly message', () => {
    const ex = mapMpPointErrorToHttpException(
      new MpPointError(422, 'invalid_operating_mode', 'Operating mode must be PDV'),
    );
    expect(ex).toBeInstanceOf(BadRequestException);
    expect(ex.getResponse()).toMatchObject({
      error: expect.stringContaining('modo aut├│nomo'),
    });
  });

  it('maps unknown errors to 503', () => {
    const ex = mapMpPointErrorToHttpException(new Error('network'));
    expect(ex).toBeInstanceOf(ServiceUnavailableException);
  });
});
