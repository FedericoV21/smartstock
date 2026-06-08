import { calcular4Estrategias } from './motor';
import type {
  DespieceCorteInput,
  DespieceInput,
  DespieceResultado,
  DespieceUnidadBaseTipo,
} from './tipos';
import { IVA_DESPIECE } from './constantes';
import { normalizarPlu5 } from '../../products/utils/normalizar-plu';
import { costoDesdePvpConIvaYGanancia } from '../../products/utils/calcular-precio-venta';

export type DespiecePlantillaPayload = {
  nombre: string;
  producto_padre_id: string | null;
  peso_total_kg: number;
  unidad_base_tipo: DespieceUnidadBaseTipo;
  unidad_base_nombre: string | null;
  unidad_base_cantidad: number;
  unidad_contenedor_nombre: string | null;
  unidad_contenedor_cantidad: number | null;
  rentabilidad_objetivo_pct: number | null;
  activo?: boolean;
  notas?: string | null;
  cortes?: DespieceCortePayload[];
};

export type DespieceCortePayload = {
  id?: string;
  producto_hijo_id: string;
  kg_rendimiento: number;
  factor_ajuste_pct?: number;
  precio_anclado?: number | null;
  nombre_en_plantilla?: string | null;
  plu_sugerido?: string | null;
  peso_promedio_unidad_kg?: number | null;
  orden?: number;
};

export type ProductoCorteElegible = {
  id: string;
  nombre?: string | null;
  activo: boolean;
  es_pesable: boolean;
  unidad: string;
};

export type ProductoCatalogoSync = {
  id: string;
  nombre: string;
  precio_costo: number;
  precio_venta: number;
  plu: string | null;
  activo?: boolean;
  es_pesable?: boolean;
  unidad?: string | null;
};

export type CorteCatalogoSync = {
  producto_hijo_id: string;
  nombre_en_plantilla?: string | null;
  precio_anclado?: number | null;
  plu_sugerido?: string | null;
  producto_hijo?: ProductoCatalogoSync | null;
};

export type SolicitudSyncCatalogo = {
  producto_id: string;
  aplicar_nombre?: boolean;
  aplicar_precio?: boolean;
  aplicar_plu?: boolean;
  precio_nuevo?: number | null;
};

export type CambioSyncCatalogo = {
  producto_id: string;
  nombre_actual: string;
  nombre_nuevo?: string;
  precio_costo: number;
  precio_costo_nuevo?: number;
  precio_anterior: number;
  precio_nuevo?: number;
  plu_actual: string | null;
  plu_nuevo?: string;
};

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  const t = text(value);
  return t ? t : null;
}

function nullablePlu(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return normalizarPlu5(value);
}

function unidadBaseTipo(value: unknown): DespieceUnidadBaseTipo {
  return value === 'unidad' ? 'unidad' : 'kg';
}

export function parsePlantillaPayload(body: unknown): DespiecePlantillaPayload {
  const b = readRecord(body);
  const cortesRaw = Array.isArray(b.cortes) ? b.cortes : [];
  const productoPadreRaw = text(b.producto_padre_id);
  const tipo = unidadBaseTipo(b.unidad_base_tipo);
  const unidadBaseCantidad = num(b.unidad_base_cantidad);
  return {
    nombre: text(b.nombre),
    producto_padre_id: productoPadreRaw || null,
    peso_total_kg: num(b.peso_total_kg),
    unidad_base_tipo: tipo,
    unidad_base_nombre: b.unidad_base_nombre == null ? null : text(b.unidad_base_nombre),
    unidad_base_cantidad: Number.isFinite(unidadBaseCantidad) ? unidadBaseCantidad : 1,
    unidad_contenedor_nombre:
      b.unidad_contenedor_nombre == null ? null : text(b.unidad_contenedor_nombre),
    unidad_contenedor_cantidad: nullableNum(b.unidad_contenedor_cantidad),
    rentabilidad_objetivo_pct: nullableNum(b.rentabilidad_objetivo_pct),
    activo: b.activo == null ? undefined : b.activo === true,
    notas: b.notas == null ? null : text(b.notas),
    cortes: cortesRaw.map((item, index) => {
      const c = readRecord(item);
      return {
        id: text(c.id) || undefined,
        producto_hijo_id: text(c.producto_hijo_id),
        kg_rendimiento: num(c.kg_rendimiento),
        factor_ajuste_pct: Number.isFinite(num(c.factor_ajuste_pct))
          ? num(c.factor_ajuste_pct)
          : 0,
        precio_anclado: nullableNum(c.precio_anclado),
        nombre_en_plantilla: nullableText(c.nombre_en_plantilla),
        plu_sugerido: nullablePlu(c.plu_sugerido),
        peso_promedio_unidad_kg: nullableNum(c.peso_promedio_unidad_kg),
        orden: Number.isFinite(num(c.orden)) ? num(c.orden) : index,
      };
    }),
  };
}

