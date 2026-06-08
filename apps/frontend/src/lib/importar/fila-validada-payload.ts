import type { FilaImportacionPayload } from '@/lib/importar/client-import';
import type { FilaValidada } from '@/lib/normalizador/validar';

export function filaValidadaToPayload(f: FilaValidada): FilaImportacionPayload {
  const d = f.datos;
  return {
    fila_original: f.filaOriginal,
    codigo: d.codigo != null ? String(d.codigo) : null,
    nombre: String(d.nombre ?? ''),
    precio_costo: d.precio_costo as number | null | undefined,
    precio_venta: d.precio_venta as number | null | undefined,
    stock_actual: d.stock_actual as number | null | undefined,
    stock_minimo: d.stock_minimo as number | null | undefined,
    categoria: d.categoria != null ? String(d.categoria) : null,
    unidad: d.unidad != null ? String(d.unidad) : null,
    unidad_compra: d.unidad_compra != null ? String(d.unidad_compra) : null,
    contenido_unidad_compra:
      typeof d.contenido_unidad_compra === 'number' ? d.contenido_unidad_compra : null,
    fecha_vencimiento: d.fecha_vencimiento != null ? String(d.fecha_vencimiento) : null,
    codigo_barras: d.codigo_barras != null ? String(d.codigo_barras) : null,
    rubro: d.rubro != null ? String(d.rubro) : null,
    subrubro: d.subrubro != null ? String(d.subrubro) : null,
    iva_porcentaje: d.iva_porcentaje as number | null | undefined,
    porcentaje_ganancia: d.porcentaje_ganancia as number | null | undefined,
    descuento_costo_pct: d.descuento_costo_pct as number | null | undefined,
    ubicacion: d.ubicacion != null ? String(d.ubicacion) : null,
    moneda: d.moneda != null ? String(d.moneda) : null,
  };
}
