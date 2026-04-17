import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Errores de negocio con código estable para el cliente (`backend-nest-api-contracts.md`).
 */
export class DomainException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}
