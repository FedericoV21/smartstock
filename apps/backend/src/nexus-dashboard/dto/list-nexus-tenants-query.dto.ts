import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListNexusTenantsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['1'])
  soloActivos?: string;

  @IsOptional()
  @IsString()
  @IsIn(['1'])
  cicloActivo?: string;

  @IsOptional()
  @IsString()
  @IsIn(['plan0', 'base', 'intermedio', 'completo'])
  plan?: string;
}
