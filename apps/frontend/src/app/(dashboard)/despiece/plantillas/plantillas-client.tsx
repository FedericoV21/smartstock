'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Check, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import {
  costoCatalogoDesdePrecioVentaDespiece,
} from '@/lib/despiece/api';
import {
  calibrarFactoresDesdeEjemplo,
  calcular4Estrategias,
  calcularFactoresPorRentabilidadObjetivo,
} from '@/lib/despiece/motor';
import type {
  DespieceCalibracionResultado,
  DespieceEstrategia,
  DespieceInput,
  DespieceResultado,
  DespieceUnidadBaseTipo,
} from '@/lib/despiece/tipos';
import { normalizarPlu5 } from '@/lib/productos/normalizar-plu';
import { cn } from '@/lib/utils';

type ProductoMini = {
  id: string;
  codigo?: string | null;
  nombre: string;
  precio_costo: number;
  precio_venta: number;
  unidad?: string;
  plu?: string | null;
  es_pesable?: boolean | null;
  activo?: boolean | null;
};

type CorteForm = {
  producto_hijo_id: string;
  nombre_en_plantilla: string;
  plu_sugerido: string;
  kg_rendimiento: number;
  factor_ajuste_pct: number;
  precio_anclado: number | null;
  orden: number;
};

type PlantillaForm = {
  id?: string;
  nombre: string;
  producto_padre_id: string;
  peso_total_kg: number;
  unidad_base_tipo: DespieceUnidadBaseTipo;
  unidad_base_nombre: string;
  unidad_base_cantidad: number;
  unidad_contenedor_nombre: string;
  unidad_contenedor_cantidad: number | null;
  rentabilidad_objetivo_pct: number;
  activo: boolean;
  notas: string;
  cortes: CorteForm[];
};

type PlantillaRow = Omit<PlantillaForm, 'id' | 'cortes'> & {
  id: string;
  created_at: string;
  updated_at: string;
  producto_padre?: ProductoMini | null;
  cortes?: Array<CorteForm & { id: string; producto_hijo?: ProductoMini | null }>;
};

type CalibracionCorteForm = {
  kg_rendimiento: number | null;
  precio_venta_kg: number | null;
};

type CatalogoDiff = {
  producto_id: string;
  rowIndex: number;
  producto: ProductoMini;
  nombre_nuevo?: string;
  precio_nuevo?: number;
  plu_nuevo?: string;
};

type CatalogoSyncSelection = Record<
  string,
  { aplicar_nombre: boolean; aplicar_precio: boolean; aplicar_plu: boolean }
>;

type CambioCatalogoAplicado = {
  producto_id: string;
  nombre_nuevo?: string;
  precio_costo_nuevo?: number;
  precio_nuevo?: number;
  plu_nuevo?: string;
};

function money(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

/** Kg con separadores es-AR (coma decimal); evita 31.000 leído como «mil». */
function fmtKg(value: number | null | undefined, maximumFractionDigits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits });
}

