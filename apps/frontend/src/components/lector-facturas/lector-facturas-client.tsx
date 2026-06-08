'use client';

import { CheckCircle2, FileText, Save, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { Input } from '@/components/ui/input';
import { ExtraerFactura, type LectorExtraccionOk } from '@/components/lector-facturas/extraer-factura';
import { LectorFacturasBorradoresPanel } from '@/components/lector-facturas/lector-facturas-borradores-panel';
import {
  calcularImportes,
  importesPreferiendoTotalInformado,
} from '@/lib/facturacion/calcular-importes';
import {
  guardarLectorFacturaBorrador,
  leerLectorFacturaBorrador,
  type LectorFacturaBorradorPayloadV1,
} from '@/lib/lector-facturas/borradores';
import { resolverPresentacionCompraImport } from '@/lib/producto/presentacion-compra';
import {
  mapUnidadFacturaTexto,
  normalizarLineaLectorFactura,
} from '@/lib/lector-facturas/normalizar-linea-lector-factura';
import {
  calcularVencimientoDia,
  proveedorTieneCondicionPagoCargada,
  vencimientoDefaultPersonalizado,
} from '@/lib/cuenta-corriente/pago-proveedor-vencimiento';
import { parsearMontoInputUsuario } from '@/lib/ui/monto-argentino';
import { formatCurrency, hoyEnAR } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';

type PresentacionModoLector = 'auto' | 'unidad_base' | 'presentacion_compra';

type ItemApi = {
  indice: number;
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  unidad_original: string | null;
  /** Unidad de stock del catálogo cuando hay match (para inferencia pack). */
  producto_unidad: string | null;
  producto_unidad_compra: string | null;
  producto_contenido_unidad_compra: number | null;
  presentacion_modo?: PresentacionModoLector;
  precio_unitario: number;
  /** Subtotal según la factura (editable; el total del comprobante prioriza el leído por IA si existe). */
  subtotal: number;
  bonificacion: number | null;
  bonificacion_cantidad: number | null;
  iva_porcentaje: number;
  match: {
    producto_id: string | null;
    confidence: number;
    metodo: string;
    producto_nombre: string | null;
  };
};

type ActualizacionCostoProducto = {
  producto_id: string;
  codigo: string | null;
  nombre: string;
  precio_costo_anterior: number | null;
  precio_costo_nuevo: number;
  precio_venta_anterior: number | null;
  precio_venta_nuevo: number | null;
  variacion_pct: number | null;
};

type CabeceraExtraccion = {
  tipo_comprobante: string;
  letra: string | null;
  punto_venta: number | null;
  numero: number | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
};

/** Partes fiscales extraídas por la IA (editables antes de confirmar). */
type DraftEmisor = {
  razon_social: string;
  cuit: string;
  domicilio: string;
  condicion_iva: string;
  ingresos_brutos: string;
  inicio_actividades: string;
};

type DraftReceptor = {
  razon_social: string;
  cuit_dni: string;
  domicilio: string;
  condicion_iva: string;
};

const EMISOR_VACIO: DraftEmisor = {
  razon_social: '',
  cuit: '',
  domicilio: '',
  condicion_iva: '',
  ingresos_brutos: '',
  inicio_actividades: '',
};

const RECEPTOR_VACIO: DraftReceptor = {
  razon_social: '',
  cuit_dni: '',
  domicilio: '',
  condicion_iva: '',
};

function strCampoIa(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

function formatCostoNullable(v: number | null): string {
  return v == null ? 'Sin costo' : formatCurrency(v);
}

function formatVariacionPct(v: number | null): string {
  if (v == null) return 'nuevo costo';
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function montoInputFactura(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

function parseMontoFacturaInput(v: string): number {
  const n = parsearMontoInputUsuario(v);
  if (n === null || n < 0) return 0;
  return n;
}

function sumaIvaLeida(totales: {
  iva_21?: number | null;
  iva_10_5?: number | null;
  iva_27?: number | null;
} | null | undefined): number | null {
  if (!totales) return null;
  const suma = [totales.iva_21, totales.iva_10_5, totales.iva_27]
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    .reduce((acc, n) => acc + n, 0);
  return suma > 0 ? Math.round(suma * 100) / 100 : null;
}

function ordenarCambiosCosto(cambios: ActualizacionCostoProducto[]): ActualizacionCostoProducto[] {
  return [...cambios].sort((a, b) => {
    const absA =
      a.variacion_pct != null
        ? Math.abs(a.variacion_pct)
        : a.precio_costo_anterior != null
          ? Math.abs(a.precio_costo_nuevo - a.precio_costo_anterior)
          : Number.POSITIVE_INFINITY;
    const absB =
      b.variacion_pct != null
        ? Math.abs(b.variacion_pct)
        : b.precio_costo_anterior != null
          ? Math.abs(b.precio_costo_nuevo - b.precio_costo_anterior)
          : Number.POSITIVE_INFINITY;
    return absB - absA;
  });
}

function contarCambiosCosto(cambios: ActualizacionCostoProducto[]): {
  suben: number;
  bajan: number;
  sinCostoPrevio: number;
} {
  return cambios.reduce(
    (acc, c) => {
      if (c.precio_costo_anterior == null) acc.sinCostoPrevio += 1;
      else if (c.precio_costo_nuevo > c.precio_costo_anterior) acc.suben += 1;
      else if (c.precio_costo_nuevo < c.precio_costo_anterior) acc.bajan += 1;
      return acc;
    },
    { suben: 0, bajan: 0, sinCostoPrevio: 0 },
  );
}

function urlHojaEtiquetasProductos(productoIds: string[]): string {
  const params = new URLSearchParams();
  for (const id of [...new Set(productoIds)]) {
    params.append('agregar', id);
  }
  return `/productos/hoja-etiquetas?${params.toString()}`;
}

function parsePresentacionModoLector(raw: unknown): PresentacionModoLector | null {
  return raw === 'auto' || raw === 'unidad_base' || raw === 'presentacion_compra'
    ? raw
    : null;
}

function presentacionModoDefault(contenidoUnidadCompra: number | null): PresentacionModoLector {
  return contenidoUnidadCompra != null && contenidoUnidadCompra > 1 ? 'unidad_base' : 'auto';
}

function partesDesdePayloadApi(payload: LectorExtraccionOk): {
  emisor: DraftEmisor;
  receptor: DraftReceptor;
} {
  const o = payload as Record<string, unknown>;
  const em =
    o.emisor && typeof o.emisor === 'object' && !Array.isArray(o.emisor)
      ? (o.emisor as Record<string, unknown>)
      : {};
  const rec =
    o.receptor && typeof o.receptor === 'object' && !Array.isArray(o.receptor)
      ? (o.receptor as Record<string, unknown>)
      : {};
  return {
    emisor: {
      razon_social: strCampoIa(em.razon_social),
      cuit: strCampoIa(em.cuit),
      domicilio: strCampoIa(em.domicilio),
      condicion_iva: strCampoIa(em.condicion_iva),
      ingresos_brutos: strCampoIa(em.ingresos_brutos),
      inicio_actividades: strCampoIa(em.inicio_actividades),
    },
    receptor: {
      razon_social: strCampoIa(rec.razon_social),
      cuit_dni: strCampoIa(rec.cuit_dni),
      domicilio: strCampoIa(rec.domicilio),
      condicion_iva: strCampoIa(rec.condicion_iva),
    },
  };
}

function emisorDraftDesdeBorrador(d: LectorFacturaBorradorPayloadV1['draft']['emisor']): DraftEmisor {
  return {
    razon_social: strCampoIa(d.razon_social),
    cuit: strCampoIa(d.cuit),
    domicilio: strCampoIa(d.domicilio),
    condicion_iva: strCampoIa(d.condicion_iva),
    ingresos_brutos: strCampoIa(d.ingresos_brutos),
    inicio_actividades: strCampoIa(d.inicio_actividades),
  };
}

function receptorDraftDesdeBorrador(d: LectorFacturaBorradorPayloadV1['draft']['receptor']): DraftReceptor {
  return {
    razon_social: strCampoIa(d.razon_social),
    cuit_dni: strCampoIa(d.cuit_dni),
    domicilio: strCampoIa(d.domicilio),
    condicion_iva: strCampoIa(d.condicion_iva),
  };
}

function crearProveedorDesdeDraft(d: DraftEmisor): { razon_social: string; cuit: string } | null {
  const rs = d.razon_social.trim();
  const cuit = d.cuit.replace(/\D/g, '');
  if (!rs || cuit.length !== 11) return null;
  return { razon_social: rs, cuit };
}

function crearClienteDesdeDraft(d: DraftReceptor): { razon_social: string; cuit_dni: string } | null {
  const rs = d.razon_social.trim();
  const doc = d.cuit_dni.replace(/\D/g, '');
  if (!rs || doc.length !== 11) return null;
  return { razon_social: rs, cuit_dni: doc };
}

function normalizarItemsApi(raw: unknown[], ivaDefault: number): ItemApi[] {
  return raw.map((row, i) => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const cantidad =
      typeof r.cantidad === 'number' && Number.isFinite(r.cantidad) ? r.cantidad : 0;
    const precio =
      typeof r.precio_unitario === 'number' && Number.isFinite(r.precio_unitario)
        ? r.precio_unitario
        : 0;
    const subtotalRaw =
      typeof r.subtotal === 'number' && Number.isFinite(r.subtotal) ? r.subtotal : cantidad * precio;
    const matchRaw =
      r.match && typeof r.match === 'object' && !Array.isArray(r.match)
        ? (r.match as Record<string, unknown>)
        : {};
    const puRaw = r.producto_unidad;
    const producto_unidad =
      puRaw != null && String(puRaw).trim() !== '' ? String(puRaw).trim() : null;
    const pucRaw = r.producto_unidad_compra;
    const producto_unidad_compra =
      pucRaw != null && String(pucRaw).trim() !== '' ? String(pucRaw).trim() : null;
    const contenidoRaw = r.producto_contenido_unidad_compra;
    const producto_contenido_unidad_compra =
      typeof contenidoRaw === 'number' && Number.isFinite(contenidoRaw) && contenidoRaw > 0
        ? contenidoRaw
        : null;
    const presentacion_modo =
      parsePresentacionModoLector(r.presentacion_modo) ??
      presentacionModoDefault(producto_contenido_unidad_compra);
    const unidadRaw = r.unidad != null ? String(r.unidad).trim() : '';
    const unidad =
      unidadRaw.length > 0
        ? mapUnidadFacturaTexto(unidadRaw)
        : null;
    return {
      indice: typeof r.indice === 'number' ? r.indice : i,
      codigo: r.codigo != null ? String(r.codigo).trim() || null : null,
      descripcion: typeof r.descripcion === 'string' ? r.descripcion : String(r.descripcion ?? ''),
      cantidad,
      unidad,
      unidad_original: unidadRaw.length > 0 ? unidadRaw : null,
      producto_unidad,
      producto_unidad_compra,
      producto_contenido_unidad_compra,
      presentacion_modo,
      precio_unitario: precio,
      subtotal: subtotalRaw,
      bonificacion:
        typeof r.bonificacion === 'number' && Number.isFinite(r.bonificacion) ? r.bonificacion : null,
      bonificacion_cantidad: null,
      iva_porcentaje:
        typeof r.iva_porcentaje === 'number' && Number.isFinite(r.iva_porcentaje)
          ? r.iva_porcentaje
          : ivaDefault,
      match: {
        producto_id: typeof matchRaw.producto_id === 'string' ? matchRaw.producto_id : null,
        confidence: typeof matchRaw.confidence === 'number' ? matchRaw.confidence : 0,
        metodo: typeof matchRaw.metodo === 'string' ? matchRaw.metodo : 'none',
        producto_nombre:
          typeof matchRaw.producto_nombre === 'string' ? matchRaw.producto_nombre : null,
      },
    };
  });
}

type Extraccion = {
  log_id: string;
  iva_default?: number;
  direccion: string;
  cabecera: CabeceraExtraccion;
  proveedor: { id: string; nombre: string } | null;
  cliente: { id: string; nombre: string } | null;
  crear_proveedor: { razon_social: string; cuit: string } | null;
  crear_cliente: { razon_social: string; cuit_dni: string } | null;
  items: ItemApi[];
  totales?: {
    subtotal: number | null;
    iva_21: number | null;
    iva_10_5: number | null;
    iva_27: number | null;
    percepcion_iibb: number | null;
    percepcion_iva: number | null;
    impuesto_interno: number | null;
    otros_impuestos: number | null;
    total: number | null;
  } | null;
  validacion: {
    totales_cuadran: boolean;
    advertencias: string[];
    items_cuadran?: boolean;
    suma_items?: number;
    referencia_items?: number | null;
    diferencia_items?: number | null;
  };
  multipagina?: Record<string, unknown>;
  extracciones_restantes?: number | null;
  observaciones?: string | null;
  condicion_pago?: string | null;
  archivo_nombre?: string;
};

const TIPOS_CONFIRMABLES = new Set([
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito_a',
  'nota_credito_b',
  'nota_credito_c',
  'remito',
  'ticket',
]);

const OPCIONES_TIPO_COMPROBANTE: { value: string; label: string }[] = [
  { value: 'factura_a', label: 'Factura A' },
  { value: 'factura_b', label: 'Factura B' },
  { value: 'factura_c', label: 'Factura C' },
  { value: 'nota_credito_a', label: 'Nota de Crédito A' },
  { value: 'nota_credito_b', label: 'Nota de Crédito B' },
  { value: 'nota_credito_c', label: 'Nota de Crédito C' },
  { value: 'remito', label: 'Remito' },
  { value: 'ticket', label: 'Ticket' },
  { value: 'desconocido', label: 'Otro / desconocido (no confirmable)' },
];

function esTipoComprobanteNotaCredito(tipo: string | null | undefined): boolean {
  return typeof tipo === 'string' && tipo.startsWith('nota_credito');
}
const UMBRAL_BONIFICACION_REPOSICION = 0.000001;
const UNIDAD_FACTURA_OPTS = ['unidad', 'kg', 'litro', 'metro', 'caja', 'pack', 'gramo', 'ml'] as const;

function esLineaBonificacionTabla(item: ItemApi): boolean {
  return Number(item.precio_unitario) <= UMBRAL_BONIFICACION_REPOSICION;
}

function unidadFacturaRequiereContenido(unidad: string | null): boolean {
  const u = mapUnidadFacturaTexto(unidad);
  return u === 'caja' || u === 'pack';
}

function normalizarClaveTextoFactura(texto: string | null): string {
  if (!texto) return '';
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function claveConsolidacionBonificacion(item: ItemApi): string {
  const codigo = (item.codigo ?? '').trim().toLowerCase();
  if (codigo.length > 0) return `codigo:${codigo}`;
  const desc = normalizarClaveTextoFactura(item.descripcion);
  return desc.length > 0 ? `desc:${desc}` : '';
}

function consolidarItemsBonificados(items: ItemApi[]): ItemApi[] {
  const porClave = new Map<string, ItemApi[]>();
  const sinClave: ItemApi[] = [];

  for (const it of items) {
    const clave = claveConsolidacionBonificacion(it);
    if (!clave) {
      sinClave.push({ ...it, bonificacion_cantidad: it.bonificacion_cantidad ?? null });
      continue;
    }
    const bucket = porClave.get(clave) ?? [];
    bucket.push({ ...it, bonificacion_cantidad: it.bonificacion_cantidad ?? null });
    porClave.set(clave, bucket);
  }

  const merged: ItemApi[] = [];
  for (const bucket of porClave.values()) {
    const pagas = bucket.filter((x) => Number(x.precio_unitario) > UMBRAL_BONIFICACION_REPOSICION);
    const bonis = bucket.filter((x) => Number(x.precio_unitario) <= UMBRAL_BONIFICACION_REPOSICION);
    if (pagas.length === 0 || bonis.length === 0) {
      merged.push(...bucket);
      continue;
    }
    const principal = { ...pagas[0]! };
    const cantidadBonificada = bonis.reduce(
      (acc, x) => acc + (Number.isFinite(x.cantidad) ? Math.max(0, x.cantidad) : 0),
      0,
    );
    principal.cantidad = (Number.isFinite(principal.cantidad) ? principal.cantidad : 0) + cantidadBonificada;
    principal.bonificacion_cantidad = (principal.bonificacion_cantidad ?? 0) + cantidadBonificada;
    merged.push(principal, ...pagas.slice(1));
  }

  return [...merged, ...sinClave].map((it, idx) => ({ ...it, indice: idx }));
}

function etiquetaDireccionIa(direccion: string): { titulo: string; detalle: string } {
  switch (direccion) {
    case 'recibida':
      return {
        titulo: 'Parece una compra',
        detalle: 'Documento que recibiste de un proveedor (vos sos el receptor).',
      };
    case 'emitida':
      return {
        titulo: 'Parece una venta',
        detalle: 'Documento emitido por tu negocio (vos sos el emisor).',
      };
    case 'desconocida':
    default:
      return {
        titulo: 'No quedó claro el sentido del comprobante',
        detalle: 'Elegí abajo si es compra o venta y revisá emisor y receptor.',
      };
  }
}

type ProductoHit = {
  id: string;
  codigo: string;
  nombre: string;
  iva_porcentaje?: number | null;
  unidad?: string | null;
  unidad_compra?: string | null;
  contenido_unidad_compra?: number | null;
};

function ProductoMatchPicker({
  vinculadoNombre,
  tieneProductoId,
  codigoDesdeFactura,
  onAsignar,
  onQuitar,
}: {
  vinculadoNombre: string | null;
  tieneProductoId: boolean;
  /** Código leído en la línea de la factura: si hay un solo producto con ese código, se vincula solo. */
  codigoDesdeFactura?: string | null;
  onAsignar: (
    id: string,
    nombre: string,
    ivaPct: number | null,
    unidad: string | null,
    unidadCompra: string | null,
    contenidoUnidadCompra: number | null,
  ) => void;
  onQuitar: () => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductoHit[]>([]);
  const asignarRef = useRef(onAsignar);

  useEffect(() => {
    asignarRef.current = onAsignar;
  }, [onAsignar]);

  useEffect(() => {
    const qt = q.trim();
    if (!qt) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams();
        params.set('q', qt);
        params.set('alcance', 'tenant');
        params.set('pagina', '1');
        params.set('por_pagina', '12');
        const res = await fetch(`/api/productos?${params.toString()}`);
        const j = (await res.json()) as { productos?: ProductoHit[] };
        if (cancelled) return;
        const list = res.ok ? j.productos ?? [] : [];
        if (!tieneProductoId && list.length === 1) {
          const h = list[0];
          if (h.codigo.trim().toLowerCase() === qt.toLowerCase()) {
            asignarRef.current(
              h.id,
              h.nombre,
              h.iva_porcentaje ?? null,
              h.unidad ?? null,
              h.unidad_compra ?? null,
              h.contenido_unidad_compra ?? null,
            );
            setQ('');
            setHits([]);
            return;
          }
        }
        setHits(list);
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, tieneProductoId]);

  /** Al cargar la línea: si el código de la factura identifica un único producto en catálogo, vincular. */
  useEffect(() => {
    if (tieneProductoId) return;
    const c = codigoDesdeFactura?.trim();
    if (!c) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams();
        params.set('q', c);
        params.set('alcance', 'tenant');
        params.set('pagina', '1');
        params.set('por_pagina', '100');
        const res = await fetch(`/api/productos?${params.toString()}`);
        const j = (await res.json()) as { productos?: ProductoHit[] };
        if (!res.ok || cancelled) return;
        const list = j.productos ?? [];
        const norm = c.toLowerCase();
        const exactos = list.filter((p) => p.codigo.trim().toLowerCase() === norm);
        if (exactos.length === 1) {
          const h = exactos[0];
          asignarRef.current(
            h.id,
            h.nombre,
            h.iva_porcentaje ?? null,
            h.unidad ?? null,
            h.unidad_compra ?? null,
            h.contenido_unidad_compra ?? null,
          );
        }
      })();
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tieneProductoId, codigoDesdeFactura]);

  return (
    <div className="min-w-[200px] space-y-1.5">
      {tieneProductoId && vinculadoNombre ? (
        <p className="text-xs font-medium text-emerald-900 dark:text-emerald-200">{vinculadoNombre}</p>
      ) : (
        <p className="text-muted-foreground text-xs">Sin vínculo al catálogo</p>
      )}
      <Input
        className="h-8 text-xs"
        placeholder="Buscar por nombre o código…"
        value={q}
        onChange={(e) => {
          const value = e.target.value;
          setQ(value);
          if (!value.trim()) setHits([]);
        }}
      />
      {hits.length > 0 ? (
        <ul className="bg-background max-h-36 overflow-auto rounded-md border text-xs shadow-sm">
          {hits.map((p) => (
            <li key={p.id} className="border-b last:border-0">
              <button
                type="button"
                className="hover:bg-muted/80 w-full px-2 py-1.5 text-left"
                onClick={() => {
                  onAsignar(
                    p.id,
                    p.nombre,
                    p.iva_porcentaje ?? null,
                    p.unidad ?? null,
                    p.unidad_compra ?? null,
                    p.contenido_unidad_compra ?? null,
                  );
                  setQ('');
                  setHits([]);
                }}
              >
                <span className="font-medium">{p.nombre}</span>
                <span className="text-muted-foreground ml-1">({p.codigo})</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {tieneProductoId ? (
        <button
          type="button"
          className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
          onClick={onQuitar}
        >
          Quitar vínculo
        </button>
      ) : null}
    </div>
  );
}

function esExtraccion(j: LectorExtraccionOk): j is Extraccion {
  return typeof j.log_id === 'string' && Array.isArray(j.items);
}

function observacionesComprobante(obs: string, condicionPago: string): string | null {
  const o = obs.trim();
  const c = condicionPago.trim();
  if (!o && !c) return null;
  if (o && c) return `${o}\n\nCondición de pago (factura): ${c}`;
  if (c) return `Condición de pago (factura): ${c}`;
  return o;
}

type ProveedorOpt = {
  id: string;
  nombre: string;
  condicion_pago_default?: 'contado' | 'dias';
  plazo_pago_dias?: number | null;
};
type PagoModo = 'ya_pagada' | 'pendiente_condicion' | 'pendiente_fecha_custom';
type ClienteOpt = { id: string; nombre: string; razon_social: string | null; activo?: boolean };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function LectorFacturasClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { alert: showAlertModal, confirm: showConfirmModal, ConfirmDialog } = useConfirm();
  const { canEdit } = useDashboardRole();
  const previewSectionRef = useRef<HTMLDivElement>(null);
  const preservarPagoModoBorradorRef = useRef(false);
  const preservarVencCustomBorradorRef = useRef(false);
  const deepLinkBorradorHandled = useRef<string | null>(null);
  const [step, setStep] = useState<'carga' | 'preview'>('carga');
  /** Dentro del preview: 1 = emisor/receptor/cabecera/contraparte; 2 = líneas y montos. */
  const [previewPaso, setPreviewPaso] = useState<1 | 2>(1);
  const [extraccion, setExtraccion] = useState<Extraccion | null>(null);
  const [archivoNombre, setArchivoNombre] = useState('');
  const [draftCabecera, setDraftCabecera] = useState<CabeceraExtraccion | null>(null);
  const [draftEmisor, setDraftEmisor] = useState<DraftEmisor>(EMISOR_VACIO);
  const [draftReceptor, setDraftReceptor] = useState<DraftReceptor>(RECEPTOR_VACIO);
  const [draftItems, setDraftItems] = useState<ItemApi[]>([]);
  const [tipoOperacion, setTipoOperacion] = useState<'compra' | 'venta'>('compra');
  const [proveedorElegidoId, setProveedorElegidoId] = useState<string | null>(null);
  const [clienteElegidoId, setClienteElegidoId] = useState<string | null>(null);
  const [listaProveedores, setListaProveedores] = useState<ProveedorOpt[]>([]);
  const [listaClientes, setListaClientes] = useState<ClienteOpt[]>([]);
  const [incluirCrearProveedor, setIncluirCrearProveedor] = useState(true);
  const [incluirCrearCliente, setIncluirCrearCliente] = useState(true);
  const [actualizarCostos, setActualizarCostos] = useState(true);
  const [afectaStock, setAfectaStock] = useState(true);
  const [inferirPresentacionCompra, setInferirPresentacionCompra] = useState(false);
  const [preciosItemsConIvaIncluido, setPreciosItemsConIvaIncluido] = useState(false);
  const [ivaMontoFactura, setIvaMontoFactura] = useState('');
  const [percepcionIibb, setPercepcionIibb] = useState('');
  const [percepcionIva, setPercepcionIva] = useState('');
  const [impuestoInterno, setImpuestoInterno] = useState('');
  const [afectaCuentaCorriente, setAfectaCuentaCorriente] = useState(true);
  const [pagoModo, setPagoModo] = useState<PagoModo>('pendiente_condicion');
  const [fechaPagoYa, setFechaPagoYa] = useState(hoyEnAR);
  const [tipoPagoYa, setTipoPagoYa] = useState<'efectivo' | 'transferencia' | 'cheque'>('efectivo');
  const [vencCustom, setVencCustom] = useState(hoyEnAR);
  const [loadingConf, setLoadingConf] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);
  const [limite, setLimite] = useState<{
    usadas: number;
    limite: number | null;
    permitido: boolean;
  } | null>(null);

  const refreshLimite = useCallback(async () => {
    try {
      const res = await fetch('/api/lector-facturas/limite');
      const j = (await res.json()) as {
        usadas?: number;
        limite?: number | null;
        permitido?: boolean;
      };
      if (res.ok) {
        const cap = j.limite;
        setLimite({
          usadas: j.usadas ?? 0,
          limite: cap === null ? null : typeof cap === 'number' ? cap : 4,
          permitido: j.permitido ?? true,
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshLimite();
  }, [refreshLimite]);

  useEffect(() => {
    if (step !== 'preview') return;
    const id = window.requestAnimationFrame(() => {
      previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [step, previewPaso]);

  const limpiarPreview = useCallback(() => {
    preservarPagoModoBorradorRef.current = false;
    preservarVencCustomBorradorRef.current = false;
    setStep('carga');
    setPreviewPaso(1);
    setExtraccion(null);
    setDraftCabecera(null);
    setDraftEmisor(EMISOR_VACIO);
    setDraftReceptor(RECEPTOR_VACIO);
    setDraftItems([]);
    setArchivoNombre('');
    setProveedorElegidoId(null);
    setClienteElegidoId(null);
    setIvaMontoFactura('');
    setPercepcionIibb('');
    setPercepcionIva('');
    setImpuestoInterno('');
    setPagoModo('pendiente_condicion');
    setFechaPagoYa(hoyEnAR());
    setTipoPagoYa('efectivo');
    setVencCustom(hoyEnAR());
  }, []);

  const onExtraccionCompleta = useCallback(
    (payload: LectorExtraccionOk, name: string) => {
      if (!esExtraccion(payload)) return;
      preservarPagoModoBorradorRef.current = false;
      preservarVencCustomBorradorRef.current = false;
      setExtraccion(payload);
      setDraftCabecera({ ...payload.cabecera });
      const partes = partesDesdePayloadApi(payload);
      setDraftEmisor(partes.emisor);
      setDraftReceptor(partes.receptor);
      const p = payload as Record<string, unknown>;
      const ivaDef = typeof p.iva_default === 'number' ? p.iva_default : 21;
      setDraftItems(consolidarItemsBonificados(normalizarItemsApi(p.items as unknown[], ivaDef)));
      setIvaMontoFactura(montoInputFactura(sumaIvaLeida(payload.totales)));
      setPercepcionIibb(montoInputFactura(payload.totales?.percepcion_iibb));
      setPercepcionIva(montoInputFactura(payload.totales?.percepcion_iva));
      setImpuestoInterno(
        montoInputFactura(payload.totales?.impuesto_interno ?? payload.totales?.otros_impuestos),
      );
      setArchivoNombre(name);
      setProveedorElegidoId(payload.proveedor?.id ?? null);
      setClienteElegidoId(payload.cliente?.id ?? null);

      // Siempre abrir como compra; la IA sigue mostrando su sugerencia arriba y se puede cambiar a venta en el preview.
      setTipoOperacion('compra');
      setActualizarCostos(true);

      const tipoIni =
        typeof payload.cabecera?.tipo_comprobante === 'string'
          ? payload.cabecera.tipo_comprobante
          : '';
      // Factura A: el PU casi siempre es neto (sin IVA); el IVA va al pie. No dividir el PU.
      // Factura B: a menudo el PU viene con IVA incluido; si aplica, el usuario puede corregir en paso 2.
      setPreciosItemsConIvaIncluido(tipoIni === 'factura_b');
      setInferirPresentacionCompra(false);

      setIncluirCrearProveedor(Boolean(payload.crear_proveedor) && !payload.proveedor);
      setIncluirCrearCliente(Boolean(payload.crear_cliente) && !payload.cliente);
      setPreviewPaso(1);
      setStep('preview');
      setDraftsRefreshKey((v) => v + 1);
    },
    [],
  );

  useEffect(() => {
    if (step !== 'preview') return;
    void (async () => {
      const [pRes, cRes] = await Promise.all([
        fetch('/api/proveedores?estado=todos'),
        fetch('/api/clientes'),
      ]);
      const pJson = (await pRes.json()) as { proveedores?: ProveedorOpt[] };
      const cJson = (await cRes.json()) as { clientes?: ClienteOpt[] };
      if (pRes.ok) setListaProveedores(pJson.proveedores ?? []);
      if (cRes.ok) setListaClientes((cJson.clientes ?? []).filter((c) => c.activo !== false));
    })();
  }, [step]);

  const ivaDefault = extraccion?.iva_default ?? 21;
  const tipoComp = draftCabecera?.tipo_comprobante ?? extraccion?.cabecera.tipo_comprobante ?? 'factura_b';
  const esRemito = tipoComp === 'remito';
  const preciosItemsConIvaIncluidoEfectivo = !esRemito && preciosItemsConIvaIncluido;

  useEffect(() => {
    if (esRemito && preciosItemsConIvaIncluido) {
      setPreciosItemsConIvaIncluido(false);
    }
  }, [esRemito, preciosItemsConIvaIncluido]);

  const presentacionInferidaPorFila = useMemo(
    () =>
      draftItems.map((i) => {
        const unidadStock =
          i.producto_unidad != null && i.producto_unidad.trim() !== ''
            ? mapUnidadFacturaTexto(i.producto_unidad)
            : mapUnidadFacturaTexto(i.unidad);
        return resolverPresentacionCompraImport(
          {
            nombre: i.descripcion ?? '',
            unidad_compra: i.producto_unidad_compra,
            contenido_unidad_compra: i.producto_contenido_unidad_compra,
            glosaUnidadColumna: i.unidad,
          },
          unidadStock,
          { aplicarInferenciaPresentacionCompraDesdeNombre: true },
        );
      }),
    [draftItems],
  );

  const lineasParaImportes = useMemo(() => {
    return draftItems.map((i, idx) => {
      const presInferida = presentacionInferidaPorFila[idx] ?? null;
      const requiereContenidoManual = unidadFacturaRequiereContenido(i.unidad);
      const contenidoPresentacion =
        i.producto_contenido_unidad_compra ??
        (inferirPresentacionCompra || requiereContenidoManual
          ? presInferida?.contenido_unidad_compra ?? null
          : null);
      const presentacionModoEfectivo =
        (i.presentacion_modo ?? 'auto') === 'auto' &&
        contenidoPresentacion != null &&
        contenidoPresentacion > 1
          ? 'presentacion_compra'
          : (i.presentacion_modo ?? 'auto');
      const bonifCant = Math.max(0, Number(i.bonificacion_cantidad ?? 0));
      const cantidadFacturable =
        i.precio_unitario > UMBRAL_BONIFICACION_REPOSICION
          ? Math.max(0, i.cantidad - bonifCant)
          : i.cantidad;
      const unidadStock =
        i.producto_unidad != null && i.producto_unidad.trim() !== ''
          ? mapUnidadFacturaTexto(i.producto_unidad)
          : mapUnidadFacturaTexto(i.unidad);
      const norm = normalizarLineaLectorFactura({
        descripcion_factura: i.descripcion,
        nombre_producto_catalogo: i.match.producto_nombre,
        unidad_factura: i.unidad,
        unidad_stock_producto: unidadStock,
        cantidad: cantidadFacturable,
        precio_unitario: i.precio_unitario,
        precio_costo_input: i.precio_unitario,
        inferir_pack: inferirPresentacionCompra,
        presentacion_modo: presentacionModoEfectivo,
        contenido_presentacion_compra: contenidoPresentacion,
        precios_con_iva_incluido: preciosItemsConIvaIncluidoEfectivo,
        iva_porcentaje: esRemito ? null : i.iva_porcentaje,
        iva_default: ivaDefault,
      });
      return {
        producto_id: i.match.producto_id ?? '_',
        cantidad: norm.cantidad,
        precio_unitario: norm.precio_unitario,
        iva_porcentaje: esRemito ? null : i.iva_porcentaje,
      };
    });
  }, [
    draftItems,
    esRemito,
    inferirPresentacionCompra,
    presentacionInferidaPorFila,
    preciosItemsConIvaIncluidoEfectivo,
    ivaDefault,
  ]);

  const importes = useMemo(() => {
    if (lineasParaImportes.length === 0) return null;
    const preciosNetos = tipoOperacion === 'compra' && !preciosItemsConIvaIncluidoEfectivo;
    return calcularImportes(lineasParaImportes, tipoComp, ivaDefault, preciosNetos);
  }, [lineasParaImportes, tipoComp, ivaDefault, tipoOperacion, preciosItemsConIvaIncluidoEfectivo]);

  const percepciones = useMemo(() => {
    const iibb = parseMontoFacturaInput(percepcionIibb);
    const iva = parseMontoFacturaInput(percepcionIva);
    const interno = parseMontoFacturaInput(impuestoInterno);
    return {
      iibb,
      iva,
      interno,
      total: Math.round((iibb + iva + interno) * 100) / 100,
    };
  }, [percepcionIibb, percepcionIva, impuestoInterno]);

  /** Total impreso en el comprobante según la extracción IA (`totales.total`). */
  const totalLeidoIa = useMemo(() => {
    const t = extraccion?.totales?.total;
    return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : null;
  }, [extraccion]);

  const importesComprobante = useMemo(() => {
    if (!importes) return null;
    const ivaManualActivo = ivaMontoFactura.trim() !== '';
    const ivaManual = ivaManualActivo ? parseMontoFacturaInput(ivaMontoFactura) : null;
    const totalBaseLeido =
      totalLeidoIa != null
        ? Math.max(0, Math.round((totalLeidoIa - percepciones.total) * 100) / 100)
        : null;
    const baseCalculada = importesPreferiendoTotalInformado(importes, totalBaseLeido);
    const base =
      ivaManual != null
        ? {
            ...baseCalculada,
            subtotal:
              totalBaseLeido != null
                ? Math.max(0, Math.round((totalBaseLeido - ivaManual) * 100) / 100)
                : baseCalculada.subtotal,
            iva_monto: ivaManual,
            total:
              totalBaseLeido != null
                ? totalBaseLeido
                : Math.round((baseCalculada.subtotal + ivaManual) * 100) / 100,
          }
        : baseCalculada;
    return {
      ...base,
      total: Math.round((base.total + percepciones.total) * 100) / 100,
    };
  }, [importes, totalLeidoIa, percepciones.total, ivaMontoFactura]);

  const fechaFactYmd = useMemo(() => {
    const t = (draftCabecera?.fecha_emision ?? '').trim();
    if (t.length >= 10) return t.slice(0, 10);
    return hoyEnAR();
  }, [draftCabecera?.fecha_emision]);

  const provSel = useMemo(
    () => listaProveedores.find((p) => p.id === proveedorElegidoId) ?? null,
    [listaProveedores, proveedorElegidoId],
  );

  const canUseCondProveedor = useMemo(() => {
    if (!provSel) return false;
    return proveedorTieneCondicionPagoCargada({
      condicion_pago_default: provSel.condicion_pago_default === 'dias' ? 'dias' : 'contado',
      plazo_pago_dias: provSel.plazo_pago_dias ?? null,
    });
  }, [provSel]);

  const textoVencCondicion = useMemo(() => {
    if (!provSel || !canUseCondProveedor) return '';
    try {
      const { vencimientoDiaYmd } = calcularVencimientoDia({
        estado: 'pendiente_condicion',
        fechaFacturaYmd: fechaFactYmd,
        proveedor: {
          condicion_pago_default: provSel.condicion_pago_default === 'dias' ? 'dias' : 'contado',
          plazo_pago_dias: provSel.plazo_pago_dias ?? null,
        },
      });
      const ar = vencimientoDiaYmd.split('-');
      const label = `${ar[2]}/${ar[1]}/${ar[0]}`;
      if (provSel.condicion_pago_default === 'dias' && provSel.plazo_pago_dias) {
        return `${provSel.nombre} · ${provSel.plazo_pago_dias} días → vence ${label}`;
      }
      return `${provSel.nombre} · contado → vence ${label}`;
    } catch {
      return '';
    }
  }, [provSel, canUseCondProveedor, fechaFactYmd]);

  const mostrarPanelPagoProveedor =
    tipoOperacion === 'compra' &&
    afectaCuentaCorriente &&
    importesComprobante != null &&
    importesComprobante.total > 0;

  useEffect(() => {
    if (step !== 'preview' || !draftCabecera) return;
    if (preservarVencCustomBorradorRef.current) {
      preservarVencCustomBorradorRef.current = false;
      return;
    }
    const fv = draftCabecera.fecha_vencimiento?.trim();
    setVencCustom(
      vencimientoDefaultPersonalizado(fechaFactYmd, fv && fv.length >= 10 ? fv.slice(0, 10) : null),
    );
  }, [step, draftCabecera, fechaFactYmd]);

  useEffect(() => {
    if (step !== 'preview') return;
    if (!proveedorElegidoId || !provSel) return;
    if (preservarPagoModoBorradorRef.current) {
      preservarPagoModoBorradorRef.current = false;
      return;
    }
    if (proveedorTieneCondicionPagoCargada({
      condicion_pago_default: provSel.condicion_pago_default === 'dias' ? 'dias' : 'contado',
      plazo_pago_dias: provSel.plazo_pago_dias ?? null,
    })) {
      setPagoModo('pendiente_condicion');
    } else {
      setPagoModo('pendiente_fecha_custom');
    }
  }, [step, proveedorElegidoId, provSel]);

  const pagoPanelValido =
    !mostrarPanelPagoProveedor ||
    (pagoModo === 'pendiente_condicion' && canUseCondProveedor) ||
    (pagoModo === 'pendiente_fecha_custom' && /^\d{4}-\d{2}-\d{2}$/.test(vencCustom)) ||
    (pagoModo === 'ya_pagada' && /^\d{4}-\d{2}-\d{2}$/.test(fechaPagoYa));

  const itemsSinMatch = draftItems.some((i) => !i.match.producto_id);
  /** En venta sigue siendo obligatorio el match; en compra se da de alta producto con la descripción de la factura. */
  const compraSinNombreParaNuevo = draftItems.some(
    (i) => !i.match.producto_id && !i.descripcion.trim(),
  );
  const bloqueadoPorProducto =
    (tipoOperacion === 'venta' && itemsSinMatch) ||
    (tipoOperacion === 'compra' && compraSinNombreParaNuevo);
  const costosIaDudosos =
    extraccion?.validacion.items_cuadran === false &&
    extraccion.validacion.referencia_items != null;
  const compraConItemsNuevos = tipoOperacion === 'compra' && itemsSinMatch;
  const tipoOk = TIPOS_CONFIRMABLES.has(tipoComp);
  const crearProveedorListo = crearProveedorDesdeDraft(draftEmisor) != null;
  const crearClienteListo = crearClienteDesdeDraft(draftReceptor) != null;
  const faltaProveedorCompra =
    tipoOperacion === 'compra' && !proveedorElegidoId && !(incluirCrearProveedor && crearProveedorListo);
  const faltaClienteVenta =
    tipoOperacion === 'venta' && !clienteElegidoId && !(incluirCrearCliente && crearClienteListo);
  const bloqueadoProveedorCliente = faltaProveedorCompra || faltaClienteVenta;
  const puedeConfirmar =
    canEdit &&
    extraccion &&
    draftCabecera != null &&
    !bloqueadoPorProducto &&
    !bloqueadoProveedorCliente &&
    tipoOk &&
    importesComprobante != null &&
    tipoComp !== 'desconocido' &&
    pagoPanelValido;

  const puedeAvanzarPreviewPaso1 =
    !faltaProveedorCompra && !faltaClienteVenta && tipoOk && tipoComp !== 'desconocido';

  const quedan =
    limite != null && limite.limite != null ? limite.limite - limite.usadas : null;

  const statsLectura = useMemo(() => {
    const total = draftItems.length;
    const vinculados = draftItems.filter((i) => i.match.producto_id).length;
    return { total, vinculados, sinVincular: total - vinculados };
  }, [draftItems]);

  const lineaResumenComprobante = useMemo(() => {
    if (!draftCabecera) return '';
    const tipoLabel =
      OPCIONES_TIPO_COMPROBANTE.find((o) => o.value === draftCabecera.tipo_comprobante)?.label ??
      draftCabecera.tipo_comprobante;
    const pv = draftCabecera.punto_venta;
    const num = draftCabecera.numero;
    const letra = draftCabecera.letra?.trim();
    const partes: string[] = [tipoLabel];
    if (letra) partes.push(`letra ${letra}`);
    if (pv != null && num != null) {
      partes.push(`${String(pv).padStart(4, '0')}-${String(num).padStart(8, '0')}`);
    }
    return partes.join(' · ');
  }, [draftCabecera]);

  const copyDireccionIa = useMemo(
    () => etiquetaDireccionIa(extraccion?.direccion ?? 'desconocida'),
    [extraccion?.direccion],
  );

  function payloadBorradorActual(): LectorFacturaBorradorPayloadV1 | null {
    if (!extraccion || !draftCabecera) return null;
    const direccion = tipoOperacion === 'venta' ? 'emitida' : 'recibida';
    const proveedorSel = proveedorElegidoId
      ? listaProveedores.find((p) => p.id === proveedorElegidoId)
      : null;
    const clienteSel = clienteElegidoId
      ? listaClientes.find((c) => c.id === clienteElegidoId)
      : null;
    const extraccionDraft: LectorFacturaBorradorPayloadV1['extraccion'] = {
      ...extraccion,
      iva_default: extraccion.iva_default ?? 21,
      direccion,
      cabecera: draftCabecera,
      emisor: draftEmisor,
      receptor: draftReceptor,
      proveedor:
        tipoOperacion === 'compra' && proveedorElegidoId
          ? {
              id: proveedorElegidoId,
              nombre:
                proveedorSel?.nombre ??
                (extraccion.proveedor?.id === proveedorElegidoId ? extraccion.proveedor.nombre : 'Proveedor'),
            }
          : null,
      cliente:
        tipoOperacion === 'venta' && clienteElegidoId
          ? {
              id: clienteElegidoId,
              nombre:
                clienteSel?.razon_social ??
                clienteSel?.nombre ??
                (extraccion.cliente?.id === clienteElegidoId ? extraccion.cliente.nombre : 'Cliente'),
            }
          : null,
      crear_proveedor:
        tipoOperacion === 'compra' && !proveedorElegidoId && incluirCrearProveedor
          ? crearProveedorDesdeDraft(draftEmisor)
          : null,
      crear_cliente:
        tipoOperacion === 'venta' && !clienteElegidoId && incluirCrearCliente
          ? crearClienteDesdeDraft(draftReceptor)
          : null,
      items: draftItems,
      totales: extraccion.totales ?? {
        subtotal: null,
        iva_21: null,
        iva_10_5: null,
        iva_27: null,
        percepcion_iibb: null,
        percepcion_iva: null,
        impuesto_interno: null,
        otros_impuestos: null,
        total: null,
      },
      validacion: {
        ...extraccion.validacion,
        items_cuadran: extraccion.validacion.items_cuadran ?? false,
        suma_items: extraccion.validacion.suma_items ?? 0,
        referencia_items: extraccion.validacion.referencia_items ?? null,
        diferencia_items: extraccion.validacion.diferencia_items ?? null,
      },
      condicion_pago: extraccion.condicion_pago ?? null,
      observaciones: extraccion.observaciones ?? null,
      multipagina: extraccion.multipagina ?? {},
      archivo_nombre: archivoNombre || extraccion.archivo_nombre || 'factura',
      extracciones_restantes: extraccion.extracciones_restantes ?? null,
    };

    return {
      version: 1,
      paso: 'preview',
      archivoNombre: archivoNombre || extraccion.archivo_nombre || 'factura',
      previewPaso,
      extraccion: extraccionDraft,
      draft: {
        cabecera: draftCabecera,
        emisor: draftEmisor,
        receptor: draftReceptor,
        items: draftItems,
        tipoOperacion,
        proveedorElegidoId,
        clienteElegidoId,
        incluirCrearProveedor,
        incluirCrearCliente,
        actualizarCostos,
        afectaStock,
        inferirPresentacionCompra,
        preciosItemsConIvaIncluido,
        ivaMontoFactura,
        percepcionIibb,
        percepcionIva,
        impuestoInterno,
        afectaCuentaCorriente,
        pagoModo,
        fechaPagoYa,
        tipoPagoYa,
        vencCustom,
      },
    };
  }

  async function guardarBorradorActual() {
    const payload = payloadBorradorActual();
    if (!payload) return;
    setSavingDraft(true);
    try {
      await guardarLectorFacturaBorrador(payload.extraccion.log_id, payload);
      setDraftsRefreshKey((v) => v + 1);
      toast.success('Borrador guardado');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingDraft(false);
    }
  }

  const onRetomarBorrador = useCallback(async (id: string) => {
    const b = await leerLectorFacturaBorrador(id);
    const p = b.payload;
    const draft = p.draft;
    preservarPagoModoBorradorRef.current = true;
    preservarVencCustomBorradorRef.current = true;
    setExtraccion(p.extraccion as unknown as Extraccion);
    setDraftCabecera({ ...draft.cabecera });
    setDraftEmisor(emisorDraftDesdeBorrador(draft.emisor));
    setDraftReceptor(receptorDraftDesdeBorrador(draft.receptor));
    setDraftItems(
      draft.items.map((it, idx) => ({
        ...it,
        indice: typeof it.indice === 'number' ? it.indice : idx,
        bonificacion_cantidad: it.bonificacion_cantidad ?? null,
        presentacion_modo:
          parsePresentacionModoLector(it.presentacion_modo) ??
          presentacionModoDefault(it.producto_contenido_unidad_compra ?? null),
      })) as ItemApi[],
    );
    setTipoOperacion(draft.tipoOperacion);
    setProveedorElegidoId(draft.proveedorElegidoId);
    setClienteElegidoId(draft.clienteElegidoId);
    setIncluirCrearProveedor(draft.incluirCrearProveedor);
    setIncluirCrearCliente(draft.incluirCrearCliente);
    setActualizarCostos(draft.actualizarCostos);
    setAfectaStock(draft.afectaStock);
    setInferirPresentacionCompra(draft.inferirPresentacionCompra);
    setPreciosItemsConIvaIncluido(draft.preciosItemsConIvaIncluido);
    setIvaMontoFactura(draft.ivaMontoFactura ?? montoInputFactura(sumaIvaLeida(p.extraccion.totales)));
    setPercepcionIibb(draft.percepcionIibb);
    setPercepcionIva(draft.percepcionIva);
    setImpuestoInterno(draft.impuestoInterno ?? '');
    setAfectaCuentaCorriente(draft.afectaCuentaCorriente);
    setPagoModo(draft.pagoModo);
    setFechaPagoYa(draft.fechaPagoYa);
    setTipoPagoYa(draft.tipoPagoYa);
    setVencCustom(draft.vencCustom);
    setArchivoNombre(p.archivoNombre || p.extraccion.archivo_nombre || b.archivo_nombre);
    setPreviewPaso(p.previewPaso);
    setStep('preview');
  }, []);

  useEffect(() => {
    const borradorId = searchParams.get('borrador')?.trim() ?? '';
    if (!borradorId || !UUID_RE.test(borradorId)) return;
    if (deepLinkBorradorHandled.current === borradorId) return;
    deepLinkBorradorHandled.current = borradorId;
    void (async () => {
      try {
        await onRetomarBorrador(borradorId);
        router.replace('/lector-facturas', { scroll: false });
        toast.success('Borrador cargado desde el enlace');
      } catch (e) {
        toast.error((e as Error).message);
      }
    })();
  }, [searchParams, onRetomarBorrador, router]);

  async function confirmar() {
    if (!extraccion || !draftCabecera || !importesComprobante || !puedeConfirmar) return;
    setLoadingConf(true);
    try {
      if (
        costosIaDudosos &&
        actualizarCostos &&
        tipoOperacion === 'compra' &&
        !esTipoComprobanteNotaCredito(tipoComp)
      ) {
        const confirmarCostosDudosos = await showConfirmModal({
          title: 'Costos unitarios a revisar',
          description:
            'La IA pudo cargar la factura, pero marcó que la suma de renglones no coincide con los totales impresos. Confirmá solo si revisaste y corregiste cantidades, precios unitarios y subtotales.',
          confirmLabel: 'Confirmar igual',
          cancelLabel: 'Volver a revisar',
        });
        if (!confirmarCostosDudosos) return;
      }

      const fechaRaw = (draftCabecera.fecha_emision ?? '').trim();
      const fecha =
        fechaRaw.length >= 10
          ? fechaRaw.slice(0, 10)
          : new Date().toISOString().slice(0, 10);

      const direccionConfirmar = tipoOperacion === 'venta' ? 'emitida' : 'recibida';

      const body = {
        log_id: extraccion.log_id,
        direccion: direccionConfirmar,
        proveedor_id: tipoOperacion === 'compra' ? proveedorElegidoId : null,
        cliente_id: tipoOperacion === 'venta' ? clienteElegidoId : null,
        crear_proveedor:
          tipoOperacion === 'compra' && !proveedorElegidoId && incluirCrearProveedor
            ? crearProveedorDesdeDraft(draftEmisor)
            : null,
        crear_cliente:
          tipoOperacion === 'venta' && !clienteElegidoId && incluirCrearCliente
            ? crearClienteDesdeDraft(draftReceptor)
            : null,
        tipo_comprobante: tipoComp,
        tipo_operacion: tipoOperacion,
        fecha,
        punto_venta: draftCabecera.punto_venta,
        numero_documento: draftCabecera.numero,
        cae: draftCabecera.cae?.trim() ? draftCabecera.cae.trim() : null,
        cae_vencimiento: draftCabecera.cae_vencimiento?.trim()
          ? draftCabecera.cae_vencimiento.trim().slice(0, 10)
          : null,
        inferir_presentacion_compra_desde_nombre: inferirPresentacionCompra,
        precios_items_con_iva_incluido: preciosItemsConIvaIncluidoEfectivo,
        items: draftItems.flatMap((i, idx) => {
          const pid = i.match.producto_id;
          const desc = i.descripcion.trim() || null;
          const codigo = i.codigo?.trim() ? i.codigo.trim() : null;
          const presInferida = presentacionInferidaPorFila[idx] ?? null;
          const requiereContenidoManual = unidadFacturaRequiereContenido(i.unidad);
          const contenidoPresentacion =
            i.producto_contenido_unidad_compra ??
            (inferirPresentacionCompra || requiereContenidoManual
              ? presInferida?.contenido_unidad_compra ?? null
              : null);
          const presentacionModoEfectivo =
            (i.presentacion_modo ?? 'auto') === 'auto' &&
            contenidoPresentacion != null &&
            contenidoPresentacion > 1
              ? 'presentacion_compra'
              : (i.presentacion_modo ?? 'auto');
          const bonifCant = Math.max(0, Number(i.bonificacion_cantidad ?? 0));
          const cantidadConPrecio =
            i.precio_unitario > UMBRAL_BONIFICACION_REPOSICION
              ? Math.max(0, i.cantidad - bonifCant)
              : i.cantidad;
          const base = pid
            ? {
                producto_id: pid,
                crear_desde_factura: null,
              }
            : {
                producto_id: null as null,
                crear_desde_factura: {
                  nombre: desc || 'Ítem factura',
                  codigo,
                },
              };
          const out: Record<string, unknown>[] = [];
          if (cantidadConPrecio > 0) {
            out.push({
              ...base,
              cantidad: cantidadConPrecio,
              precio_unitario: i.precio_unitario,
              precio_costo: i.precio_unitario,
              iva_porcentaje: esRemito ? null : i.iva_porcentaje,
              descripcion_factura: desc,
              unidad_factura: i.unidad,
              contenido_presentacion_compra: contenidoPresentacion,
              codigo_factura: codigo,
              presentacion_modo: presentacionModoEfectivo,
            });
          }
          if (bonifCant > 0) {
            out.push({
              ...base,
              cantidad: bonifCant,
              precio_unitario: 0,
              precio_costo: 0,
              iva_porcentaje: esRemito ? null : i.iva_porcentaje,
              descripcion_factura: desc,
              unidad_factura: i.unidad,
              contenido_presentacion_compra: contenidoPresentacion,
              codigo_factura: codigo,
              presentacion_modo: presentacionModoEfectivo,
            });
          }
          return out;
        }),
        subtotal: importesComprobante.subtotal,
        iva_monto: importesComprobante.iva_monto,
        percepcion_iibb_monto: percepciones.iibb,
        percepcion_iva_monto: percepciones.iva,
        impuesto_interno_monto: percepciones.interno,
        total: totalLeidoIa ?? importesComprobante.total,
        importes_manuales: ivaMontoFactura.trim() !== '',
        actualizar_costos:
          actualizarCostos &&
          tipoOperacion === 'compra' &&
          !esTipoComprobanteNotaCredito(tipoComp),
        afecta_stock: afectaStock,
        afecta_cuenta_corriente: afectaCuentaCorriente,
        fecha_vencimiento_sugerida:
          draftCabecera.fecha_vencimiento?.trim() && draftCabecera.fecha_vencimiento.trim().length >= 10
            ? draftCabecera.fecha_vencimiento.trim().slice(0, 10)
            : null,
        pago:
          mostrarPanelPagoProveedor
            ? pagoModo === 'ya_pagada'
              ? {
                  estado: 'ya_pagada',
                  fecha_pago: fechaPagoYa,
                  tipo_pago: tipoPagoYa,
                }
              : pagoModo === 'pendiente_condicion'
                ? { estado: 'pendiente_condicion' }
                : { estado: 'pendiente_fecha_custom', vencimiento_at: vencCustom }
            : null,
        observaciones: observacionesComprobante(
          extraccion.observaciones ?? '',
          extraccion.condicion_pago ?? '',
        ),
      };

      const res = await fetch('/api/lector-facturas/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as {
        error?: string;
        comprobante_id?: string;
        actualizaciones_costos?: ActualizacionCostoProducto[];
      };
      if (!res.ok) {
        throw new Error(j.error || 'No se pudo confirmar');
      }
      void refreshLimite();
      const cambios = j.actualizaciones_costos ?? [];
      if (cambios.length > 0) {
        const cambiosOrdenados = ordenarCambiosCosto(cambios);
        const visibles = cambiosOrdenados.slice(0, 12);
        const resumen = contarCambiosCosto(cambios);
        const generarEtiquetas = await showConfirmModal({
          title: `Factura cargada: ${cambios.length} costo${cambios.length === 1 ? '' : 's'} actualizado${cambios.length === 1 ? '' : 's'}`,
          description: (
            <div className="space-y-3 text-left">
              <p>
                Se modificaron costos de productos existentes porque estaba activa la opción de actualizar costos.
              </p>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-md border bg-background px-3 py-2">
                  <p className="text-muted-foreground">Subieron</p>
                  <p className="text-foreground text-base font-semibold tabular-nums">{resumen.suben}</p>
                </div>
                <div className="rounded-md border bg-background px-3 py-2">
                  <p className="text-muted-foreground">Bajaron</p>
                  <p className="text-foreground text-base font-semibold tabular-nums">{resumen.bajan}</p>
                </div>
                <div className="rounded-md border bg-background px-3 py-2">
                  <p className="text-muted-foreground">Sin costo previo</p>
                  <p className="text-foreground text-base font-semibold tabular-nums">{resumen.sinCostoPrevio}</p>
                </div>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border bg-background text-foreground">
                {visibles.map((c) => (
                  <div key={c.producto_id} className="border-b px-3 py-2 last:border-0">
                    <p className="font-medium leading-snug">
                      {c.nombre}
                      {c.codigo ? (
                        <span className="text-muted-foreground ml-1 font-normal">({c.codigo})</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      Costo: <span className="text-foreground">{formatCostoNullable(c.precio_costo_anterior)}</span>{' '}
                      → <span className="text-foreground">{formatCurrency(c.precio_costo_nuevo)}</span>{' '}
                      <span className={cn(
                        'font-medium',
                        c.variacion_pct != null && c.variacion_pct < 0
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-amber-700 dark:text-amber-300',
                      )}>
                        {formatVariacionPct(c.variacion_pct)}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              {cambios.length > visibles.length ? (
                <p className="text-xs">Y {cambios.length - visibles.length} producto(s) más.</p>
              ) : null}
              <p className="text-xs">
                Las altas nuevas de productos no aparecen en este resumen: solo se listan productos ya existentes cuyo
                costo quedó modificado.
              </p>
              <p className="text-xs">
                Si elegís generar etiquetas, se abrirá la hoja con estos productos ya agregados para imprimir.
              </p>
            </div>
          ),
          confirmLabel: 'Generar etiquetas',
          cancelLabel: 'Ver facturación',
          contentClassName: 'sm:max-w-2xl',
        });
        router.push(
          generarEtiquetas
            ? urlHojaEtiquetasProductos(cambios.map((c) => c.producto_id))
            : '/facturacion',
        );
        return;
      }
      router.push('/facturacion');
    } catch (e) {
      await showAlertModal({
        title: 'No se pudo confirmar',
        description: (e as Error).message,
      });
    } finally {
      setLoadingConf(false);
    }
  }

  return (
    <>
      {ConfirmDialog}
      <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lector Factura IA</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Carga con IA → revisión en dos pasos (cabecera y contraparte, luego productos y totales) → confirmación en el
            sistema.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <Link
            href="/lector-facturas/historial"
            className="text-purple-700 underline underline-offset-4 hover:text-purple-900"
          >
            Historial de extracciones
          </Link>
          {limite ? (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-right',
                quedan != null && quedan < 5
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-border bg-muted/40 text-muted-foreground',
              )}
            >
              {limite.limite === null ? (
                <>
                  <span className="text-foreground font-medium">{limite.usadas}</span> usos de IA este
                  mes (compartido con listas y extracciones)
                  <p className="mt-1 text-xs">Plan completo: sin tope mensual.</p>
                </>
              ) : (
                <>
                  <span className="text-foreground font-medium">
                    {limite.usadas}/{limite.limite}
                  </span>{' '}
                  usos de IA este mes (compartido con listas y extracciones)
                  {quedan != null && quedan < 5 && quedan >= 0 ? (
                    <p className="mt-1 text-xs">Quedan pocas extracciones disponibles.</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {step === 'carga' ? (
        <>
          {canEdit ? (
            <LectorFacturasBorradoresPanel
              refreshKey={draftsRefreshKey}
              onRetomar={onRetomarBorrador}
            />
          ) : null}
          <ExtraerFactura
            onExtraccionCompleta={onExtraccionCompleta}
            onLimiteRefresh={refreshLimite}
            disabled={limite != null && !limite.permitido}
          />
        </>
      ) : null}

      {step === 'preview' && extraccion ? (
        <div ref={previewSectionRef} className="scroll-mt-6 space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm">
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={limpiarPreview}
                >
                  ← Nueva extracción
                </button>
                <span className="mx-2 hidden sm:inline">·</span>
                <span className="mt-1 block text-foreground sm:mt-0 sm:inline">
                  <FileText className="text-muted-foreground mr-1 inline h-4 w-4 align-text-bottom" />
                  {archivoNombre}
                </span>
              </p>
              <p className="text-muted-foreground text-[11px] leading-snug sm:text-xs">
                {previewPaso === 1 ? (
                  <>
                    Paso <span className="text-foreground font-medium">1/2</span> — Confirmá emisor, receptor, datos del
                    comprobante y la contraparte en el sistema.
                  </>
                ) : (
                  <>
                    Paso <span className="text-foreground font-medium">2/2</span> — Revisá líneas, totales y cómo impacta
                    en stock y cuenta corriente; luego confirmá la carga.
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={savingDraft}
                onClick={() => void guardarBorradorActual()}
              >
                <Save className="h-3.5 w-3.5" />
                {savingDraft ? 'Guardando...' : 'Guardar borrador'}
              </Button>
              {previewPaso === 2 ? (
                <button
                  type="button"
                  className="text-muted-foreground text-xs underline underline-offset-4 sm:text-right"
                  onClick={() => setPreviewPaso(1)}
                >
                  ← Volver al paso 1
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 to-background p-4 shadow-sm dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <div className="bg-background flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-200 shadow-sm dark:border-emerald-800">
                  <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-emerald-950 dark:text-emerald-50">
                    {previewPaso === 1 ? 'Paso 1: cabecera y partes del documento' : 'Paso 2: productos y montos'}
                  </h2>
                  <p className="text-muted-foreground mt-1 max-w-xl text-sm leading-relaxed">
                    {previewPaso === 1 ? (
                      <>
                        Corregí CUITs y datos del comprobante. Las líneas y totales los revisamos en el siguiente paso.
                        Nada se guarda hasta que confirmes al final.
                      </>
                    ) : (
                      <>
                        Corregí cantidades, precios y vínculos al catálogo. Nada se guarda hasta que confirmes abajo.
                      </>
                    )}
                  </p>
                  {lineaResumenComprobante ? (
                    <p className="text-foreground mt-2 text-sm font-medium">{lineaResumenComprobante}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {previewPaso === 1 ? (
                  <span className="bg-background/80 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums shadow-sm">
                    {statsLectura.total} {statsLectura.total === 1 ? 'línea leída' : 'líneas leídas'} · ítems en paso 2
                  </span>
                ) : (
                  <>
                    <span className="bg-background/80 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums shadow-sm">
                      {statsLectura.total} {statsLectura.total === 1 ? 'línea' : 'líneas'}
                    </span>
                    {tipoOperacion === 'venta' ? (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums shadow-sm',
                          statsLectura.sinVincular > 0
                            ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                            : 'border-emerald-200 bg-emerald-100/60 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100',
                        )}
                      >
                        {statsLectura.vinculados} con catálogo
                        {statsLectura.sinVincular > 0 ? ` · ${statsLectura.sinVincular} pendientes` : ''}
                      </span>
                    ) : (
                      <span className="bg-background/80 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums shadow-sm">
                        {statsLectura.vinculados} ya en catálogo
                        {statsLectura.sinVincular > 0 ? ` · ${statsLectura.sinVincular} nuevos al confirmar` : ''}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {!canEdit ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Tu rol no permite confirmar la carga.
            </p>
          ) : null}

          {previewPaso === 1 ? (
          <div
            className={cn(
              'rounded-lg border px-4 py-3 text-sm',
              extraccion.direccion === 'desconocida'
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : extraccion.direccion === 'recibida'
                  ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
                  : 'border-sky-200 bg-sky-50 text-sky-950',
            )}
          >
            <p className="font-medium">Sugerencia según el CUIT de tu negocio</p>
            <p className="mt-1 font-medium">{copyDireccionIa.titulo}</p>
            <p className="mt-1 text-xs leading-relaxed opacity-95">{copyDireccionIa.detalle}</p>
            {extraccion.proveedor ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Coincidencia con proveedor: <span className="text-foreground font-medium">{extraccion.proveedor.nombre}</span>
              </p>
            ) : null}
            {extraccion.cliente ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Coincidencia con cliente: <span className="text-foreground font-medium">{extraccion.cliente.nombre}</span>
              </p>
            ) : null}
            <p className="mt-2 text-xs opacity-90">
              Podés cambiar compra/venta más abajo; al confirmar se usan esos valores, no solo esta sugerencia.
            </p>
          </div>
          ) : null}

          {previewPaso === 2 && extraccion.validacion.totales_cuadran ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <p>
                <span className="font-medium">Totales coherentes.</span> Lo que suman las líneas coincide con los
                totales que leyó la IA en el comprobante (salvo redondeos).
              </p>
            </div>
          ) : null}

          {previewPaso === 2 && !extraccion.validacion.totales_cuadran ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Totales de la factura (IA)</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {extraccion.validacion.advertencias.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              {costosIaDudosos ? (
                <p className="mt-2 text-xs font-medium">
                  Podés continuar, pero revisá cantidades, precios unitarios y subtotales antes de confirmar.
                </p>
              ) : null}
            </div>
          ) : null}

          {previewPaso === 1 && draftCabecera ? (
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-medium">Datos del comprobante (editables)</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Tipo de comprobante</span>
                  <select
                    className="border-input rounded-md border bg-background px-2 py-1.5 text-sm"
                    value={draftCabecera.tipo_comprobante}
                    onChange={(e) =>
                      setDraftCabecera((c) =>
                        c ? { ...c, tipo_comprobante: e.target.value } : c,
                      )
                    }
                  >
                    {!OPCIONES_TIPO_COMPROBANTE.some((o) => o.value === draftCabecera.tipo_comprobante) ? (
                      <option value={draftCabecera.tipo_comprobante}>
                        {draftCabecera.tipo_comprobante} (valor IA)
                      </option>
                    ) : null}
                    {OPCIONES_TIPO_COMPROBANTE.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {esTipoComprobanteNotaCredito(draftCabecera.tipo_comprobante) ? (
                    <span className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
                      {tipoOperacion === 'compra'
                        ? 'NC recibida: va a restar stock y disminuir el saldo del proveedor. No actualiza costos ni registra lotes.'
                        : 'NC emitida: va a sumar stock y disminuir el saldo del cliente.'}
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Letra</span>
                  <Input
                    className="h-9"
                    maxLength={4}
                    value={draftCabecera.letra ?? ''}
                    onChange={(e) =>
                      setDraftCabecera((c) =>
                        c ? { ...c, letra: e.target.value.trim() || null } : c,
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Punto de venta</span>
                  <Input
                    className="h-9"
                    type="number"
                    value={draftCabecera.punto_venta ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraftCabecera((c) =>
                        c
                          ? {
                              ...c,
                              punto_venta: v === '' ? null : Number(v),
                            }
                          : c,
                      );
                    }}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Número</span>
                  <Input
                    className="h-9"
                    type="number"
                    value={draftCabecera.numero ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraftCabecera((c) =>
                        c ? { ...c, numero: v === '' ? null : Number(v) } : c,
                      );
                    }}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Fecha emisión</span>
                  <Input
                    className="h-9"
                    type="date"
                    value={(draftCabecera.fecha_emision ?? '').slice(0, 10)}
                    onChange={(e) =>
                      setDraftCabecera((c) =>
                        c ? { ...c, fecha_emision: e.target.value || null } : c,
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Fecha vencimiento</span>
                  <Input
                    className="h-9"
                    type="date"
                    value={(draftCabecera.fecha_vencimiento ?? '').slice(0, 10)}
                    onChange={(e) =>
                      setDraftCabecera((c) =>
                        c ? { ...c, fecha_vencimiento: e.target.value || null } : c,
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs sm:col-span-2">
                  <span className="text-muted-foreground font-medium">CAE</span>
                  <Input
                    className="h-9"
                    value={draftCabecera.cae ?? ''}
                    onChange={(e) =>
                      setDraftCabecera((c) => (c ? { ...c, cae: e.target.value || null } : c))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Venc. CAE</span>
                  <Input
                    className="h-9"
                    type="date"
                    value={(draftCabecera.cae_vencimiento ?? '').slice(0, 10)}
                    onChange={(e) =>
                      setDraftCabecera((c) =>
                        c ? { ...c, cae_vencimiento: e.target.value || null } : c,
                      )
                    }
                  />
                </label>
              </div>
            </div>
          ) : null}

          {previewPaso === 1 ? (
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div>
              <h3 className="text-sm font-medium">Emisor y receptor en el documento</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Datos que leyó la IA (contraparte fiscal del PDF). Los podés corregir; si elegís crear proveedor o
                cliente nuevo, se usan el <strong>emisor</strong> o el <strong>receptor</strong> respectivamente.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <fieldset className="space-y-2 rounded-md border px-3 py-3">
                <legend className="px-1 text-xs font-medium">Emisor (vendedor en el papel)</legend>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Razón social</span>
                  <Input
                    className="h-9"
                    value={draftEmisor.razon_social}
                    onChange={(e) =>
                      setDraftEmisor((p) => ({ ...p, razon_social: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">CUIT</span>
                  <Input
                    className="h-9"
                    value={draftEmisor.cuit}
                    onChange={(e) => setDraftEmisor((p) => ({ ...p, cuit: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Domicilio</span>
                  <Input
                    className="h-9"
                    value={draftEmisor.domicilio}
                    onChange={(e) =>
                      setDraftEmisor((p) => ({ ...p, domicilio: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Condición IVA</span>
                  <Input
                    className="h-9"
                    value={draftEmisor.condicion_iva}
                    onChange={(e) =>
                      setDraftEmisor((p) => ({ ...p, condicion_iva: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Ingresos brutos</span>
                  <Input
                    className="h-9"
                    value={draftEmisor.ingresos_brutos}
                    onChange={(e) =>
                      setDraftEmisor((p) => ({ ...p, ingresos_brutos: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Inicio actividades</span>
                  <Input
                    className="h-9"
                    value={draftEmisor.inicio_actividades}
                    onChange={(e) =>
                      setDraftEmisor((p) => ({ ...p, inicio_actividades: e.target.value }))
                    }
                  />
                </label>
              </fieldset>
              <fieldset className="space-y-2 rounded-md border px-3 py-3">
                <legend className="px-1 text-xs font-medium">Receptor (comprador en el papel)</legend>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Razón social / nombre</span>
                  <Input
                    className="h-9"
                    value={draftReceptor.razon_social}
                    onChange={(e) =>
                      setDraftReceptor((p) => ({ ...p, razon_social: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">CUIT / DNI</span>
                  <Input
                    className="h-9"
                    value={draftReceptor.cuit_dni}
                    onChange={(e) =>
                      setDraftReceptor((p) => ({ ...p, cuit_dni: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Domicilio</span>
                  <Input
                    className="h-9"
                    value={draftReceptor.domicilio}
                    onChange={(e) =>
                      setDraftReceptor((p) => ({ ...p, domicilio: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Condición IVA</span>
                  <Input
                    className="h-9"
                    value={draftReceptor.condicion_iva}
                    onChange={(e) =>
                      setDraftReceptor((p) => ({ ...p, condicion_iva: e.target.value }))
                    }
                  />
                </label>
              </fieldset>
            </div>
          </div>
          ) : null}

          {previewPaso === 1 ? (
            <>
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="text-muted-foreground text-xs font-medium">Tipo de operación</label>
                <p className="text-muted-foreground mt-0.5 max-w-sm text-[11px] leading-snug">
                  Siempre arranca en compra. Cambiá a venta solo si importás una factura emitida por tu negocio.
                </p>
                <select
                  className="border-input mt-1 block rounded-md border bg-background px-3 py-2 text-sm"
                  value={tipoOperacion}
                  onChange={(e) => {
                    const v = e.target.value as 'compra' | 'venta';
                    setTipoOperacion(v);
                    if (v === 'venta') setActualizarCostos(false);
                    else setActualizarCostos(true);
                  }}
                >
                  <option value="compra">Compra (factura recibida)</option>
                  <option value="venta">Venta (factura emitida importada)</option>
                </select>
              </div>
              {tipoOperacion === 'compra' ? (
                <div className="min-w-[220px] flex-1">
                  <label className="text-muted-foreground text-xs font-medium">Proveedor en el sistema</label>
                  <select
                    className="border-input mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={proveedorElegidoId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setProveedorElegidoId(v);
                      if (v) setIncluirCrearProveedor(false);
                    }}
                  >
                    <option value="">— Elegí un proveedor —</option>
                    {listaProveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                  {!proveedorElegidoId ? (
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-snug">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={incluirCrearProveedor}
                        onChange={(e) => setIncluirCrearProveedor(e.target.checked)}
                      />
                      <span>
                        Crear proveedor nuevo con los datos del <strong>emisor</strong> (razón social y CUIT de 11
                        dígitos obligatorios en la sección anterior).
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : (
                <div className="min-w-[220px] flex-1">
                  <label className="text-muted-foreground text-xs font-medium">Cliente en el sistema</label>
                  <select
                    className="border-input mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={clienteElegidoId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setClienteElegidoId(v);
                      if (v) setIncluirCrearCliente(false);
                    }}
                  >
                    <option value="">— Elegí un cliente —</option>
                    {listaClientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.razon_social || c.nombre}
                      </option>
                    ))}
                  </select>
                  {!clienteElegidoId ? (
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-snug">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={incluirCrearCliente}
                        onChange={(e) => setIncluirCrearCliente(e.target.checked)}
                      />
                      <span>
                        Crear cliente nuevo con los datos del <strong>receptor</strong> (razón social y CUIT de 11
                        dígitos obligatorios en la sección anterior).
                      </span>
                    </label>
                  ) : null}
                </div>
              )}
            </div>
          </div>

              {faltaProveedorCompra ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {incluirCrearProveedor
                    ? 'Para dar de alta el proveedor completá razón social y CUIT de 11 dígitos del emisor, o elegí un proveedor del listado.'
                    : 'En compras elegí un proveedor del listado o tildá crear uno nuevo con los datos del emisor.'}
                </p>
              ) : null}
              {faltaClienteVenta ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {incluirCrearCliente
                    ? 'Para dar de alta el cliente completá razón social y CUIT de 11 dígitos del receptor, o elegí un cliente del listado.'
                    : 'En ventas elegí un cliente del listado o tildá crear uno nuevo con los datos del receptor.'}
                </p>
              ) : null}

              {!tipoOk ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  Tipo &quot;{tipoComp}&quot; todavía no se puede confirmar automáticamente. Usá factura A/B/C,
                  remito o ticket.
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
                {!puedeAvanzarPreviewPaso1 ? (
                  <p className="text-muted-foreground max-w-xl flex-1 text-xs">
                    Para continuar: elegí proveedor o cliente en el sistema (o activá crear uno con los datos del papel) y
                    un tipo de comprobante importable.
                  </p>
                ) : null}
                <Button type="button" disabled={!puedeAvanzarPreviewPaso1} onClick={() => setPreviewPaso(2)}>
                  Continuar a productos y montos
                </Button>
              </div>
            </>
          ) : null}

          {previewPaso === 2 ? (
            <>
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-sm">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-input"
                  checked={inferirPresentacionCompra}
                  onChange={(e) => setInferirPresentacionCompra(e.target.checked)}
                />
                <span className="min-w-0 font-medium text-foreground">
                  Detectar compra por caja/pack desde el nombre y la unidad leída (caja x 500, x 300 u,
                  caja(100), etc.)
                </span>
              </label>
              <p className="text-muted-foreground mt-2 text-xs leading-snug">
                Igual que en importación Excel: si la factura viene por envase y el texto lo permite,
                convierte cantidad y precio unitario a{' '}
                <strong className="text-foreground">unidad de stock base</strong> antes de impactar stock y
                costos.
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-input"
                  checked={preciosItemsConIvaIncluidoEfectivo}
                  disabled={esRemito}
                  onChange={(e) => setPreciosItemsConIvaIncluido(e.target.checked)}
                />
                <span className="min-w-0 font-medium text-foreground">
                  Precio unitario de línea con IVA incluido (calcular costo neto sin IVA)
                </span>
              </label>
              <p className="text-muted-foreground mt-2 text-xs leading-snug">
                {esRemito ? (
                  <>
                    En remitos queda inactivo: el precio unitario se toma tal como viene y no se usa IVA para recalcular
                    costo ni para actualizar el catálogo.
                  </>
                ) : (
                  <>
                    Usalo solo cuando el <strong className="text-foreground">precio unitario impreso ya incluye IVA</strong>{' '}
                    (varias facturas B o tickets). Ahí el sistema guarda el costo neto como PU ÷ (1 + alícuota/100) con el IVA
                    del ítem o {ivaDefault}% por defecto.
                    <span className="text-foreground font-medium"> En factura A típica dejalo desmarcado:</span> el PU es
                    neto, el IVA se suma al subtotal al pie; la alícuota en cada ítem es solo dato fiscal, no se resta del
                    costo.
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={actualizarCostos}
                  onChange={(e) => setActualizarCostos(e.target.checked)}
                  disabled={tipoOperacion !== 'compra'}
                />
                Actualizar costo de productos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={afectaStock}
                  onChange={(e) => setAfectaStock(e.target.checked)}
                />
                Afectar stock
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={afectaCuentaCorriente}
                  onChange={(e) => setAfectaCuentaCorriente(e.target.checked)}
                />
                Cuenta corriente
              </label>
            </div>
            {tipoOperacion === 'compra' ? (
              <p className="text-muted-foreground mt-2 max-w-3xl text-xs leading-snug">
                En líneas enlazadas a un producto existente, al confirmar se actualizan{' '}
                <strong className="text-foreground">nombre</strong>,{' '}
                <strong className="text-foreground">código</strong> leído,{' '}
                <strong className="text-foreground">unidad</strong>,{' '}
                <strong className="text-foreground">proveedor</strong> de esta compra
                {esRemito ? (
                  <>. En remitos no se modifica el <strong className="text-foreground">IVA</strong> fiscal del producto. El </>
                ) : (
                  <> e <strong className="text-foreground">IVA</strong> del ítem. El </>
                )}
                <strong className="text-foreground">precio de costo del catálogo</strong> solo se modifica si
                marcás «Actualizar costo de productos»; si en configuración está activo «El costo solo sube», no
                bajará aunque la factura traiga un valor menor.
              </p>
            ) : null}

            {mostrarPanelPagoProveedor ? (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <h4 className="text-sm font-medium">Condiciones de pago</h4>
                <p className="text-muted-foreground mt-1 text-xs">
                  Aplica a la deuda registrada al confirmar esta compra (cuenta corriente a pagar).
                </p>
                <div className="mt-3 space-y-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="pagoModo"
                      className="mt-1"
                      checked={pagoModo === 'ya_pagada'}
                      onChange={() => setPagoModo('ya_pagada')}
                    />
                    <span>
                      <span className="font-medium">Ya la pagué</span>
                      {pagoModo === 'ya_pagada' ? (
                        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <select
                            className="border-input rounded-md border bg-background px-2 py-1"
                            value={tipoPagoYa}
                            onChange={(e) =>
                              setTipoPagoYa(e.target.value as 'efectivo' | 'transferencia' | 'cheque')
                            }
                          >
                            <option value="efectivo">Efectivo</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="cheque">Cheque</option>
                          </select>
                          <input
                            type="date"
                            className="border-input rounded-md border bg-background px-2 py-1"
                            value={fechaPagoYa}
                            onChange={(e) => setFechaPagoYa(e.target.value)}
                          />
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-2 text-sm',
                      !canUseCondProveedor ? 'cursor-not-allowed opacity-60' : '',
                    )}
                    title={
                      !canUseCondProveedor
                        ? 'Cargá la condición de pago en la ficha del proveedor'
                        : undefined
                    }
                  >
                    <input
                      type="radio"
                      name="pagoModo"
                      className="mt-1"
                      disabled={!canUseCondProveedor}
                      checked={pagoModo === 'pendiente_condicion'}
                      onChange={() => setPagoModo('pendiente_condicion')}
                    />
                    <span>
                      <span className="font-medium">Pago a plazo — condición del proveedor</span>
                      {pagoModo === 'pendiente_condicion' && textoVencCondicion ? (
                        <p className="text-muted-foreground mt-1 text-xs">{textoVencCondicion}</p>
                      ) : null}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="pagoModo"
                      className="mt-1"
                      checked={pagoModo === 'pendiente_fecha_custom'}
                      onChange={() => setPagoModo('pendiente_fecha_custom')}
                    />
                    <span className="flex-1">
                      <span className="font-medium">Pago a plazo — fecha personalizada</span>
                      {pagoModo === 'pendiente_fecha_custom' ? (
                        <input
                          type="date"
                          className="border-input mt-2 block max-w-[12rem] rounded-md border bg-background px-2 py-1 text-xs"
                          value={vencCustom}
                          onChange={(e) => setVencCustom(e.target.value)}
                        />
                      ) : null}
                    </span>
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          {tipoOperacion === 'compra' && extraccion.direccion === 'emitida' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              La IA interpretó una factura emitida por vos, pero marcás una <strong>compra</strong>. Revisá proveedor,
              cliente y líneas antes de confirmar.
            </p>
          ) : null}
          {tipoOperacion === 'venta' && extraccion.direccion === 'recibida' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              La IA interpretó una factura recibida, pero marcás una <strong>venta</strong>. Revisá contraparte y líneas
              antes de confirmar.
            </p>
          ) : null}

          {tipoOperacion === 'venta' && itemsSinMatch ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Hay ítems sin producto matcheado. En ventas tenés que resolver cada ítem contra el catálogo.
            </p>
          ) : null}

          {tipoOperacion === 'compra' && compraSinNombreParaNuevo ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Hay ítems sin producto y con descripción vacía. Completá la descripción de la factura para poder darlos de
              alta automáticamente.
            </p>
          ) : null}

          {compraConItemsNuevos && !compraSinNombreParaNuevo ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-medium">Atención:</span> uno o más ítems no están en el catálogo. Se{' '}
              <strong>crearán productos nuevos</strong> con el nombre de la descripción de la factura, proveedor actual y
              precio de la línea, y luego se registrará el movimiento de stock como en el resto de la compra.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEdit}
              onClick={() => {
                const iva = extraccion?.iva_default ?? 21;
                setDraftItems((prev) => [
                  ...prev,
                  {
                    indice: prev.length,
                    codigo: null,
                    descripcion: '',
                    cantidad: 1,
                    unidad: null,
                    producto_unidad: null,
                    producto_unidad_compra: null,
                    producto_contenido_unidad_compra: null,
                    unidad_original: null,
                    presentacion_modo: 'auto',
                    precio_unitario: 0,
                    subtotal: 0,
                    bonificacion: null,
                    bonificacion_cantidad: null,
                    iva_porcentaje: iva,
                    match: {
                      producto_id: null,
                      confidence: 0,
                      metodo: 'none',
                      producto_nombre: null,
                    },
                  },
                ]);
              }}
            >
              Agregar línea
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEdit || draftItems.length === 0}
              onClick={() =>
                setDraftItems((prev) =>
                  prev.map((r) => ({
                    ...r,
                    subtotal: r.cantidad * r.precio_unitario,
                  })),
                )
              }
            >
              Subtotal línea = cant. × precio
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Catálogo</th>
                  <th className="px-3 py-2 text-left font-medium">Código (factura)</th>
                  <th className="px-3 py-2 text-left font-medium">Descripción</th>
                  <th className="px-3 py-2 text-left font-medium">Unidad</th>
                  <th className="px-3 py-2 text-right font-medium">Cant.</th>
                  <th className="px-3 py-2 text-right font-medium">P. unit.</th>
                  <th className="px-3 py-2 text-right font-medium">Bonif.</th>
                  <th className="px-3 py-2 text-right font-medium">Subt. doc.</th>
                  <th className="px-3 py-2 text-right font-medium">IVA %</th>
                  <th className="px-2 py-2 text-center font-medium w-14"> </th>
                </tr>
              </thead>
              <tbody>
                {draftItems.map((row, idx) => (
                  <tr
                    key={`${row.indice}-${idx}`}
                    className={cn(
                      'border-t align-top',
                      esLineaBonificacionTabla(row) &&
                        'bg-emerald-50/60 dark:bg-emerald-950/20',
                    )}
                  >
                    <td className="px-3 py-2">
                      <ProductoMatchPicker
                        vinculadoNombre={row.match.producto_nombre}
                        tieneProductoId={Boolean(row.match.producto_id)}
                        codigoDesdeFactura={row.codigo}
                        onAsignar={(id, nombre, ivaPct, unidad, unidadCompra, contenidoUnidadCompra) => {
                          setDraftItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    producto_unidad: unidad ?? r.producto_unidad,
                                    producto_unidad_compra: unidadCompra,
                                    producto_contenido_unidad_compra: contenidoUnidadCompra,
                                    presentacion_modo: presentacionModoDefault(contenidoUnidadCompra),
                                    iva_porcentaje:
                                      ivaPct != null && !Number.isNaN(ivaPct)
                                        ? ivaPct
                                        : r.iva_porcentaje,
                                    match: {
                                      producto_id: id,
                                      producto_nombre: nombre,
                                      confidence: 1,
                                      metodo: 'manual',
                                    },
                                  }
                                : r,
                            ),
                          );
                        }}
                        onQuitar={() => {
                          setDraftItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    producto_unidad: null,
                                    producto_unidad_compra: null,
                                    producto_contenido_unidad_compra: null,
                                    presentacion_modo: 'auto',
                                    match: {
                                      producto_id: null,
                                      producto_nombre: null,
                                      confidence: 0,
                                      metodo: 'none',
                                    },
                                  }
                                : r,
                            ),
                          );
                        }}
                      />
                      {!row.match.producto_id && tipoOperacion === 'compra' ? (
                        <p className="text-amber-800 mt-1 text-[11px]">Sin catálogo: se creará producto al confirmar</p>
                      ) : null}
                      {esLineaBonificacionTabla(row) ? (
                        <p className="mt-1 inline-flex rounded-full border border-emerald-300 bg-emerald-100/80 px-2 py-0.5 text-[11px] font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                          Bonificación / reposición (precio 0)
                        </p>
                      ) : null}
                      {row.match.producto_id &&
                      row.producto_unidad_compra &&
                      row.producto_contenido_unidad_compra != null &&
                      row.producto_contenido_unidad_compra > 1 ? (
                        <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-950">
                          <p className="font-medium">
                            Presentacion habitual: 1 {row.producto_unidad_compra} ={' '}
                            {row.producto_contenido_unidad_compra} {row.producto_unidad ?? 'unidades'}
                          </p>
                          <select
                            className="border-input h-7 w-full rounded border bg-background px-2 text-[11px] text-foreground"
                            value={
                              row.presentacion_modo ??
                              presentacionModoDefault(row.producto_contenido_unidad_compra)
                            }
                            onChange={(e) => {
                              const modo = parsePresentacionModoLector(e.target.value) ?? 'auto';
                              setDraftItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, presentacion_modo: modo } : r)),
                              );
                            }}
                          >
                            <option value="unidad_base">La factura trae unidades sueltas</option>
                            <option value="presentacion_compra">
                              La factura trae {row.producto_unidad_compra} x{' '}
                              {row.producto_contenido_unidad_compra}
                            </option>
                            <option value="auto">Detectar desde el texto</option>
                          </select>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        className="border-input w-full min-w-[100px] rounded border bg-background px-2 py-1 text-xs"
                        value={row.codigo ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftItems((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, codigo: v || null } : r)),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        className="border-input min-h-[2.5rem] w-full min-w-[180px] max-w-[280px] rounded border bg-background px-2 py-1 text-xs"
                        rows={2}
                        value={row.descripcion}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftItems((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, descripcion: v } : r)),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const unidadRaw = (row.unidad ?? '').trim().toLowerCase();
                        const unidadEnLista = UNIDAD_FACTURA_OPTS.includes(
                          unidadRaw as (typeof UNIDAD_FACTURA_OPTS)[number],
                        );
                        const unidadSelectValue = unidadRaw
                          ? unidadEnLista
                            ? unidadRaw
                            : 'otro'
                          : '';
                        const requiereContenido = unidadFacturaRequiereContenido(row.unidad);
                        const presInferida = presentacionInferidaPorFila[idx] ?? null;
                        return (
                          <div className="space-y-1">
                            <select
                              className="border-input h-8 w-full min-w-[80px] rounded border bg-background px-2 text-xs"
                              value={unidadSelectValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDraftItems((prev) =>
                                  prev.map((r, i) =>
                                    i === idx
                                      ? {
                                          ...r,
                                          unidad: v && v !== 'otro' ? v : v === '' ? null : r.unidad,
                                        }
                                      : r,
                                  ),
                                );
                              }}
                            >
                              <option value="">—</option>
                              {UNIDAD_FACTURA_OPTS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                              <option value="otro">otro…</option>
                            </select>
                            {unidadSelectValue === 'otro' ? (
                              <input
                                type="text"
                                className="border-input w-full min-w-[72px] rounded border bg-background px-2 py-1 text-xs"
                                value={row.unidad ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  setDraftItems((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, unidad: v || null } : r)),
                                  );
                                }}
                                placeholder="Unidad personalizada"
                              />
                            ) : null}
                            {requiereContenido ? (
                              <div className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] dark:border-sky-900/60 dark:bg-sky-950/30">
                                <p className="text-sky-900 dark:text-sky-100">
                                  ¿Cuántas unidades trae 1 {mapUnidadFacturaTexto(row.unidad)}?
                                </p>
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  className="border-input mt-1 h-7 w-20 rounded border bg-background px-2 text-right text-xs"
                                  value={row.producto_contenido_unidad_compra ?? ''}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setDraftItems((prev) =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? {
                                              ...r,
                                              producto_unidad_compra: mapUnidadFacturaTexto(r.unidad),
                                              producto_contenido_unidad_compra:
                                                Number.isFinite(v) && v > 0 ? Math.round(v) : null,
                                              presentacion_modo:
                                                Number.isFinite(v) && v > 1
                                                  ? 'presentacion_compra'
                                                  : 'auto',
                                            }
                                          : r,
                                      ),
                                    );
                                  }}
                                  placeholder="u."
                                />
                              </div>
                            ) : null}
                            {presInferida != null ? (
                              <p className="text-[10px] text-sky-700 dark:text-sky-300">
                                Inferido por nombre: 1 {presInferida.unidad_compra} ={' '}
                                {presInferida.contenido_unidad_compra} u.
                              </p>
                            ) : null}
                            {row.unidad_original &&
                            row.unidad &&
                            row.unidad_original.toLowerCase().trim() !== row.unidad ? (
                              <p className="text-[10px] text-emerald-700 dark:text-emerald-300">
                                Unidad detectada: {row.unidad_original} → {row.unidad}
                              </p>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="space-y-1">
                        <input
                          type="number"
                          className="border-input w-20 rounded border bg-background px-2 py-1 text-right"
                          value={row.cantidad}
                          min={0.001}
                          step="any"
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setDraftItems((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, cantidad: Number.isNaN(v) ? r.cantidad : v } : r,
                              ),
                            );
                          }}
                        />
                        {(row.bonificacion_cantidad ?? 0) > 0 ? (
                          <p className="text-[10px] text-emerald-700 dark:text-emerald-300">
                            Bonif: {row.bonificacion_cantidad} u.
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        className="border-input w-24 rounded border bg-background px-2 py-1 text-right"
                        value={row.precio_unitario}
                        min={0}
                        step="any"
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setDraftItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, precio_unitario: Number.isNaN(v) ? r.precio_unitario : v }
                                : r,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        className="border-input w-16 rounded border bg-background px-2 py-1 text-right"
                        value={row.bonificacion_cantidad ?? row.bonificacion ?? ''}
                        step="any"
                        readOnly={(row.bonificacion_cantidad ?? 0) > 0}
                        onChange={(e) => {
                          if ((row.bonificacion_cantidad ?? 0) > 0) return;
                          const raw = e.target.value.trim();
                          setDraftItems((prev) =>
                            prev.map((r, i) => {
                              if (i !== idx) return r;
                              if (raw === '') return { ...r, bonificacion: null };
                              const v = Number(raw);
                              return { ...r, bonificacion: Number.isNaN(v) ? r.bonificacion : v };
                            }),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        className="border-input w-[5.5rem] rounded border bg-background px-2 py-1 text-right"
                        value={row.subtotal}
                        step="any"
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setDraftItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, subtotal: Number.isNaN(v) ? r.subtotal : v }
                                : r,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        className={cn(
                          'border-input w-16 rounded border bg-background px-2 py-1 text-right',
                          esRemito && 'text-muted-foreground opacity-60',
                        )}
                        value={esRemito ? '' : row.iva_porcentaje}
                        min={0}
                        step="any"
                        placeholder="-"
                        disabled={esRemito}
                        title={esRemito ? 'El remito no actualiza IVA del producto' : undefined}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setDraftItems((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, iva_porcentaje: Number.isNaN(v) ? r.iva_porcentaje : v }
                                : r,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        className="text-destructive hover:text-destructive/90 text-xs underline underline-offset-2 disabled:opacity-40"
                        disabled={!canEdit || draftItems.length <= 1}
                        title={draftItems.length <= 1 ? 'Debe quedar al menos una línea' : 'Quitar línea'}
                        onClick={() =>
                          setDraftItems((prev) =>
                            prev.length <= 1
                              ? prev
                              : prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, indice: i })),
                          )
                        }
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {importesComprobante ? (
            <div className="flex flex-wrap items-end justify-end gap-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div>
                <span className="text-muted-foreground">Subtotal neto</span>
                <p className="font-medium tabular-nums">{formatCurrency(importesComprobante.subtotal)}</p>
              </div>
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground font-medium">IVA total</span>
                <Input
                  inputMode="decimal"
                  className="h-9 w-28 text-right font-mono"
                  value={ivaMontoFactura}
                  onChange={(e) => setIvaMontoFactura(e.target.value)}
                  placeholder={montoInputFactura(importesComprobante.iva_monto) || '0,00'}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground font-medium">Percep. IIBB</span>
                <Input
                  inputMode="decimal"
                  className="h-9 w-28 text-right font-mono"
                  value={percepcionIibb}
                  onChange={(e) => setPercepcionIibb(e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground font-medium">Percep. IVA</span>
                <Input
                  inputMode="decimal"
                  className="h-9 w-28 text-right font-mono"
                  value={percepcionIva}
                  onChange={(e) => setPercepcionIva(e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground font-medium">Imp. interno</span>
                <Input
                  inputMode="decimal"
                  className="h-9 w-28 text-right font-mono"
                  value={impuestoInterno}
                  onChange={(e) => setImpuestoInterno(e.target.value)}
                  placeholder="0,00"
                />
              </label>
              <div>
                <span className="text-muted-foreground">
                  {totalLeidoIa != null ? 'Total (comprobante leído)' : 'Total (según líneas editadas)'}
                </span>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCurrency(importesComprobante.total)}
                </p>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              disabled={!puedeConfirmar || loadingConf}
              onClick={() => void confirmar()}
            >
              {loadingConf ? 'Confirmando…' : 'Confirmar carga'}
            </Button>
          </div>
            </>
          ) : null}
        </div>
      ) : null}
      </div>
    </>
  );
}
