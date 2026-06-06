import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import {
  MOTIVO_ANULACION_MAX_LEN,
  MOTIVO_ANULACION_MIN_LEN,
} from '../utils/comprobante-void.rules';

export class VoidComprobanteDto {
  @ApiProperty({
    minLength: MOTIVO_ANULACION_MIN_LEN,
    maxLength: MOTIVO_ANULACION_MAX_LEN,
    example: 'Error de carga en mostrador, se reemiti├│ el ticket.',
  })
  @IsString()
  @MinLength(MOTIVO_ANULACION_MIN_LEN)
  @MaxLength(MOTIVO_ANULACION_MAX_LEN)
  motivo: string;
}