function pct(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(1)}%`;
}

function factorPct(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const formatted = `${(n * 100).toFixed(1)}%`;
  return n > 0 ? `+${formatted}` : formatted;
}

function roundFactor(value: number) {
  return Math.round(value * 10_000_000_000) / 10_000_000_000;
}

function unidadBaseLabel(plantilla: Pick<PlantillaForm, 'peso_total_kg' | 'unidad_base_tipo' | 'unidad_base_nombre' | 'unidad_base_cantidad'>) {
  if (plantilla.unidad_base_tipo !== 'unidad') return `${fmtKg(Number(plantilla.peso_total_kg))} kg`;
  const cantidad = Number(plantilla.unidad_base_cantidad);
  const nombre = plantilla.unidad_base_nombre || 'unidades';
  const cantidadLabel = Number.isFinite(cantidad) ? fmtKg(cantidad) : '-';
  return `${fmtKg(Number(plantilla.peso_total_kg))} kg / ${cantidadLabel} ${nombre}`;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'No se pudo completar la operación.');
  return json;
}

function asProductoMini(p: ProductoMini | null | undefined): ProductoMini | null {
  if (!p?.id) return null;
  return {
    id: p.id,
    codigo: p.codigo ?? null,
    nombre: p.nombre,
    precio_costo: Number(p.precio_costo ?? 0),
    precio_venta: Number(p.precio_venta ?? 0),
    unidad: p.unidad,
    plu: p.plu ?? null,
    es_pesable: p.es_pesable ?? null,
    activo: p.activo ?? null,
  };
}

function mergeProductosMini(prev: ProductoMini[], incoming: Array<ProductoMini | null | undefined>) {
  const map = new Map(prev.map((p) => [p.id, p]));
  for (const producto of incoming) {
    const mini = asProductoMini(producto);
    if (!mini) continue;
    map.set(mini.id, { ...map.get(mini.id), ...mini });
  }
  return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function precioDistinto(a: number | null | undefined, b: number | null | undefined) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return round2(na) !== round2(nb);
}

function pluCatalogoLabel(plu: string | null | undefined) {
  return plu ? plu : 'sin PLU';
}

export function DespiecePlantillasClient() {
  const { confirm: openConfirm, ConfirmDialog } = useConfirm();
  const [plantillas, setPlantillas] = useState<PlantillaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingDefaults, setCreatingDefaults] = useState(false);
  const [deletingPlantillaId, setDeletingPlantillaId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchJson('/api/despiece/plantillas?activo=true');
      setPlantillas(json.plantillas ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cargarPredeterminadas() {
    setCreatingDefaults(true);
    try {
      const json = await fetchJson('/api/despiece/predeterminadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'todas' }),
      });
      setError(null);
      await load();
      toast.success(`Plantillas listas: ${json.plantillas?.length ?? 0}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron crear plantillas.');
    } finally {
      setCreatingDefaults(false);
    }
  }

  async function borrarPlantilla(plantilla: PlantillaRow) {
    const ok = await openConfirm({
      title: 'Borrar plantilla',
      description: (
        <>
          ¿Borrar la plantilla «{plantilla.nombre}» de esta cuenta? No se borran productos ni movimientos históricos.
        </>
      ),
      confirmLabel: 'Borrar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;

    setDeletingPlantillaId(plantilla.id);
    try {
      await fetchJson(`/api/despiece/plantillas/${plantilla.id}`, { method: 'DELETE' });
      setPlantillas((prev) => prev.filter((p) => p.id !== plantilla.id));
      toast.success('Plantilla borrada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo borrar la plantilla.');
    } finally {
      setDeletingPlantillaId(null);
    }
  }

  return (
    <>
      {ConfirmDialog}
      <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Despiece</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plantillas para calcular precios por corte desde el costo de una media, pollo o pieza padre.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/despiece/ingresos" className={cn(buttonVariants({ variant: 'outline' }))}>
            Ingresar carne
          </Link>
          <Button type="button" variant="outline" onClick={cargarPredeterminadas} disabled={creatingDefaults}>
            Cargar predeterminadas
          </Button>
          <Link href="/despiece/plantillas/nueva" className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Nueva plantilla
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-lg border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando...</p>
        ) : plantillas.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Todavía no hay plantillas de despiece.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>Producto padre</TableHead>
                <TableHead className="text-right">Peso</TableHead>
                <TableHead className="text-right">Rent. objetivo</TableHead>
                <TableHead className="text-right">Cortes</TableHead>
                <TableHead className="w-16 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plantillas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/despiece/plantillas/${p.id}`} className="hover:underline">
                      {p.nombre}
                    </Link>
                  </TableCell>
                  <TableCell>{p.producto_padre?.nombre ?? '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">{unidadBaseLabel(p)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(p.rentabilidad_objetivo_pct)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.cortes?.length ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      title="Borrar plantilla"
                      aria-label={`Borrar plantilla ${p.nombre}`}
                      disabled={deletingPlantillaId === p.id}
                      onClick={() => void borrarPlantilla(p)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      </div>
    </>
  );
}

function CorteProductoPicker({
  selected,
  excludedIds,
  onSelect,
  onCrear,
}: {
  selected?: ProductoMini;
  excludedIds: Set<string>;
  onSelect: (producto: ProductoMini) => void;
  onCrear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultados, setResultados] = useState<ProductoMini[]>([]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/despiece/productos-corte?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudo buscar productos.');
        setResultados(
          (json.productos ?? [])
            .map((p: ProductoMini) => asProductoMini(p))
            .filter((p: ProductoMini | null): p is ProductoMini => Boolean(p)),
        );
      } catch {
        if (!controller.signal.aborted) setResultados([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  const disponibles = resultados.filter((p) => p.id === selected?.id || !excludedIds.has(p.id));
  const inputValue = open ? query : selected?.nombre ?? '';

  return (
    <div className="relative">
      <div className="flex min-w-0 gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
          <Input
            value={inputValue}
            onFocus={() => {
              setOpen(true);
              setQuery('');
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            placeholder="Buscar producto kg/gramo"
            className="h-8 pl-7 text-sm font-medium"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            name={`despiece-producto-corte-${selected?.id ?? 'nuevo'}`}
            data-lpignore="true"
            data-form-type="other"
            title={
              selected
                ? `${selected.nombre} · ${selected.codigo ? `${selected.codigo} · ` : ''}${selected.unidad ?? 'kg'} · PLU ${pluCatalogoLabel(selected.plu)}`
                : undefined
            }
          />
          {open ? (
            <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
              {loading ? <div className="px-2 py-2 text-xs text-muted-foreground">Buscando...</div> : null}
              {!loading && disponibles.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">Sin productos pesables disponibles.</div>
              ) : null}
              {disponibles.map((producto) => (
                <button
                  key={producto.id}
                  type="button"
                  className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(producto);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <span className="block truncate font-medium">{producto.nombre}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {producto.codigo ? `${producto.codigo} · ` : ''}
                    {producto.unidad ?? 'kg'} · {money(producto.precio_venta)} · PLU {pluCatalogoLabel(producto.plu)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          title="Crear producto en el catalogo y asignarlo"
          onClick={onCrear}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function emptyForm(): PlantillaForm {
  return {
    nombre: '',
    producto_padre_id: '',
    peso_total_kg: 0,
    unidad_base_tipo: 'kg',
    unidad_base_nombre: '',
    unidad_base_cantidad: 1,
    unidad_contenedor_nombre: '',
    unidad_contenedor_cantidad: null,
    rentabilidad_objetivo_pct: 50,
    activo: true,
    notas: '',
    cortes: [],
  };
}

export function DespieceEditorClient({ plantillaId }: { plantillaId?: string }) {
  const router = useRouter();
  const { confirm: openConfirm, ConfirmDialog } = useConfirm();
  const [productos, setProductos] = useState<ProductoMini[]>([]);
  const [form, setForm] = useState<PlantillaForm>(emptyForm);
  const [loading, setLoading] = useState(Boolean(plantillaId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estrategia, setEstrategia] = useState<Exclude<DespieceEstrategia, 'correccion'>>('fija');
  const [calibracionCostoKg, setCalibracionCostoKg] = useState<number | null>(null);
  const [calibracionPesoTotalKg, setCalibracionPesoTotalKg] = useState<number | null>(null);
  const [calibracionCortes, setCalibracionCortes] = useState<CalibracionCorteForm[]>([]);
  const [calibracionResultado, setCalibracionResultado] =
    useState<DespieceCalibracionResultado | null>(null);
  const [calibracionIndices, setCalibracionIndices] = useState<number[]>([]);
  const [aplicarKgEjemplo, setAplicarKgEjemplo] = useState(true);
  const [guardarPrecioEjemplo, setGuardarPrecioEjemplo] = useState(true);
  const [corteCrearDialogRow, setCorteCrearDialogRow] = useState<number | null>(null);
  const [nuevoCorteNombre, setNuevoCorteNombre] = useState('');
  const [nuevoCorteCodigo, setNuevoCorteCodigo] = useState('');
  const [nuevoCorteEsPesable, setNuevoCorteEsPesable] = useState(true);
  const [creandoProductoCorte, setCreandoProductoCorte] = useState(false);
  const [catalogoSyncOpen, setCatalogoSyncOpen] = useState(false);
  const [catalogoSyncSelection, setCatalogoSyncSelection] = useState<CatalogoSyncSelection>({});
  const [syncingCatalogo, setSyncingCatalogo] = useState(false);

  useEffect(() => {
    async function loadProductos() {
      try {
        const json = await fetchJson('/api/productos?alcance=tenant&por_pagina=100&orden=actualizado');
        setProductos(mergeProductosMini([], json.productos ?? []));
      } catch {
        setProductos([]);
      }
    }
    void loadProductos();
  }, []);

  useEffect(() => {
    if (!plantillaId) return;
    async function loadPlantilla() {
      setLoading(true);
      try {
        const json = await fetchJson(`/api/despiece/plantillas/${plantillaId}`);
        const p = json.plantilla as PlantillaRow;
        const cortes = (p.cortes ?? [])
          .slice()
          .sort((a, b) => Number(a.orden) - Number(b.orden))
          .map((c, index) => ({
            producto_hijo_id: c.producto_hijo_id,
            nombre_en_plantilla: c.nombre_en_plantilla ?? c.producto_hijo?.nombre ?? '',
            plu_sugerido: c.plu_sugerido ?? '',
            kg_rendimiento: Number(c.kg_rendimiento),
            factor_ajuste_pct: Number(c.factor_ajuste_pct ?? 0),
            precio_anclado: c.precio_anclado == null ? null : Number(c.precio_anclado),
            orden: Number(c.orden ?? index),
          }));
        setProductos((prev) =>
          mergeProductosMini(prev, [p.producto_padre ?? null, ...(p.cortes ?? []).map((c) => c.producto_hijo ?? null)]),
        );
        setForm({
          id: p.id,
          nombre: p.nombre,
          producto_padre_id: p.producto_padre_id ?? '',
          peso_total_kg: Number(p.peso_total_kg),
          unidad_base_tipo: p.unidad_base_tipo === 'unidad' ? 'unidad' : 'kg',
          unidad_base_nombre: p.unidad_base_nombre ?? '',
          unidad_base_cantidad: Number(p.unidad_base_cantidad ?? 1),
          unidad_contenedor_nombre: p.unidad_contenedor_nombre ?? '',
          unidad_contenedor_cantidad:
            p.unidad_contenedor_cantidad == null ? null : Number(p.unidad_contenedor_cantidad),
          rentabilidad_objetivo_pct: Number(p.rentabilidad_objetivo_pct ?? 0),
          activo: p.activo,
          notas: p.notas ?? '',
          cortes,
        });
        setCalibracionPesoTotalKg(Number(p.peso_total_kg));
        setCalibracionCortes(
          cortes.map((c) => ({
            kg_rendimiento: c.kg_rendimiento > 0 ? c.kg_rendimiento : null,
            precio_venta_kg: c.precio_anclado,
          })),
        );
        setCalibracionResultado(null);
        setCalibracionIndices([]);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar.');
      } finally {
        setLoading(false);
      }
    }
    void loadPlantilla();
  }, [plantillaId]);

  useEffect(() => {
    setCalibracionCortes((prev) =>
      form.cortes.map((corte, index) => {
        const actual = prev[index];
        return {
          kg_rendimiento:
            actual?.kg_rendimiento ??
            (corte.kg_rendimiento > 0 ? corte.kg_rendimiento : null),
          precio_venta_kg: actual === undefined ? corte.precio_anclado : actual.precio_venta_kg,
        };
      }),
    );
  }, [form.cortes]);

  const productosPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const padre = form.producto_padre_id ? productosPorId.get(form.producto_padre_id) : undefined;

  useEffect(() => {
    if (!form.producto_padre_id) return;
    const p = productosPorId.get(form.producto_padre_id);
    if (!p) return;
    setCalibracionCostoKg((prev) => prev ?? Number(p.precio_costo));
  }, [form.producto_padre_id, productosPorId]);

  const costoKgReferencia = useMemo(() => {
    if (form.producto_padre_id && padre) {
      const n = Number(padre.precio_costo);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (calibracionCostoKg != null && Number.isFinite(calibracionCostoKg) && calibracionCostoKg > 0) {
      return calibracionCostoKg;
    }
    return null;
  }, [form.producto_padre_id, padre, calibracionCostoKg]);

  const resultado = useMemo<DespieceResultado | null>(() => {
    if (costoKgReferencia == null || form.cortes.length === 0) return null;
    const input: DespieceInput = {
      nombre: form.nombre,
      costoKgPadre: costoKgReferencia,
      pesoTotalKg: Number(form.peso_total_kg),
      rentabilidadObjetivoPct: Number(form.rentabilidad_objetivo_pct),
      cortes: form.cortes.map((corte) => ({
        id: corte.producto_hijo_id,
        nombre: corte.nombre_en_plantilla.trim() || productosPorId.get(corte.producto_hijo_id)?.nombre || 'Corte',
        kgRendimiento: Number(corte.kg_rendimiento),
        factorAjustePct: Number(corte.factor_ajuste_pct),
        precioAnclado: corte.precio_anclado,
      })),
    };
    try {
      return calcular4Estrategias(input);
    } catch {
      return null;
    }
  }, [form, costoKgReferencia, productosPorId]);

  const catalogoDiffs = useMemo<CatalogoDiff[]>(() => {
    return form.cortes
      .map((corte, rowIndex) => {
        const producto = productosPorId.get(corte.producto_hijo_id);
        if (!producto) return null;
        const nombreNuevo = corte.nombre_en_plantilla.trim();
        const pluNuevo = normalizarPlu5(corte.plu_sugerido);
        const corteResultado = resultado?.cortes[rowIndex];
        const precioPropuestoRaw =
          estrategia === 'variable'
            ? corteResultado?.variable.precioKg
            : estrategia === 'fija'
              ? corteResultado?.fija.precioKg
              : corteResultado?.anclada.precioKg;
        const precioPropuesto =
          precioPropuestoRaw == null || !Number.isFinite(Number(precioPropuestoRaw))
            ? null
            : round2(Number(precioPropuestoRaw));
        const costoPropuesto =
          precioPropuesto == null
            ? null
            : costoCatalogoDesdePrecioVentaDespiece(precioPropuesto, form.rentabilidad_objetivo_pct);
        const diff: CatalogoDiff = { producto_id: producto.id, rowIndex, producto };
        if (nombreNuevo && nombreNuevo !== producto.nombre) diff.nombre_nuevo = nombreNuevo;
        if (
          precioPropuesto != null &&
          (precioDistinto(precioPropuesto, producto.precio_venta) ||
            precioDistinto(costoPropuesto, producto.precio_costo))
        ) {
          diff.precio_nuevo = precioPropuesto;
        }
        if (pluNuevo && pluNuevo !== (producto.plu ?? null)) diff.plu_nuevo = pluNuevo;
        return diff.nombre_nuevo !== undefined || diff.precio_nuevo !== undefined || diff.plu_nuevo !== undefined
          ? diff
          : null;
      })
      .filter((diff): diff is CatalogoDiff => Boolean(diff));
  }, [estrategia, form.cortes, form.rentabilidad_objetivo_pct, productosPorId, resultado]);

  const costoKgEjemplo = calibracionCostoKg ?? Number(padre?.precio_costo ?? 0);
  const pesoTotalKgEjemplo =
    calibracionPesoTotalKg ?? (form.peso_total_kg > 0 ? form.peso_total_kg : null);
  const factorCalibradoPorIndex = useMemo(() => {
    const map = new Map<number, DespieceCalibracionResultado['cortes'][number]>();
    calibracionResultado?.cortes.forEach((corte, index) => {
      const formIndex = calibracionIndices[index];
      if (formIndex != null) map.set(formIndex, corte);
    });
    return map;
  }, [calibracionIndices, calibracionResultado]);

  function updateCorte(index: number, patch: Partial<CorteForm>) {
    setForm((prev) => ({
      ...prev,
      cortes: prev.cortes.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
    setCalibracionResultado(null);
    setCalibracionIndices([]);
  }

  function updateCalibracionCorte(index: number, patch: Partial<CalibracionCorteForm>) {
    setCalibracionCortes((prev) =>
      form.cortes.map((corte, i) => {
        const actual = prev[i] ?? {
          kg_rendimiento: corte.kg_rendimiento > 0 ? corte.kg_rendimiento : null,
          precio_venta_kg: corte.precio_anclado,
        };
        return i === index ? { ...actual, ...patch } : actual;
      }),
    );
    setCalibracionResultado(null);
    setCalibracionIndices([]);
  }

  function addCorte() {
    setForm((prev) => ({
      ...prev,
      cortes: [
        ...prev.cortes,
        {
          producto_hijo_id: '',
          nombre_en_plantilla: '',
          plu_sugerido: '',
          kg_rendimiento: 0,
          factor_ajuste_pct: 0,
          precio_anclado: null,
          orden: prev.cortes.length,
        },
      ],
    }));
    setCalibracionResultado(null);
    setCalibracionIndices([]);
  }

  function removeCorte(index: number) {
    setForm((p) => ({ ...p, cortes: p.cortes.filter((_, i) => i !== index) }));
    setCalibracionCortes((prev) => prev.filter((_, i) => i !== index));
    setCalibracionResultado(null);
    setCalibracionIndices([]);
  }

  function openCrearCorteProducto(rowIndex: number) {
    setCorteCrearDialogRow(rowIndex);
    setNuevoCorteNombre('');
    setNuevoCorteCodigo('');
    setNuevoCorteEsPesable(true);
  }

  async function crearCorteProductoDesdeDialog() {
    const nombre = nuevoCorteNombre.trim();
    if (!nombre) {
      toast.error('Ingresá el nombre del corte o pieza.');
      return;
    }
    const codigoManual = nuevoCorteCodigo.trim();
    const codigo =
      codigoManual ||
      `DSC-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const unidad = nuevoCorteEsPesable ? 'kg' : 'unidad';
    setCreandoProductoCorte(true);
    try {
      const res = await fetch('/api/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo,
          nombre,
          unidad,
          es_pesable: nuevoCorteEsPesable,
          precio_costo: 0,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : 'No se pudo crear el producto.');
      }
      const p = json as {
        id: string;
        codigo?: string | null;
        nombre: string;
        precio_costo: number | null;
        precio_venta: number | null;
        unidad?: string;
        plu?: string | null;
      };
      const mini: ProductoMini = {
        id: p.id,
        codigo: p.codigo ?? null,
        nombre: p.nombre,
        precio_costo: Number(p.precio_costo ?? 0),
        precio_venta: Number(p.precio_venta ?? 0),
        unidad: p.unidad,
        plu: p.plu ?? null,
        es_pesable: nuevoCorteEsPesable,
        activo: true,
      };
      setProductos((prev) => mergeProductosMini(prev, [mini]));
      const row = corteCrearDialogRow;
      if (row != null) {
        const actual = form.cortes[row];
        updateCorte(row, {
          producto_hijo_id: mini.id,
          nombre_en_plantilla: actual?.nombre_en_plantilla.trim() || mini.nombre,
          plu_sugerido: actual?.plu_sugerido ?? '',
        });
      }
      setCorteCrearDialogRow(null);
      toast.success('Producto creado y asignado al corte.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el producto.');
    } finally {
      setCreandoProductoCorte(false);
    }
  }

  function calibrarFactores() {
    if (!Number.isFinite(costoKgEjemplo) || costoKgEjemplo <= 0) {
      toast.error('Cargá el costo por kg del ejemplo.');
      return;
    }
    if (!Number.isFinite(pesoTotalKgEjemplo) || !pesoTotalKgEjemplo || pesoTotalKgEjemplo <= 0) {
      toast.error('Cargá el peso total del ejemplo.');
      return;
    }

    const filas = form.cortes
      .map((corte, index) => {
        const ejemplo = calibracionCortes[index];
        const kg = ejemplo?.kg_rendimiento ?? corte.kg_rendimiento;
        const precio = ejemplo?.precio_venta_kg ?? corte.precio_anclado;
        return {
          index,
          productoId: corte.producto_hijo_id,
          nombre:
            corte.nombre_en_plantilla.trim() ||
            productosPorId.get(corte.producto_hijo_id)?.nombre ||
            `Corte ${index + 1}`,
          kg,
          precio,
        };
      })
      .filter((fila) => fila.productoId || fila.kg != null || fila.precio != null);

    if (filas.length === 0) {
      toast.error('Agregá al menos un corte para calibrar factores.');
      return;
    }
    const precioValido = (precio: number | null) => Number.isFinite(precio) && Number(precio) >= 0;
    const usaPreciosVendidos = filas.some((fila) => precioValido(fila.precio));
    const incompletas = filas.filter(
      (fila) =>
        !fila.productoId ||
        !Number.isFinite(fila.kg) ||
        Number(fila.kg) <= 0 ||
        (usaPreciosVendidos && !precioValido(fila.precio)),
    );
    if (incompletas.length > 0) {
      toast.error(
        usaPreciosVendidos
          ? 'Completá producto, kg y precio vendido en cada corte del ejemplo.'
          : 'Completá producto y kg en cada corte del ejemplo.',
      );
      return;
    }

    const rentabilidadObjetivo = Number(form.rentabilidad_objetivo_pct);
    if (!usaPreciosVendidos && (!Number.isFinite(rentabilidadObjetivo) || rentabilidadObjetivo < -100)) {
      toast.error('Cargá una rentabilidad objetivo mayor o igual a -100.');
      return;
    }

    try {
      const cortesCalibracion = filas.map((fila) => ({
        id: fila.productoId,
        nombre: fila.nombre,
        kgRendimiento: Number(fila.kg),
      }));
      const calibracion = usaPreciosVendidos
        ? calibrarFactoresDesdeEjemplo({
            nombre: form.nombre,
            costoKgPadre: costoKgEjemplo,
            pesoTotalKg: pesoTotalKgEjemplo,
            cortes: cortesCalibracion.map((corte, index) => ({
              ...corte,
              precioVentaKg: Number(filas[index].precio),
            })),
          })
        : calcularFactoresPorRentabilidadObjetivo({
            nombre: form.nombre,
            costoKgPadre: costoKgEjemplo,
            pesoTotalKg: pesoTotalKgEjemplo,
            rentabilidadObjetivoPct: rentabilidadObjetivo,
            cortes: cortesCalibracion,
          });
      const calibradosPorIndex = new Map(
        filas.map((fila, index) => [fila.index, calibracion.cortes[index]]),
      );

      setForm((prev) => ({
        ...prev,
        peso_total_kg: pesoTotalKgEjemplo,
        cortes: prev.cortes.map((corte, index) => {
          const calibrado = calibradosPorIndex.get(index);
          if (!calibrado) return corte;
          return {
            ...corte,
            kg_rendimiento: aplicarKgEjemplo ? calibrado.kgRendimiento : corte.kg_rendimiento,
            factor_ajuste_pct: roundFactor(calibrado.factorAjustePct),
            precio_anclado: guardarPrecioEjemplo ? calibrado.precioVentaKg : corte.precio_anclado,
          };
        }),
      }));
      setCalibracionResultado(calibracion);
      setCalibracionIndices(filas.map((fila) => fila.index));
      toast.success(
        usaPreciosVendidos
          ? `Factores calculados para ${calibracion.cortes.length} corte(s).`
          : `Precio parejo calculado para ${calibracion.cortes.length} corte(s).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron calcular los factores.');
    }
  }

  function buildPlantillaPayload() {
    return {
      nombre: form.nombre,
      producto_padre_id: form.producto_padre_id.trim() || null,
      peso_total_kg: form.peso_total_kg,
      unidad_base_tipo: form.unidad_base_tipo,
      unidad_base_nombre: form.unidad_base_tipo === 'unidad' ? form.unidad_base_nombre.trim() : null,
      unidad_base_cantidad: form.unidad_base_tipo === 'unidad' ? form.unidad_base_cantidad : 1,
      unidad_contenedor_nombre:
        form.unidad_base_tipo === 'unidad' ? form.unidad_contenedor_nombre.trim() || null : null,
      unidad_contenedor_cantidad:
        form.unidad_base_tipo === 'unidad' ? form.unidad_contenedor_cantidad : null,
      rentabilidad_objetivo_pct: form.rentabilidad_objetivo_pct,
      activo: form.activo,
      notas: form.notas,
      cortes: form.cortes.map((c, index) => ({ ...c, orden: index })),
    };
  }

  async function save() {
    setSaving(true);
    try {
      const json = await fetchJson(
        plantillaId ? `/api/despiece/plantillas/${plantillaId}` : '/api/despiece/plantillas',
        {
          method: plantillaId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPlantillaPayload()),
        },
      );
      toast.success('Plantilla guardada');
      if (!plantillaId) router.replace(`/despiece/plantillas/${json.plantilla.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  function abrirSyncCatalogo() {
    if (!plantillaId) {
      toast.info('Guarda la plantilla antes de sincronizar el catalogo.');
      return;
    }
    if (catalogoDiffs.length === 0) {
      toast.info('No hay diferencias de nombre, precio o PLU para aplicar.');
      return;
    }
    setCatalogoSyncSelection(
      Object.fromEntries(
        catalogoDiffs.map((diff) => [
          diff.producto_id,
          {
            aplicar_nombre: diff.nombre_nuevo !== undefined,
            aplicar_precio: diff.precio_nuevo !== undefined,
            aplicar_plu: diff.plu_nuevo !== undefined,
          },
        ]),
      ),
    );
    setCatalogoSyncOpen(true);
  }

  function updateCatalogoSyncSelection(
    productoId: string,
    field: keyof CatalogoSyncSelection[string],
    checked: boolean,
  ) {
    setCatalogoSyncSelection((prev) => ({
      ...prev,
      [productoId]: {
        aplicar_nombre: prev[productoId]?.aplicar_nombre ?? false,
        aplicar_precio: prev[productoId]?.aplicar_precio ?? false,
        aplicar_plu: prev[productoId]?.aplicar_plu ?? false,
        [field]: checked,
      },
    }));
  }

  async function sincronizarCatalogo() {
    if (!plantillaId) return;
    const cambios = catalogoDiffs
      .map((diff) => ({
        producto_id: diff.producto_id,
        aplicar_nombre: diff.nombre_nuevo !== undefined && catalogoSyncSelection[diff.producto_id]?.aplicar_nombre === true,
        aplicar_precio: diff.precio_nuevo !== undefined && catalogoSyncSelection[diff.producto_id]?.aplicar_precio === true,
        aplicar_plu: diff.plu_nuevo !== undefined && catalogoSyncSelection[diff.producto_id]?.aplicar_plu === true,
        precio_nuevo: diff.precio_nuevo,
      }))
      .filter((row) => row.aplicar_nombre || row.aplicar_precio || row.aplicar_plu);

    if (cambios.length === 0) {
      toast.info('Selecciona al menos un cambio.');
      return;
    }

    setSyncingCatalogo(true);
    try {
      await fetchJson(`/api/despiece/plantillas/${plantillaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPlantillaPayload()),
      });
      const json = await fetchJson(`/api/despiece/plantillas/${plantillaId}/sincronizar-catalogo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cambios }),
      });
      const cambiosAplicados = new Map<string, CambioCatalogoAplicado>(
        ((json.cambios ?? []) as CambioCatalogoAplicado[]).map((c) => [c.producto_id, c]),
      );
      setProductos((prev) =>
        prev.map((producto) => {
          const cambio = cambiosAplicados.get(producto.id);
          if (!cambio) return producto;
          return {
            ...producto,
            nombre: cambio.nombre_nuevo ?? producto.nombre,
            precio_costo: cambio.precio_costo_nuevo ?? producto.precio_costo,
            precio_venta: cambio.precio_nuevo ?? producto.precio_venta,
            plu: cambio.plu_nuevo ?? producto.plu,
          };
        }),
      );
      setCatalogoSyncOpen(false);
      toast.success(`Catalogo actualizado: ${json.cambios?.length ?? 0} cambio(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo sincronizar el catalogo.');
    } finally {
      setSyncingCatalogo(false);
    }
  }

  async function aplicar() {
    if (!plantillaId) {
      toast.info('Guardá la plantilla antes de aplicar precios.');
      return;
    }
    setSaving(true);
    try {
      const json = await fetchJson(`/api/despiece/plantillas/${plantillaId}/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estrategia,
          ...(costoKgReferencia != null ? { costo_kg: costoKgReferencia } : {}),
        }),
      });
      toast.success(`Precios aplicados: ${json.diff?.length ?? 0} producto(s) actualizados`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo aplicar.');
    } finally {
      setSaving(false);
    }
  }

  async function borrarPlantillaActual() {
    if (!plantillaId) return;
    const ok = await openConfirm({
      title: 'Borrar plantilla',
      description: (
        <>
          ¿Borrar la plantilla «{form.nombre || 'Sin nombre'}» de esta cuenta? No se borran productos ni movimientos
          históricos.
        </>
      ),
      confirmLabel: 'Borrar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;

    setSaving(true);
    try {
      await fetchJson(`/api/despiece/plantillas/${plantillaId}`, { method: 'DELETE' });
      toast.success('Plantilla borrada');
      router.replace('/despiece/plantillas');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo borrar la plantilla.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando plantilla...</p>;

  return (
    <>
      {ConfirmDialog}
      <div className="mx-auto w-full max-w-[100rem] space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {plantillaId ? 'Editar despiece' : 'Nueva plantilla de despiece'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Definí cortes y kg; el costo puede salir de un producto padre en catálogo o del costo/kg de referencia (bloque
            calibración).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/despiece/plantillas" className={cn(buttonVariants({ variant: 'outline' }))}>
            Volver
          </Link>
          {plantillaId ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void borrarPlantillaActual()}
              disabled={saving}
            >
              <Trash2 className="size-4" />
              Borrar
            </Button>
          ) : null}
          <Button onClick={save} disabled={saving}>
            <Save className="size-4" />
            Guardar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={abrirSyncCatalogo}
            disabled={saving || syncingCatalogo || catalogoDiffs.length === 0}
          >
            <RefreshCw className="size-4" />
            Aplicar catalogo
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="grid min-w-0 gap-4">
        <div className="min-w-0 space-y-4 rounded-lg border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Nombre</span>
              <Input value={form.nombre} onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Producto padre (opcional)</span>
              <select
                value={form.producto_padre_id}
                onChange={(e) => {
                  const productoId = e.target.value;
                  const nextPadre = productosPorId.get(productoId);
                  setForm((p) => ({ ...p, producto_padre_id: productoId }));
                  if (productoId && nextPadre) {
                    setCalibracionCostoKg(Number(nextPadre.precio_costo));
                  }
                }}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="">Sin producto padre</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} - costo {money(p.precio_costo)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Peso total kg</span>
              <Input
                type="number"
                step="0.001"
                value={form.peso_total_kg}
                onChange={(e) => {
                  const peso = Number(e.target.value);
                  const pesoAnterior = form.peso_total_kg;
                  setForm((p) => ({ ...p, peso_total_kg: peso }));
                  setCalibracionPesoTotalKg((prev) => (prev == null || prev === pesoAnterior ? peso : prev));
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Entrada base</span>
              <select
                value={form.unidad_base_tipo}
                onChange={(e) => {
                  const tipo = e.target.value === 'unidad' ? 'unidad' : 'kg';
                  setForm((p) => ({
                    ...p,
                    unidad_base_tipo: tipo,
                    unidad_base_nombre: tipo === 'unidad' ? p.unidad_base_nombre || 'unidades' : '',
                    unidad_base_cantidad: tipo === 'unidad' ? p.unidad_base_cantidad || 1 : 1,
                    unidad_contenedor_nombre: tipo === 'unidad' ? p.unidad_contenedor_nombre : '',
                    unidad_contenedor_cantidad: tipo === 'unidad' ? p.unidad_contenedor_cantidad : null,
                  }));
                }}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="kg">Kg ingresados</option>
                <option value="unidad">Unidades (pollos/cajones)</option>
              </select>
            </label>
            {form.unidad_base_tipo === 'unidad' ? (
              <>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Nombre unidad</span>
                  <Input
                    value={form.unidad_base_nombre}
                    placeholder="pollos"
                    onChange={(e) => setForm((p) => ({ ...p, unidad_base_nombre: e.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Cantidad base</span>
                  <Input
                    type="number"
                    step="0.001"
                    value={form.unidad_base_cantidad}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        unidad_base_cantidad: e.target.value === '' ? 0 : Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Contenedor</span>
                  <Input
                    value={form.unidad_contenedor_nombre}
                    placeholder="cajon"
                    onChange={(e) => setForm((p) => ({ ...p, unidad_contenedor_nombre: e.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Unid./contenedor</span>
                  <Input
                    type="number"
                    step="0.001"
                    value={form.unidad_contenedor_cantidad ?? ''}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        unidad_contenedor_cantidad: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                  />
                </label>
              </>
            ) : null}
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Rentabilidad objetivo %</span>
              <Input
                type="number"
                step="0.01"
                value={form.rentabilidad_objetivo_pct}
                onChange={(e) => setForm((p) => ({ ...p, rentabilidad_objetivo_pct: Number(e.target.value) }))}
              />
            </label>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Calibrar factores con ejemplo real</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Costo y kg rendidos; sin precios se reparte por kg con la rentabilidad objetivo.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={calibrarFactores}>
                <Calculator className="size-4" />
                Calcular factores
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Costo/kg ejemplo</span>
                <Input
                  type="number"
                  step="0.01"
                  value={calibracionCostoKg ?? ''}
                  onChange={(e) =>
                    setCalibracionCostoKg(e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Peso total ejemplo kg</span>
                <Input
                  type="number"
                  step="0.001"
                  value={calibracionPesoTotalKg ?? ''}
                  onChange={(e) =>
                    setCalibracionPesoTotalKg(e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </label>
              <label className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aplicarKgEjemplo}
                  onChange={(e) => setAplicarKgEjemplo(e.target.checked)}
                />
                <span>Usar kg del ejemplo</span>
              </label>
              <label className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={guardarPrecioEjemplo}
                  onChange={(e) => setGuardarPrecioEjemplo(e.target.checked)}
                />
                <span>Guardar precio vendido/calculado</span>
              </label>
            </div>

            {calibracionResultado ? (
              <div className="grid gap-2 border-y py-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <span className="block text-xs text-muted-foreground">Base/kg rendido</span>
                  <b>{money(calibracionResultado.precioBaseKgRendido)}</b>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground">Venta ejemplo</span>
                  <b>{money(calibracionResultado.ventaTotalEjemplo)}</b>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground">Rentabilidad real</span>
                  <b>{pct(calibracionResultado.rentabilidadEjemploPct)}</b>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        rentabilidad_objetivo_pct: Number(calibracionResultado.rentabilidadEjemploPct.toFixed(2)),
                      }))
                    }
                  >
                    Usar como objetivo
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="min-w-0 overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">Corte</TableHead>
                    <TableHead className="w-32 text-right">Kg ejemplo</TableHead>
                    <TableHead className="w-40 text-right">Precio vendido/kg (opcional)</TableHead>
                    <TableHead className="w-32 text-right">Factor generado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.cortes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        Agregá cortes para calibrar.
                      </TableCell>
                    </TableRow>
                  ) : (
                    form.cortes.map((corte, index) => {
                      const ejemplo = calibracionCortes[index];
                      const calibrado = factorCalibradoPorIndex.get(index);
                      return (
                        <TableRow key={index}>
                          <TableCell className="font-medium">
                            {corte.nombre_en_plantilla.trim() ||
                              productosPorId.get(corte.producto_hijo_id)?.nombre ||
                              'Corte sin producto'}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.001"
                              value={ejemplo?.kg_rendimiento ?? ''}
                              className="text-right"
                              onChange={(e) =>
                                updateCalibracionCorte(index, {
                                  kg_rendimiento: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={ejemplo?.precio_venta_kg ?? ''}
                              className="text-right"
                              onChange={(e) =>
                                updateCalibracionCorte(index, {
                                  precio_venta_kg: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {calibrado ? factorPct(calibrado.factorAjustePct) : '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Cortes</h2>
            <Button type="button" variant="outline" size="sm" onClick={addCorte}>
              <Plus className="size-4" />
              Agregar corte
            </Button>
          </div>

          <div className="rounded-lg border">
            {form.cortes.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                Agregá cortes para calcular precios.
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[2rem_minmax(10rem,1.35fr)_minmax(9rem,1fr)_6rem_5.5rem_6.5rem_7.5rem_7.5rem_2rem] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground xl:grid">
                  <span>#</span>
                  <span>Producto</span>
                  <span>Nombre</span>
                  <span>PLU</span>
                  <span className="text-right">Kg</span>
                  <span className="text-right">Factor</span>
                  <span className="text-right">Anclado</span>
                  <span className="text-right">Calc.</span>
                  <span />
                </div>
                <div className="divide-y">
                  {form.cortes.map((corte, index) => {
                    const r = resultado?.cortes[index];
                    const precio =
                      estrategia === 'variable'
                        ? r?.variable.precioKg
                        : estrategia === 'fija'
                          ? r?.fija.precioKg
                          : r?.anclada.precioKg;
                    const producto = productosPorId.get(corte.producto_hijo_id);
                    const excludedIds = new Set(
                      form.cortes
                        .map((c, i) => (i === index ? '' : c.producto_hijo_id))
                        .filter(Boolean),
                    );
                    const nombrePlantilla = corte.nombre_en_plantilla.trim();
                    const nombreDifiere = Boolean(producto && nombrePlantilla && nombrePlantilla !== producto.nombre);
                    const pluNormalizado = normalizarPlu5(corte.plu_sugerido);
                    const pluDifiere = Boolean(producto && pluNormalizado && pluNormalizado !== (producto.plu ?? null));
                    const precioDifiere = Boolean(
                      producto &&
                        corte.precio_anclado != null &&
                        precioDistinto(corte.precio_anclado, producto.precio_venta),
                    );

                    return (
                      <div
                        key={index}
                        className="grid gap-2 px-3 py-2 sm:grid-cols-2 xl:grid-cols-[2rem_minmax(10rem,1.35fr)_minmax(9rem,1fr)_6rem_5.5rem_6.5rem_7.5rem_7.5rem_2rem]"
                      >
                        <div className="flex items-center text-xs font-medium text-muted-foreground">
                          {index + 1}
                        </div>

                        <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            Producto
                          </span>
                          <CorteProductoPicker
                            selected={producto}
                            excludedIds={excludedIds}
                            onSelect={(p) => {
                              setProductos((prev) => mergeProductosMini(prev, [p]));
                              const adoptarNombre = !nombrePlantilla || nombrePlantilla === producto?.nombre;
                              updateCorte(index, {
                                producto_hijo_id: p.id,
                                nombre_en_plantilla: adoptarNombre ? p.nombre : nombrePlantilla,
                              });
                            }}
                            onCrear={() => openCrearCorteProducto(index)}
                          />
                        </div>

                        <label className="min-w-0">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            Nombre
                          </span>
                          <Input
                            value={corte.nombre_en_plantilla}
                            onChange={(e) => updateCorte(index, { nombre_en_plantilla: e.target.value })}
                            placeholder={producto?.nombre ?? 'Nombre del corte'}
                            className="h-8 text-sm"
                          />
                          {nombreDifiere ? (
                            <span className="block truncate pt-0.5 text-[11px] leading-4 text-amber-600">
                              Catálogo: {producto?.nombre}
                            </span>
                          ) : null}
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            PLU
                          </span>
                          <Input
                            inputMode="numeric"
                            value={corte.plu_sugerido}
                            onChange={(e) =>
                              updateCorte(index, {
                                plu_sugerido: e.target.value.replace(/\D/g, '').slice(0, 5),
                              })
                            }
                            onBlur={(e) =>
                              updateCorte(index, { plu_sugerido: normalizarPlu5(e.target.value) ?? '' })
                            }
                            placeholder={producto?.plu ?? '00000'}
                            className="h-8 text-sm"
                          />
                          {pluDifiere ? (
                            <span className="block truncate pt-0.5 text-[11px] leading-4 text-amber-600">
                              Catálogo: {pluCatalogoLabel(producto?.plu)}
                            </span>
                          ) : null}
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            Kg
                          </span>
                          <Input
                            type="number"
                            step="0.001"
                            value={corte.kg_rendimiento}
                            className="h-8 text-right text-sm"
                            onChange={(e) => updateCorte(index, { kg_rendimiento: Number(e.target.value) })}
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            Factor
                          </span>
                          <Input
                            type="number"
                            step="0.0001"
                            value={corte.factor_ajuste_pct}
                            className="h-8 text-right text-sm"
                            onChange={(e) => updateCorte(index, { factor_ajuste_pct: Number(e.target.value) })}
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            Anclado
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            value={corte.precio_anclado ?? ''}
                            className="h-8 text-right text-sm"
                            onChange={(e) =>
                              updateCorte(index, {
                                precio_anclado: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                          {precioDifiere ? (
                            <span className="block truncate pt-0.5 text-[11px] leading-4 text-amber-600">
                              Catálogo: {money(producto?.precio_venta)}
                            </span>
                          ) : null}
                        </label>

                        <div>
                          <span className="mb-1 block text-xs font-medium text-muted-foreground xl:hidden">
                            Precio calc.
                          </span>
                          <div className="flex h-8 items-center justify-end rounded-md border bg-muted/30 px-2 text-sm font-medium tabular-nums">
                            {money(precio)}
                          </div>
                        </div>

                        <div className="flex items-start justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeCorte(index)}
                            aria-label="Quitar corte"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Resumen</h2>
            {resultado ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kg vendibles</span>
                  <b>
                    {fmtKg(resultado.kgRendimientoTotal)} kg
                  </b>
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rendimiento</span><b>{pct(resultado.rendimientoPct)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Costo total</span><b>{money(resultado.costoTotal)}</b></div>
                <div className="border-t pt-2">
                  {(['variable', 'fija', 'anclada'] as const).map((key) => (
                    <label key={key} className="mt-2 flex cursor-pointer items-start gap-2 rounded-md border p-2">
                      <input
                        type="radio"
                        checked={estrategia === key}
                        onChange={() => setEstrategia(key)}
                        className="mt-1"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium capitalize">{key}</span>
                        <span className="block text-xs text-muted-foreground">
                          Venta {money(resultado.resumen[key].ventaTotal)} · Rent. {pct(resultado.resumen[key].rentabilidadPct)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Completá peso total, costo/kg (producto padre o «Costo/kg ejemplo») y cortes.
              </p>
            )}
          </div>

          <Button type="button" className="w-full justify-center" onClick={aplicar} disabled={saving || !resultado}>
            <Check className="size-4" />
            Aplicar estrategia
          </Button>
        </aside>
      </section>

      <Dialog open={catalogoSyncOpen} onOpenChange={setCatalogoSyncOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Aplicar cambios al catalogo</DialogTitle>
            <DialogDescription>
              Se guarda la plantilla y despues se actualizan solo los campos marcados en productos existentes.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-auto py-1">
            {catalogoDiffs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay diferencias pendientes.</p>
            ) : (
              catalogoDiffs.map((diff) => {
                const sel = catalogoSyncSelection[diff.producto_id] ?? {
                  aplicar_nombre: false,
                  aplicar_precio: false,
                  aplicar_plu: false,
                };
                return (
                  <div key={`${diff.producto_id}-${diff.rowIndex}`} className="rounded-md border p-3">
                    <div className="text-sm font-medium">{diff.producto.nombre}</div>
                    <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                      {diff.nombre_nuevo !== undefined ? (
                        <label className="flex cursor-pointer gap-2">
                          <input
                            type="checkbox"
                            checked={sel.aplicar_nombre}
                            onChange={(e) =>
                              updateCatalogoSyncSelection(diff.producto_id, 'aplicar_nombre', e.target.checked)
                            }
                          />
                          <span>
                            Nombre: <b>{diff.nombre_nuevo}</b>
                          </span>
                        </label>
                      ) : null}
                      {diff.precio_nuevo !== undefined ? (
                        <label className="flex cursor-pointer gap-2">
                          <input
                            type="checkbox"
                            checked={sel.aplicar_precio}
                            onChange={(e) =>
                              updateCatalogoSyncSelection(diff.producto_id, 'aplicar_precio', e.target.checked)
                            }
                          />
                          <span>
                            Precio: {money(diff.producto.precio_venta)} {'->'} <b>{money(diff.precio_nuevo)}</b>
                          </span>
                        </label>
                      ) : null}
                      {diff.plu_nuevo !== undefined ? (
                        <label className="flex cursor-pointer gap-2">
                          <input
                            type="checkbox"
                            checked={sel.aplicar_plu}
                            onChange={(e) =>
                              updateCatalogoSyncSelection(diff.producto_id, 'aplicar_plu', e.target.checked)
                            }
                          />
                          <span>
                            PLU: {pluCatalogoLabel(diff.producto.plu)} {'->'} <b>{diff.plu_nuevo}</b>
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCatalogoSyncOpen(false)}
              disabled={syncingCatalogo}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void sincronizarCatalogo()}
              disabled={
                syncingCatalogo ||
                !catalogoDiffs.some((diff) => {
                  const sel = catalogoSyncSelection[diff.producto_id];
                  return sel?.aplicar_nombre || sel?.aplicar_precio || sel?.aplicar_plu;
                })
              }
            >
              Aplicar seleccion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={corteCrearDialogRow !== null}
        onOpenChange={(open) => {
          if (!open) setCorteCrearDialogRow(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo corte / pieza</DialogTitle>
            <DialogDescription>
              Se crea un producto en tu catálogo (sucursal actual), pesable en kg por defecto, y se asigna a esta fila.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Nombre</span>
              <Input
                value={nuevoCorteNombre}
                onChange={(e) => setNuevoCorteNombre(e.target.value)}
                placeholder="Ej. Pechuga con piel"
                autoFocus
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Código interno (opcional)</span>
              <Input
                value={nuevoCorteCodigo}
                onChange={(e) => setNuevoCorteCodigo(e.target.value)}
                placeholder="Se genera solo si lo dejás vacío"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nuevoCorteEsPesable}
                onChange={(e) => setNuevoCorteEsPesable(e.target.checked)}
              />
              <span>Pesable en balanza (stock en kg)</span>
            </label>
          </div>
          <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCorteCrearDialogRow(null)}
              disabled={creandoProductoCorte}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void crearCorteProductoDesdeDialog()}
              disabled={creandoProductoCorte || !nuevoCorteNombre.trim()}
            >
              Crear y asignar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}
