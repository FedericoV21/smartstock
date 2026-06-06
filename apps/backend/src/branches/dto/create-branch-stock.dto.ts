import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateBranchStockDto {
  @ApiProperty({ description: 'Dep├│sito donde habilitar stock del producto' })
  @IsUUID()
  sucursalId: string;
}