export function validarPlantillaPayload(payload: DespiecePlantillaPayload): string | null {
  if (!payload.nombre) return 'El nombre de la plantilla es obligatorio.';
  if (!Number.isFinite(payload.peso_total_kg) || payload.peso_total_kg <= 0) {
    return 'El peso total debe ser mayor a 0.';
  }
  if (payload.unidad_base_tipo === 'unidad') {
    if (!payload.unidad_base_nombre) return 'El nombre de la unidad base es obligatorio.';
    if (!Number.isFinite(payload.unidad_base_cantidad) || payload.unidad_base_cantidad <= 0) {
      return 'La cantidad de la unidad base debe ser mayor a 0.';
    }
    if (
      payload.unidad_contenedor_cantidad != null &&
      (!Number.isFinite(payload.unidad_contenedor_cantidad) || payload.unidad_contenedor_cantidad <= 0)
    ) {
      return 'Las unidades por contenedor deben ser mayores a 0.';
    }
  }
  if (
    payload.rentabilidad_objetivo_pct != null &&
    (!Number.isFinite(payload.rentabilidad_objetivo_pct) || payload.rentabilidad_objetivo_pct < -100)
  ) {
    return 'La rentabilidad objetivo debe ser mayor o igual a -100.';
  }
  const duplicados = validarCortesProductoHijoUnicos(payload.cortes ?? []);
  if (duplicados) return duplicados;
  for (const [index, corte] of (payload.cortes ?? []).entries()) {
    if (!corte.producto_hijo_id) return `El corte ${index + 1} no tiene producto.`;
    if (!Number.isFinite(corte.kg_rendimiento) || corte.kg_rendimiento < 0) {
      return `Los kg del corte ${index + 1} deben ser mayor o igual a 0.`;
    }
    if (!Number.isFinite(corte.factor_ajuste_pct ?? 0) || (corte.factor_ajuste_pct ?? 0) < -1) {
      return `El factor del corte ${index + 1} debe ser mayor o igual a -1.`;
    }
    if (corte.precio_anclado != null && (!Number.isFinite(corte.precio_anclado) || corte.precio_anclado < 0)) {
      return `El precio anclado del corte ${index + 1} debe ser mayor o igual a 0.`;
    }
    if (
      corte.peso_promedio_unidad_kg != null &&
      (!Number.isFinite(corte.peso_promedio_unidad_kg) || corte.peso_promedio_unidad_kg <= 0)
    ) {
      return `El peso promedio del corte ${index + 1} debe ser mayor a 0.`;
    }
  }
  return null;
}

export function validarCortesProductoHijoUnicos(cortes: DespieceCortePayload[]): string | null {
  const vistos = new Set<string>();
  for (const [index, corte] of cortes.entries()) {
    if (!corte.producto_hijo_id) continue;
    if (vistos.has(corte.producto_hijo_id)) {
      return `El corte ${index + 1} usa un producto repetido.`;
    }
    vistos.add(corte.producto_hijo_id);
  }
  return null;
}

