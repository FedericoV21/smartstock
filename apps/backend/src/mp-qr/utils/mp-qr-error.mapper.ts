import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

import { MpQrError } from '../errors/mp-qr.error';

export function mapMpQrErrorToHttpException(err: unknown): HttpException {
  if (err instanceof MpQrError) {
    if (err.status === 401) {
      return new HttpException(
        { error: 'Token de MP inválido o vencido', mp_error_code: err.code },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (err.status === 409 || /orden activa|in_use|occupied/i.test(err.message)) {
      return new HttpException(
        { error: 'Hay una venta en curso en esta caja, esperá o cancelala' },
        HttpStatus.CONFLICT,
      );
    }
    const status = err.status >= 500 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.SERVICE_UNAVAILABLE;
    return new HttpException(
      { error: err.message || 'Error de Mercado Pago QR', mp_error_code: err.code },
      status,
    );
  }
  return new ServiceUnavailableException('Error al comunicarse con Mercado Pago QR');
}
