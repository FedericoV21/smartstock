import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Min } from 'class-validator';

export class MedioPagoOpcionDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cuotas: number;

  @ApiProperty({ description: 'Recargo (+) o descuento (-) en %' })
  @Type(() => Number)
  @IsNumber()
  recargo_porcentaje: number;
}
