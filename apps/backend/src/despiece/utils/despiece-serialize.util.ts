import { DespieceCorte } from '../entities/despiece-corte.entity';
import { DespiecePlantilla } from '../entities/despiece-plantilla.entity';
import { Producto } from '../../products/entities/producto.entity';

function num(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

export function serializeProductoBrief(producto: Producto | null | undefined, extra?: { proveedor_id?: string | null }) {
  if (!producto) return null;
  return {
    id: producto.id,
    nombre: producto.nombre,
    precio_costo: num(producto.precioCosto),
    precio_venta: num(producto.precioVenta),
    unidad: producto.unidad,
    plu: producto.plu ?? null,
    activo: producto.activo,
    es_pesable: producto.esPesable,
    ...(extra?.proveedor_id !== undefined ? { proveedor_id: extra.proveedor_id } : {}),
  };
}

export function serializeCorte(corte: DespieceCorte, productoHijo?: Producto | null) {
  const hijo = productoHijo ?? corte.productoHijo;
  return {
    id: corte.id,
    producto_hijo_id: corte.productoHijoId,
    kg_rendimiento: num(corte.kgRendimiento),
    factor_ajuste_pct: num(corte.factorAjustePct),
    precio_anclado: corte.precioAnclado == null ? null : num(corte.precioAnclado),
    nombre_en_plantilla: corte.nombreEnPlantilla ?? null,
    plu_sugerido: corte.pluSugerido ?? null,
    peso_promedio_unidad_kg:
      corte.pesoPromedioUnidadKg == null ? null : num(corte.pesoPromedioUnidadKg),
    orden: corte.orden,
    producto_hijo: serializeProductoBrief(hijo ?? null),
  };
}

export function serializePlantilla(
  plantilla: DespiecePlantilla,
  productoPadre?: Producto | null,
  cortes?: Array<{ corte: DespieceCorte; productoHijo?: Producto | null }>,
) {
  const padre = productoPadre ?? null;
  return {
    id: plantilla.id,
    nombre: plantilla.nombre,
    producto_padre_id: plantilla.productoPadreId,
    peso_total_kg: num(plantilla.pesoTotalKg),
    unidad_base_tipo: plantilla.unidadBaseTipo,
    unidad_base_nombre: plantilla.unidadBaseNombre,
    unidad_base_cantidad: num(plantilla.unidadBaseCantidad),
    unidad_contenedor_nombre: plantilla.unidadContenedorNombre,
    unidad_contenedor_cantidad:
      plantilla.unidadContenedorCantidad == null ? null : num(plantilla.unidadContenedorCantidad),
    rentabilidad_objetivo_pct:
      plantilla.rentabilidadObjetivoPct == null ? null : num(plantilla.rentabilidadObjetivoPct),
    activo: plantilla.activo,
    notas: plantilla.notas,
    created_at: iso(plantilla.createdAt),
    updated_at: iso(plantilla.updatedAt),
    producto_padre: padre
      ? serializeProductoBrief(padre, { proveedor_id: padre.proveedorId ?? null })
      : null,
    cortes: (cortes ?? []).map(({ corte, productoHijo }) => serializeCorte(corte, productoHijo)),
  };
}

export function serializeProductoCorte(producto: Producto) {
  return {
    id: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    precio_costo: num(producto.precioCosto),
    precio_venta: num(producto.precioVenta),
    unidad: producto.unidad,
    plu: producto.plu ?? null,
    es_pesable: producto.esPesable,
    activo: producto.activo,
  };
}
