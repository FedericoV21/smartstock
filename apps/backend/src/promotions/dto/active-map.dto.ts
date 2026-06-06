import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class ActiveMapDto {
  @ApiProperty({ type: [String], maxItems: 400 })
  @IsArray()
  @ArrayMaxSize(400)
  @IsUUID('4', { each: true })
  productoIds!: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
