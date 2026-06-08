import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ConfirmarCobroReservaDto {
  @ApiProperty()
  @IsUUID()
  comprobante_id: string;
}
