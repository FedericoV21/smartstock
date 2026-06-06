import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';

export class WorkflowTransicionEdgeDto {
  @ApiProperty({ description: 'Alias front: desde_id' })
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.desde_id)
  desdeId: string;

  @ApiProperty({ description: 'Alias front: hacia_id' })
  @IsUUID()
  @Transform(({ value, obj }) => value ?? obj.hacia_id)
  haciaId: string;
}

export class ReplaceWorkflowTransicionesDto {
  @ApiProperty({ type: [WorkflowTransicionEdgeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowTransicionEdgeDto)
  transiciones: WorkflowTransicionEdgeDto[];
}
