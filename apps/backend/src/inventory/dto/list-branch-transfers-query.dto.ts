import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListBranchTransfersQueryDto {
  @ApiProperty({ enum: ['pendiente', 'pendientes'] })
  @IsIn(['pendiente', 'pendientes'])
  status: 'pendiente' | 'pendientes';

  @ApiProperty()
  @IsUUID()
  sucursalDestinoId: string;
}

export class PreviewBranchTransferQueryDto {
  @ApiProperty()
  @IsUUID()
  productoId: string;

  @ApiProperty()
  @IsUUID()
  sucursalOrigenId: string;

  @ApiProperty()
  @IsUUID()
  sucursalDestinoId: string;
}
