import { UnidadMedida } from '../../products/enums/unidad-medida.enum';
import { calcularPrecioVenta } from '../../products/utils/calcular-precio-venta';

import {
  esUnidadCompraValida,
  inferirPresentacionDesdeTexto,
  inferirPresentacionPesoEnvaseDesdeTexto,
} from './inferir-presentacion-desde-texto.util';

type Unidad = UnidadMedida;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type OpcionesResolverPresentacionCompraImport = {
  /**
   * Si es `true`, cuando no hay columnas de UM compra / contenido se infiere desde nombre y glosa de Unidad
   * (caja x 500, x 300 u, caja(100), etc.). Por defecto `false` (mismo criterio que el pesable por nombre).
   */
  aplicarInferenciaPresentacionCompraDesdeNombre?: boolean;
  /**
   * Solo envases por peso (x500gr, x 0,5 kg). Se usa al forzar productos pesables en kg:
   * el costo del archivo se interpreta por envase y se guarda por kg.
   */
  aplicarInferenciaPesoEnvaseDesdeNombre?: boolean;
};

/**
 * Columnas explícitas de importación ganan sobre la inferencia por nombre.
 * Si hay datos parcialmente cargados (solo una columna), no se infiere.
 *
 * `glosaUnidadColumna`: texto crudo de la columna "Unidad" del Excel (ej. "Caja(500 unidades)").
 * Se combina con el nombre para reconocer presentación aunque el detalle esté solo en Unidad.
 */
export function resolverPresentacionCompraImport(
  fila: {
    nombre: string;
    unidad_compra?: string | null;
    contenido_unidad_compra?: number | null;
    glosaUnidadColumna?: string | null;
  },
  unidadStock: Unidad,
  opts?: OpcionesResolverPresentacionCompraImport,
): { unidad_compra: Unidad; contenido_unidad_compra: number } | null {
  const uRaw = fila.unidad_compra;
  const c = fila.contenido_unidad_compra;
  const u = typeof uRaw === 'string' ? uRaw.trim() : '';
  const hasU = u.length > 0;
  const hasC = c != null && !Number.isNaN(Number(c));

  if (hasU && hasC) {
    if (!esUnidadCompraValida(u)) return null;
    const cn = Number(c);
    if (cn <= 0) return null;
    return { unidad_compra: u, contenido_unidad_compra: cn };
  }

  if (hasU || hasC) {
    return null;
  }

  const glosa = (fila.glosaUnidadColumna ?? '').trim();
  const textoCombo = [fila.nombre, glosa].filter((s) => s.length > 0).join(' · ');

  if (
    opts?.aplicarInferenciaPesoEnvaseDesdeNombre === true &&
    (unidadStock === UnidadMedida.kg || unidadStock === UnidadMedida.gramo)
  ) {
    let infPeso = inferirPresentacionPesoEnvaseDesdeTexto(textoCombo, unidadStock);
    if (!infPeso && glosa.length > 0) {
      infPeso = inferirPresentacionPesoEnvaseDesdeTexto(glosa, unidadStock);
    }
    if (infPeso) {
      return {
        unidad_compra: infPeso.unidad_compra,
        contenido_unidad_compra: infPeso.contenido_unidad_compra,
      };
    }
  }

  if (opts?.aplicarInferenciaPresentacionCompraDesdeNombre !== true) {
    return null;
  }

  let inf = inferirPresentacionDesdeTexto(textoCombo, unidadStock);
  if (!inf && glosa.length > 0) {
    inf = inferirPresentacionDesdeTexto(glosa, unidadStock);
  }
  if (!inf) return null;
  return { unidad_compra: inf.unidad_compra, contenido_unidad_compra: inf.contenido_unidad_compra };
}

/** Convierte cantidad en unidad de compra a unidad de stock (base). */
export function cantidadEnUnidadBase(
  cantidadCompra: number,
  contenidoPorCompra: number,
): number {
  if (contenidoPorCompra <= 0) return cantidadCompra;
  return cantidadCompra * contenidoPorCompra;
}

export type CostoPresentacionCompra = {
  costoUnitarioStock: number;
  costoUnidadCompra: number | null;
  costoGuardadoComoUnidadCompra: boolean;
};

export type PreciosPresentacionCompra = CostoPresentacionCompra & {
  precioVentaUnitarioStock: number;
  precioVentaUnidadCompra: number | null;
  precioVentaGuardadoComoUnidadCompra: boolean;
};

export type ResolverCostoPresentacionCompraInput = {
  precioCosto: number | null | undefined;
  precioVenta?: number | null | undefined;
  porcentajeGanancia?: number | null | undefined;
  descuentoCostoPct?: number | null | undefined;
  ivaPorcentaje?: number | null | undefined;
  unidadCompra?: string | null | undefined;
  contenidoUnidadCompra?: number | null | undefined;
};

function diffRelativa(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
}

function tienePresentacionCompra(input: ResolverCostoPresentacionCompraInput): boolean {
  const contenido = Number(input.contenidoUnidadCompra);
  return (
    input.unidadCompra != null &&
    String(input.unidadCompra).trim() !== '' &&
    Number.isFinite(contenido) &&
    contenido > 1
  );
}

function precioVentaDesdeCosto(
  costo: number,
  input: ResolverCostoPresentacionCompraInput,
  ivaDefault: number,
): number {
  const ganancia = input.porcentajeGanancia == null ? 0 : Number(input.porcentajeGanancia);
  const descuento = input.descuentoCostoPct == null ? null : Number(input.descuentoCostoPct);
  const iva = input.ivaPorcentaje == null ? null : Number(input.ivaPorcentaje);
  return calcularPrecioVenta(costo, ganancia, iva, ivaDefault, {
    descuentoCostoPct: descuento,
  });
}

