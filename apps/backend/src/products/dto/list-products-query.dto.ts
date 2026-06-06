import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseProveedorIds(value: unknown, obj: Record<string, unknown>): string[] | undefined {
  const raw = value ?? obj.proveedor_ids ?? obj.proveedorIds;
  if (raw == null || raw === '') return undefined;
  const parts = Array.isArray(raw)
    ? raw.flatMap((x) => String(x).split(','))
    : String(raw).split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of parts.map((s) => s.trim()).filter(Boolean)) {
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 30) break;
  }
  return out.length > 0 ? out : undefined;
}

function readAliasString(value: unknown, obj: Record<string, unknown>, snakeKey: string): string | undefined {
  const raw = value ?? obj[snakeKey];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

export class ListProductsQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nombre o c├│digo (ILIKE)' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Filtra por c├│digo de barras exacto (tabla producto_barcode o legacy)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(32)
  barcode?: string;

  @ApiPropertyOptional({ description: 'Filtra por categor├¡a (alias: categoria_id)' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => readAliasString(value, obj, 'categoria_id'))
  categoriaId?: string;

  @ApiPropertyOptional({ description: 'Filtra por proveedor principal (alias: proveedor_id)' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => readAliasString(value, obj, 'proveedor_id'))
  proveedorId?: string;

  @ApiPropertyOptional({
    description: 'Lista de proveedores (coma o repetido; alias: proveedor_ids). M├íx. 30.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value, obj }) => parseProveedorIds(value, obj))
  proveedorIds?: string[];

  @ApiPropertyOptional({ description: 'Excluye productos de un proveedor (alias: proveedor_excluir_id)' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => readAliasString(value, obj, 'proveedor_excluir_id'))
  proveedorExcluirId?: string;

  @ApiPropertyOptional({ description: 'Solo productos con stock bajo (alias: stock_bajo=true)' })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.stock_bajo;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  stockBajo?: boolean;

  @ApiPropertyOptional({ description: 'Solo productos con vencimiento en los pr├│ximos 30 d├¡as' })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.vencidos;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  vencidos?: boolean;

  @ApiPropertyOptional({
    description: 'Solo productos inactivos (alias: inactivos=true). Distinto de includeInactive.',
  })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.inactivos;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  onlyInactive?: boolean;

  @ApiPropertyOptional({ description: 'Devuelve solo ids (alias: solo_ids=true)' })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.solo_ids;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  soloIds?: boolean;

  @ApiPropertyOptional({ description: 'Orden por updated_at desc cuando valor es "actualizado"' })
  @IsOptional()
  @IsString()
  orden?: string;

  @ApiPropertyOptional({ description: 'Alcance tenant completo (alias: alcance=tenant)' })
  @IsOptional()
  @IsString()
  alcance?: string;

  @ApiPropertyOptional({ description: 'Sucursal del listado (alias: sucursal_id)' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value, obj }) => readAliasString(value, obj, 'sucursal_id'))
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Incluye variantes activas (alias: incluir_variantes=true)' })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.incluir_variantes;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  incluirVariantes?: boolean;

  @ApiPropertyOptional({
    description: 'Contexto pedidos: alcance tenant usa todas las sucursales activas (alias: contexto_pedidos)',
  })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.contexto_pedidos;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  contextoPedidos?: boolean;

  @ApiPropertyOptional({
    description: 'Contexto promociones: alcance tenant usa todas las sucursales activas (alias: contexto_promociones)',
  })
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.contexto_promociones;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  contextoPromociones?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Alias front: pagina' })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.pagina;
    return raw != null ? Number(raw) : undefined;
  })
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Alias front: por_pagina' })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value, obj }) => {
    const raw = value ?? obj.por_pagina;
    return raw != null ? Number(raw) : undefined;
  })
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ default: false, description: 'Incluye productos con activo = false' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive?: boolean = false;
}