export function validarProductosCorteElegibles(
  cortes: DespieceCortePayload[],
  productos: ProductoCorteElegible[],
): string | null {
  const duplicados = validarCortesProductoHijoUnicos(cortes);
  if (duplicados) return duplicados;

  const productosPorId = new Map(productos.map((p) => [p.id, p]));
  for (const [index, corte] of cortes.entries()) {
    if (!corte.producto_hijo_id) continue;
    const producto = productosPorId.get(corte.producto_hijo_id);
    if (!producto) return `El producto del corte ${index + 1} no existe.`;
    if (producto.activo !== true) return `El producto del corte ${index + 1} no esta activo.`;
    if (producto.es_pesable !== true || !['kg', 'gramo'].includes(String(producto.unidad))) {
      return `El producto del corte ${index + 1} debe ser pesable y medir stock en kg o gramo.`;
    }
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function costoCatalogoDesdePrecioVentaDespiece(
  precioVentaConIva: number | null | undefined,
  rentabilidadPct: number | null | undefined,
): number {
  const venta = Number(precioVentaConIva);
  if (!Number.isFinite(venta) || venta <= 0) return 0;

  const rentabilidad = Number(rentabilidadPct);
  const margen = Number.isFinite(rentabilidad) ? rentabilidad : 0;
  if (margen <= -100) return 0;

  return costoDesdePvpConIvaYGanancia(venta, IVA_DESPIECE, IVA_DESPIECE, margen);
}

export function prepararCambiosCatalogoDespiece(
  cortes: CorteCatalogoSync[],
  solicitudes: SolicitudSyncCatalogo[],
  rentabilidadCatalogoPct?: number | null,
): { cambios: CambioSyncCatalogo[]; error: string | null } {
  const cortesPorProducto = new Map(cortes.map((corte) => [corte.producto_hijo_id, corte]));
  const cambios: CambioSyncCatalogo[] = [];
  const solicitudesVistas = new Set<string>();

  for (const solicitud of solicitudes) {
    const productoId = text(solicitud.producto_id);
    if (!productoId) return { cambios: [], error: 'Hay una solicitud sin producto.' };
    if (solicitudesVistas.has(productoId)) {
      return { cambios: [], error: 'Hay productos repetidos en la solicitud de sincronizacion.' };
    }
    solicitudesVistas.add(productoId);

    const corte = cortesPorProducto.get(productoId);
    if (!corte) return { cambios: [], error: 'El producto no pertenece a esta plantilla.' };
    const producto = corte.producto_hijo;
    if (!producto) return { cambios: [], error: 'No se pudo leer el producto enlazado.' };
    if (producto.activo === false) {
      return { cambios: [], error: 'El producto enlazado no esta activo.' };
    }
    if (
      producto.es_pesable === false ||
      (producto.unidad != null && !['kg', 'gramo'].includes(String(producto.unidad)))
    ) {
      return { cambios: [], error: 'El producto enlazado debe ser pesable y medir stock en kg o gramo.' };
    }

    const cambio: CambioSyncCatalogo = {
      producto_id: producto.id,
      nombre_actual: producto.nombre,
      precio_costo: Number(producto.precio_costo),
      precio_anterior: Number(producto.precio_venta),
      plu_actual: producto.plu ?? null,
    };

    if (solicitud.aplicar_nombre) {
      const nombreNuevo = text(corte.nombre_en_plantilla);
      if (nombreNuevo && nombreNuevo !== producto.nombre) cambio.nombre_nuevo = nombreNuevo;
    }

    if (solicitud.aplicar_precio) {
      const precioFuente = solicitud.precio_nuevo ?? corte.precio_anclado;
      if (precioFuente != null) {
        const precioNuevo = round2(Number(precioFuente));
        const costoNuevo = costoCatalogoDesdePrecioVentaDespiece(precioNuevo, rentabilidadCatalogoPct);
        if (Number.isFinite(precioNuevo) && precioNuevo >= 0) {
          cambio.precio_nuevo = precioNuevo;
          cambio.precio_costo_nuevo = costoNuevo;
        }
      }
    }

    if (solicitud.aplicar_plu) {
      const pluNuevo = nullablePlu(corte.plu_sugerido);
      if (pluNuevo && pluNuevo !== (producto.plu ?? null)) cambio.plu_nuevo = pluNuevo;
    }

    if (
      cambio.nombre_nuevo !== undefined ||
      cambio.precio_nuevo !== undefined ||
      cambio.plu_nuevo !== undefined
    ) {
      cambios.push(cambio);
    }
  }

  return { cambios, error: null };
}

export function validarConflictosPluCatalogo(
  cambios: Pick<CambioSyncCatalogo, 'producto_id' | 'plu_nuevo'>[],
  productosConPlu: Array<{ id: string; nombre?: string | null; plu: string | null }>,
): string | null {
  const destinoPorPlu = new Map<string, string>();
  for (const cambio of cambios) {
    if (!cambio.plu_nuevo) continue;
    const existente = destinoPorPlu.get(cambio.plu_nuevo);
    if (existente && existente !== cambio.producto_id) {
      return `El PLU ${cambio.plu_nuevo} esta sugerido para mas de un producto.`;
    }
    destinoPorPlu.set(cambio.plu_nuevo, cambio.producto_id);
  }

  for (const producto of productosConPlu) {
    const plu = producto.plu ?? null;
    if (!plu) continue;
    const destino = destinoPorPlu.get(plu);
    if (destino && destino !== producto.id) {
      return `El PLU ${plu} ya lo usa ${producto.nombre ?? 'otro producto'}.`;
    }
  }

  return null;
}

export type PlantillaConRelaciones = {
  id: string;
  nombre: string;
  producto_padre_id: string | null;
  peso_total_kg: number;
  unidad_base_tipo?: DespieceUnidadBaseTipo | string | null;
  unidad_base_nombre?: string | null;
  unidad_base_cantidad?: number | null;
  unidad_contenedor_nombre?: string | null;
  unidad_contenedor_cantidad?: number | null;
  rentabilidad_objetivo_pct: number | null;
  activo: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string;
  producto_padre?: { id: string; nombre: string; precio_costo: number; precio_venta: number; proveedor_id?: string | null } | null;
  cortes?: Array<{
    id: string;
    producto_hijo_id: string;
    kg_rendimiento: number;
    factor_ajuste_pct: number;
    precio_anclado: number | null;
    nombre_en_plantilla?: string | null;
    plu_sugerido?: string | null;
    peso_promedio_unidad_kg: number | null;
    orden: number;
    producto_hijo?: {
      id: string;
      nombre: string;
      precio_costo: number;
      precio_venta: number;
      unidad: string;
      plu?: string | null;
      activo?: boolean;
      es_pesable?: boolean;
    } | null;
  }>;
};

export function inputDesdePlantilla(
  plantilla: PlantillaConRelaciones,
  costoKgPadre?: number,
): DespieceInput {
  const costo = costoKgPadre ?? Number(plantilla.producto_padre?.precio_costo ?? 0);
  return {
    nombre: plantilla.nombre,
    costoKgPadre: costo,
    pesoTotalKg: Number(plantilla.peso_total_kg),
    rentabilidadObjetivoPct: Number(plantilla.rentabilidad_objetivo_pct ?? 0),
    cortes: (plantilla.cortes ?? [])
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map<DespieceCorteInput>((corte) => ({
        id: corte.producto_hijo_id,
        nombre: corte.nombre_en_plantilla || corte.producto_hijo?.nombre || corte.producto_hijo_id,
        kgRendimiento: Number(corte.kg_rendimiento),
        factorAjustePct: Number(corte.factor_ajuste_pct ?? 0),
        precioAnclado: corte.precio_anclado == null ? null : Number(corte.precio_anclado),
      })),
  };
}

export function calcularDesdePlantilla(
  plantilla: PlantillaConRelaciones,
  costoKgPadre?: number,
): DespieceResultado {
  return calcular4Estrategias(inputDesdePlantilla(plantilla, costoKgPadre));
}

export function esPlantillaPorUnidad(plantilla: Pick<PlantillaConRelaciones, 'unidad_base_tipo'>): boolean {
  return plantilla.unidad_base_tipo === 'unidad';
}

export function cantidadUnidadBasePlantilla(
  plantilla: Pick<PlantillaConRelaciones, 'unidad_base_cantidad'>,
): number {
  const cantidad = Number(plantilla.unidad_base_cantidad ?? 1);
  return Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1;
}

export function nombreUnidadBasePlantilla(
  plantilla: Pick<PlantillaConRelaciones, 'unidad_base_nombre'>,
): string {
  return text(plantilla.unidad_base_nombre) || 'unidades';
}

export function calcularPesoKgDesdeUnidadBase(
  plantilla: Pick<PlantillaConRelaciones, 'peso_total_kg' | 'unidad_base_cantidad'>,
  cantidadUnidadBase: number,
): number {
  const pesoBaseKg = Number(plantilla.peso_total_kg);
  const cantidadBase = cantidadUnidadBasePlantilla(plantilla);
  if (!Number.isFinite(pesoBaseKg) || pesoBaseKg <= 0) {
    throw new Error('La plantilla no tiene peso base valido.');
  }
  if (!Number.isFinite(cantidadUnidadBase) || cantidadUnidadBase <= 0) {
    throw new Error('La cantidad de unidad base debe ser mayor a 0.');
  }
  return (cantidadUnidadBase / cantidadBase) * pesoBaseKg;
}

export function resolverPesoIngresoKgDesdePayload(
  plantilla: PlantillaConRelaciones,
  body: unknown,
): { pesoKg: number; cantidadUnidadBase: number | null } {
  const b = readRecord(body);
  const cantidadDirectaRaw =
    b.cantidad_unidad_base ?? b.unidad_base_cantidad_ingresada ?? b.cantidad_unidades_base;
  const cantidadContenedoresRaw =
    b.cantidad_contenedores ?? b.contenedor_cantidad ?? b.cantidad_contenedor;
  const unidadesPorContenedorRaw =
    b.unidades_por_contenedor ?? b.unidad_contenedor_cantidad ?? plantilla.unidad_contenedor_cantidad;

  if (esPlantillaPorUnidad(plantilla)) {
    const cantidadDirecta =
      cantidadDirectaRaw == null || cantidadDirectaRaw === '' ? NaN : Number(cantidadDirectaRaw);
    if (Number.isFinite(cantidadDirecta)) {
      return {
        pesoKg: calcularPesoKgDesdeUnidadBase(plantilla, cantidadDirecta),
        cantidadUnidadBase: cantidadDirecta,
      };
    }

    const cantidadContenedores =
      cantidadContenedoresRaw == null || cantidadContenedoresRaw === ''
        ? NaN
        : Number(cantidadContenedoresRaw);
    if (Number.isFinite(cantidadContenedores)) {
      const unidadesPorContenedor =
        unidadesPorContenedorRaw == null || unidadesPorContenedorRaw === ''
          ? cantidadUnidadBasePlantilla(plantilla)
          : Number(unidadesPorContenedorRaw);
      if (!Number.isFinite(unidadesPorContenedor) || unidadesPorContenedor <= 0) {
        throw new Error('Las unidades por contenedor deben ser mayores a 0.');
      }
      const cantidadUnidadBase = cantidadContenedores * unidadesPorContenedor;
      return {
        pesoKg: calcularPesoKgDesdeUnidadBase(plantilla, cantidadUnidadBase),
        cantidadUnidadBase,
      };
    }
  }

  const pesoKg = Number(b.peso_ingresado_kg);
  if (!Number.isFinite(pesoKg) || pesoKg <= 0) {
    throw new Error('El peso ingresado debe ser mayor a 0.');
  }
  return { pesoKg, cantidadUnidadBase: null };
}

export function parseCalcularInput(body: unknown): DespieceInput {
  const b = readRecord(body);
  return {
    nombre: typeof b.nombre === 'string' ? b.nombre : undefined,
    costoKgPadre: Number(b.costoKgPadre ?? b.costo_kg_padre),
    pesoTotalKg: Number(b.pesoTotalKg ?? b.peso_total_kg),
    rentabilidadObjetivoPct: Number(b.rentabilidadObjetivoPct ?? b.rentabilidad_objetivo_pct ?? 0),
    cortes: Array.isArray(b.cortes)
      ? b.cortes.map((raw) => {
          const c = readRecord(raw);
          return {
            id: typeof c.id === 'string' ? c.id : undefined,
            nombre: String(c.nombre ?? ''),
            kgRendimiento: Number(c.kgRendimiento ?? c.kg_rendimiento),
            factorAjustePct: Number(c.factorAjustePct ?? c.factor_ajuste_pct ?? 0),
            precioAnclado:
              c.precioAnclado == null && c.precio_anclado == null
                ? null
                : Number(c.precioAnclado ?? c.precio_anclado),
            precioCorreccion:
              c.precioCorreccion == null && c.precio_correccion == null
                ? null
                : Number(c.precioCorreccion ?? c.precio_correccion),
          };
        })
      : [],
  };
}
