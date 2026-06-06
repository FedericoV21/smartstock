import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { MpPointError } from '../errors/mp-point.error';

export type MpPointErrorResponseBody = {
  error: string;
  mp_error_code?: string;
  mp_status?: number;
};

/** Mapea `MpPointError` a excepciones HTTP Nest (paridad rutas front). */
export function mapMpPointErrorToHttpException(err: unknown): HttpException {
  if (!(err instanceof MpPointError)) {
    return new ServiceUnavailableException('Error al comunicarse con Mercado Pago Point');
  }

  const mpErr = err;
  const body: MpPointErrorResponseBody = {
    error: mpErr.message,
    mp_error_code: mpErr.code,
    mp_status: mpErr.status,
  };

  if (mpErr.isUnauthorized) {
    return new BadRequestException({
      ...body,
      error: 'Token de MP inv├ílido o vencido',
    });
  }

  if (mpErr.isServerError || mpErr.isDeviceOffline) {
    return new ServiceUnavailableException(body);
  }

  if (mpErr.isStandaloneMode) {
    return new BadRequestException({
      ...body,
      error:
        'La terminal est├í en modo aut├│nomo. Cambiala a modo PDV desde la app de Mercado Pago.',
    });
  }

  return new BadRequestException(body);
}

export function isMpPointError(err: unknown): err is MpPointError {
  return err instanceof MpPointError;
}
