/** Preferencias para RPC `fusionar_productos` (paridad front). */

export type FusionarOrigen = 'survivor' | 'loser';
export type FusionarStockMinimo = 'survivor' | 'loser' | 'max';
export type FusionarPrecioSucursalOverride = 'survivor' | 'loser' | 'merge';

export type FusionarProductoCamposInput = Partial<{
  precio_costo: FusionarOrigen;
  precio_venta: FusionarOrigen;
  codigo: FusionarOrigen;
  codigo_barras: FusionarOrigen;
  nombre: FusionarOrigen;
  descripcion: FusionarOrigen;
  rubro: FusionarOrigen;
  subrubro: FusionarOrigen;
  ubicacion: FusionarOrigen;
  imagen_url: FusionarOrigen;
  plu: FusionarOrigen;
  es_pesable: FusionarOrigen;
  iva_porcentaje: FusionarOrigen;
  porcentaje_ganancia: FusionarOrigen;
  presentacion_compra: FusionarOrigen;
  fecha_vencimiento: FusionarOrigen;
  stock_minimo: FusionarStockMinimo;
  precio_sucursal_override: FusionarPrecioSucursalOverride;
  // camelCase aliases
  precioCosto: FusionarOrigen;
  precioVenta: FusionarOrigen;
  codigoBarras: FusionarOrigen;
  imagenUrl: FusionarOrigen;
  esPesable: FusionarOrigen;
  ivaPorcentaje: FusionarOrigen;
  porcentajeGanancia: FusionarOrigen;
  presentacionCompra: FusionarOrigen;
  fechaVencimiento: FusionarOrigen;
  stockMinimo: FusionarStockMinimo;
  precioSucursalOverride: FusionarPrecioSucursalOverride;
}>;

const ORIGEN: FusionarOrigen[] = ['survivor', 'loser'];
const STOCK_MIN: FusionarStockMinimo[] = ['survivor', 'loser', 'max'];
const PS_OV: FusionarPrecioSucursalOverride[] = ['survivor', 'loser', 'merge'];

const KEY_ORIGEN = [
  'precio_costo',
  'precio_venta',
  'codigo',
  'codigo_barras',
  'nombre',
  'descripcion',
  'rubro',
  'subrubro',
  'ubicacion',
  'imagen_url',
  'plu',
  'es_pesable',
  'iva_porcentaje',
  'porcentaje_ganancia',
  'presentacion_compra',
  'fecha_vencimiento',
] as const;

export const DEFAULT_FUSIONAR_PRODUCTO_CAMPOS: Record<string, string> = {
  precio_costo: 'survivor',
  precio_venta: 'survivor',
  codigo: 'survivor',
  codigo_barras: 'survivor',
  nombre: 'survivor',
  descripcion: 'survivor',
  rubro: 'survivor',
  subrubro: 'survivor',
  ubicacion: 'survivor',
  imagen_url: 'survivor',
  plu: 'survivor',
  es_pesable: 'survivor',
  iva_porcentaje: 'survivor',
  porcentaje_ganancia: 'survivor',
  presentacion_compra: 'survivor',
  fecha_vencimiento: 'survivor',
  stock_minimo: 'max',
  precio_sucursal_override: 'merge',
};

const CAMEL_TO_SNAKE: Record<string, string> = {
  precioCosto: 'precio_costo',
  precioVenta: 'precio_venta',
  codigoBarras: 'codigo_barras',
  imagenUrl: 'imagen_url',
  esPesable: 'es_pesable',
  ivaPorcentaje: 'iva_porcentaje',
  porcentajeGanancia: 'porcentaje_ganancia',
  presentacionCompra: 'presentacion_compra',
  fechaVencimiento: 'fecha_vencimiento',
  stockMinimo: 'stock_minimo',
  precioSucursalOverride: 'precio_sucursal_override',
};

export function buildFusionarProductoCamposPayload(
  input: FusionarProductoCamposInput | Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out = { ...DEFAULT_FUSIONAR_PRODUCTO_CAMPOS };
  if (input == null || typeof input !== 'object') return out;

  for (const [rawKey, rawV] of Object.entries(input)) {
    if (rawV === undefined) continue;
    const k = CAMEL_TO_SNAKE[rawKey] ?? rawKey;
    const v = String(rawV).trim().toLowerCase();

    if ((KEY_ORIGEN as readonly string[]).includes(k)) {
      if (!ORIGEN.includes(v as FusionarOrigen)) throw new Error(`${k}: usar survivor o loser`);
      out[k] = v;
    } else if (k === 'stock_minimo') {
      if (!STOCK_MIN.includes(v as FusionarStockMinimo)) {
        throw new Error('stock_minimo: survivor, loser o max');
      }
      out[k] = v;
    } else if (k === 'precio_sucursal_override') {
      if (!PS_OV.includes(v as FusionarPrecioSucursalOverride)) {
        throw new Error('precio_sucursal_override: survivor, loser o merge');
      }
      out[k] = v;
    } else {
      throw new Error(`Campo no permitido: ${k}`);
    }
  }
  return out;
}
