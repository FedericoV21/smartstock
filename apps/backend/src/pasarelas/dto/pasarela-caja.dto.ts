import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CajaPasarelasQueryDto {
  @ApiPropertyOptional({ name: 'solo_habilitadas' })
  @IsOptional()
  @IsString()
  solo_habilitadas?: string;
}

export class CajaPasarelaLinkDto {
  @ApiProperty({ name: 'integracion_id' })
  @IsUUID()
  integracion_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  orden?: number;
}

export class PatchCajaPasarelasDto {
  @ApiProperty({ type: [CajaPasarelaLinkDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CajaPasarelaLinkDto)
  pasarelas: CajaPasarelaLinkDto[];
}

export class MpQrPasarelaStoresDto {
  @ApiProperty({ name: 'access_token' })
  @IsString()
  access_token: string;
}

export class MpQrPasarelaSetupDto {
  @ApiProperty({ name: 'sucursal_id' })
  @IsUUID()
  sucursal_id: string;

  @ApiProperty({ name: 'access_token' })
  @IsString()
  access_token: string;

  @ApiProperty({ name: 'store_id' })
  @IsString()
  store_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ enum: ['activa', 'inactiva', 'incompleta'] })
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional({ name: 'webhook_secret' })
  @IsOptional()
  @IsString()
  webhook_secret?: string;

  @ApiPropertyOptional({ name: 'mp_transferencia_habilitada' })
  @IsOptional()
  @IsBoolean()
  mp_transferencia_habilitada?: boolean;
}