/**
 * En el modelo actual `precio_costo` debe ser por unidad de stock. Algunas filas viejas
 * quedaron con el costo de la caja/pack cuando ya tenian presentacion de compra; esta
 * funcion las interpreta sin volver a multiplicar por el contenido.
 */
export function resolverCostoPresentacionCompra(
  input: ResolverCostoPresentacionCompraInput,
  ivaDefault: number = 21,
): CostoPresentacionCompra {
  const costo = Number(input.precioCosto);
  if (!Number.isFinite(costo) || costo <= 0) {
    return {
      costoUnitarioStock: 0,
      costoUnidadCompra: null,
      costoGuardadoComoUnidadCompra: false,
    };
  }

  const contenido = Number(input.contenidoUnidadCompra);

  if (!tienePresentacionCompra(input)) {
    return {
      costoUnitarioStock: round2(costo),
      costoUnidadCompra: null,
      costoGuardadoComoUnidadCompra: false,
    };
  }

  const venta = Number(input.precioVenta);
  const costoDesdeCompra = round2(costo / contenido);
  let costoGuardadoComoUnidadCompra = false;

  if (Number.isFinite(venta) && venta > 0) {
    const ventaDesdeCostoUnitario = precioVentaDesdeCosto(costo, input, ivaDefault);
    const ventaDesdeCostoCompra = precioVentaDesdeCosto(costoDesdeCompra, input, ivaDefault);
    const diffUnitario = diffRelativa(ventaDesdeCostoUnitario, venta);
    const diffCompra = diffRelativa(ventaDesdeCostoCompra, venta);

    costoGuardadoComoUnidadCompra =
      costo > venta * 1.5 &&
      costoDesdeCompra < venta * 1.5 &&
      diffCompra <= 0.5 &&
      diffUnitario > diffCompra * 3;
  }

  if (costoGuardadoComoUnidadCompra) {
    return {
      costoUnitarioStock: costoDesdeCompra,
      costoUnidadCompra: round2(costo),
      costoGuardadoComoUnidadCompra: true,
    };
  }

  return {
    costoUnitarioStock: round2(costo),
    costoUnidadCompra: round2(costo * contenido),
    costoGuardadoComoUnidadCompra: false,
  };
}

export function resolverPreciosPresentacionCompra(
  input: ResolverCostoPresentacionCompraInput,
  ivaDefault: number = 21,
): PreciosPresentacionCompra {
  const costoInfo = resolverCostoPresentacionCompra(input, ivaDefault);
  const venta = Number(input.precioVenta);
  if (!Number.isFinite(venta) || venta <= 0) {
    return {
      ...costoInfo,
      precioVentaUnitarioStock: 0,
      precioVentaUnidadCompra: null,
      precioVentaGuardadoComoUnidadCompra: false,
    };
  }

  if (!tienePresentacionCompra(input)) {
    return {
      ...costoInfo,
      precioVentaUnitarioStock: round2(venta),
      precioVentaUnidadCompra: null,
      precioVentaGuardadoComoUnidadCompra: false,
    };
  }

  const contenido = Number(input.contenidoUnidadCompra);
  const ventaDesdeCompra = round2(venta / contenido);
  const ventaEsperadaUnit = precioVentaDesdeCosto(
    costoInfo.costoUnitarioStock,
    input,
    ivaDefault,
  );
  const diffCompra = diffRelativa(ventaDesdeCompra, ventaEsperadaUnit);
  const diffUnit = diffRelativa(venta, ventaEsperadaUnit);
  const precioVentaGuardadoComoUnidadCompra =
    costoInfo.costoGuardadoComoUnidadCompra &&
    ventaEsperadaUnit > 0 &&
    venta > ventaEsperadaUnit * 2 &&
    diffCompra < diffUnit &&
    diffCompra <= 0.25;

  if (precioVentaGuardadoComoUnidadCompra) {
    return {
      ...costoInfo,
      precioVentaUnitarioStock: ventaDesdeCompra,
      precioVentaUnidadCompra: round2(venta),
      precioVentaGuardadoComoUnidadCompra: true,
    };
  }

  return {
    ...costoInfo,
    precioVentaUnitarioStock: round2(venta),
    precioVentaUnidadCompra: round2(venta * contenido),
    precioVentaGuardadoComoUnidadCompra: false,
  };
}

export type ProductoConPreciosPresentacionCompra = {
  precio_costo?: number | null;
  precio_venta: number;
  porcentaje_ganancia?: number | null;
  descuento_costo_pct?: number | null;
  iva_porcentaje?: number | null;
  unidad_compra?: string | null;
  contenido_unidad_compra?: number | null;
};

export function normalizarPreciosProductoPresentacionCompra<
  T extends ProductoConPreciosPresentacionCompra,
>(producto: T, ivaDefault: number = 21): T {
  const precios = resolverPreciosPresentacionCompra(
    {
      precioCosto: producto.precio_costo,
      precioVenta: producto.precio_venta,
      porcentajeGanancia: producto.porcentaje_ganancia,
      descuentoCostoPct: producto.descuento_costo_pct,
      ivaPorcentaje: producto.iva_porcentaje,
      unidadCompra: producto.unidad_compra,
      contenidoUnidadCompra: producto.contenido_unidad_compra,
    },
    ivaDefault,
  );

  return {
    ...producto,
    precio_costo: precios.costoUnitarioStock,
    precio_venta: precios.precioVentaUnitarioStock,
  };
}
