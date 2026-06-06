import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetActiveBranchDto {
  @ApiProperty({ description: 'UUID de la sucursal operativa' })
  @IsUUID()
  sucursalId: string;
}
