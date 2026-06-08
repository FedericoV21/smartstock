import type { Database } from '@/types/database';

import {
  cantidadEnUnidadBase,
  resolverPresentacionCompraImport,
} from '@/lib/producto/presentacion-compra';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

const UNIDADES_LECTOR = [
  'unidad',
  'kg',
  'litro',
  'metro',
  'caja',
  'pack',
  'gramo',
  'ml',
] as const;

/** Coerce texto de unidad leído en factura al enum de stock (misma lista que confirmación importado). */
export function mapUnidadFacturaTexto(s: string | null | undefined): UnidadMedida {
  const raw = (s ?? '').toLowerCase().trim();
  if (!raw) return 'unidad';
  const v = raw.replace(/[.\s]/g, '');
  const alias: Record<string, UnidadMedida> = {
    u: 'unidad',
    un: 'unidad',
    und: 'unidad',
    unidad: 'unidad',
    unidades: 'unidad',
    kg: 'kg',
    kgs: 'kg',
    kilo: 'kg',
    kilos: 'kg',
    gr: 'gramo',
    grs: 'gramo',
    gramo: 'gramo',
    gramos: 'gramo',
    g: 'gramo',
    l: 'litro',
    lt: 'litro',
    lts: 'litro',
    litro: 'litro',
    litros: 'litro',
    ml: 'ml',
    cc: 'ml',
    caja: 'caja',
    cajas: 'caja',
    pack: 'pack',
    packs: 'pack',
    metro: 'metro',
    metros: 'metro',
    mt: 'metro',
    mts: 'metro',
  };
  const mapped = alias[v];
  if (mapped) return mapped;
  return (UNIDADES_LECTOR as readonly string[]).includes(raw)
    ? (raw as UnidadMedida)
    : 'unidad';
}

export function redondearMontoLector2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function textoComboNombreInferencia(descripcionFactura: string, nombreCatalogo: string | null): string {
  const d = descripcionFactura.trim();
  const n = (nombreCatalogo ?? '').trim();
  if (d && n && d !== n) return `${d} · ${n}`;
  return d || n;
}

export type NormalizarLineaLectorParams = {
  descripcion_factura: string;
  nombre_producto_catalogo: string | null;
  unidad_factura: string | null;
  unidad_stock_producto: UnidadMedida;
  cantidad: number;
  precio_unitario: number;
  precio_costo_input: number;
  inferir_pack: boolean;
  presentacion_modo?: 'auto' | 'unidad_base' | 'presentacion_compra';
  contenido_presentacion_compra?: number | null;
  precios_con_iva_incluido: boolean;
  iva_porcentaje: number | null;
  iva_default: number;
};

export type NormalizarLineaLectorResult = {
  cantidad: number;
  precio_unitario: number;
  precio_costo: number;
  aplico_inferencia_pack: boolean;
};

/**
 * Replica la lógica de import Excel para packs/cajas y deriva costo neto cuando el PU viene con IVA incluido.
 * Orden: presentación de compra → neto de costo desde PU bruto.
 */
export function normalizarLineaLectorFactura(p: NormalizarLineaLectorParams): NormalizarLineaLectorResult {
  let cantidad = p.cantidad;
  let pu = p.precio_unitario;
  let pc = p.precio_costo_input;
  let aplico_inferencia_pack = false;

  const textoNombre = textoComboNombreInferencia(p.descripcion_factura, p.nombre_producto_catalogo);
  const glosa = (p.unidad_factura ?? '').trim();
  const modo = p.presentacion_modo ?? 'auto';
  const contenidoCompra = Number(p.contenido_presentacion_compra);

  if (
    modo === 'presentacion_compra' &&
    Number.isFinite(contenidoCompra) &&
    contenidoCompra > 0
  ) {
    cantidad = cantidadEnUnidadBase(cantidad, contenidoCompra);
    pu = redondearMontoLector2(pu / contenidoCompra);
    pc = redondearMontoLector2(pc / contenidoCompra);
    aplico_inferencia_pack = true;
  } else if (modo !== 'unidad_base' && p.inferir_pack && textoNombre.length > 0) {
    const r = resolverPresentacionCompraImport(
      {
        nombre: textoNombre,
        glosaUnidadColumna: glosa.length > 0 ? glosa : undefined,
      },
      p.unidad_stock_producto,
      { aplicarInferenciaPresentacionCompraDesdeNombre: true },
    );
    if (r != null && r.contenido_unidad_compra > 0) {
      cantidad = cantidadEnUnidadBase(cantidad, r.contenido_unidad_compra);
      pu = redondearMontoLector2(pu / r.contenido_unidad_compra);
      pc = redondearMontoLector2(pc / r.contenido_unidad_compra);
      aplico_inferencia_pack = true;
    }
  }

  if (p.precios_con_iva_incluido) {
    const rate = p.iva_porcentaje ?? p.iva_default;
    if (rate > 0 && Number.isFinite(rate)) {
      pc = redondearMontoLector2(pu / (1 + rate / 100));
    }
  }

  return {
    cantidad,
    precio_unitario: pu,
    precio_costo: pc,
    aplico_inferencia_pack,
  };
}
