'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Eye } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { hoyEnAR } from '@/lib/utils/formatters';

import { DialogPredeterminadas } from './predeterminadas-dialog';

type PlantillaCorte = {
  producto_hijo_id: string;
  kg_rendimiento?: number | string | null;
  precio_anclado?: number | string | null;
  producto_hijo?: { precio_venta?: number | string | null } | null;
};

type Plantilla = {
  id: string;
  nombre: string;
  peso_total_kg: number;
  unidad_base_tipo?: string | null;
  unidad_base_nombre?: string | null;
  unidad_base_cantidad?: number | string | null;
  unidad_contenedor_nombre?: string | null;
  unidad_contenedor_cantidad?: number | string | null;
  rentabilidad_objetivo_pct: number | null;
  producto_padre?: { id: string; nombre: string; precio_costo: number; proveedor_id?: string | null } | null;
  cortes?: PlantillaCorte[];
};

type IngresoResult = {
  costo_efectivo_kg_corte: number;
  kg_vendibles: number;
  merma_kg: number;
  merma_pct: number;
  rendimiento_pct: number;
  comprobante_compra_id?: string | null;
  movimiento_padre?: {
    producto_id: string;
    nombre: string;
    cantidad: number;
    movimiento_id: string | null;
    comprobante_id: string | null;
  } | null;
  movimientos: Array<{ producto_id: string; nombre: string; cantidad: number; precio_venta_nuevo: number | null }>;
};

type PreviewRow = IngresoResult['movimientos'][number];

type Proveedor = {
  id: string;
  nombre: string;
  activo?: boolean;
};

const TIPO_COMPRA_OPTS = [
  { value: 'factura_a', label: 'Factura A' },
  { value: 'factura_b', label: 'Factura B' },
  { value: 'factura_c', label: 'Factura C' },
  { value: 'remito', label: 'Remito' },
] as const;

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'No se pudo completar la operación.');
  return json;
}

function money(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function fmtCantidad(value: number | string | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

function esPlantillaPorUnidad(plantilla: Plantilla | null) {
  return plantilla?.unidad_base_tipo === 'unidad';
}

function nombreUnidadBase(plantilla: Plantilla | null) {
  return plantilla?.unidad_base_nombre?.trim() || 'unidades';
}

function cantidadUnidadBase(plantilla: Plantilla | null) {
  const n = Number(plantilla?.unidad_base_cantidad ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function unidadesPorContenedor(plantilla: Plantilla | null) {
  const n = Number(plantilla?.unidad_contenedor_cantidad ?? cantidadUnidadBase(plantilla));
  return Number.isFinite(n) && n > 0 ? n : cantidadUnidadBase(plantilla);
}

function pesoKgDesdeUnidades(plantilla: Plantilla | null, cantidad: number) {
  const pesoBase = Number(plantilla?.peso_total_kg ?? 0);
  const cantidadBase = cantidadUnidadBase(plantilla);
  if (!Number.isFinite(pesoBase) || pesoBase <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) return 0;
  return round3((cantidad / cantidadBase) * pesoBase);
}

function basePlantillaLabel(plantilla: Plantilla | null) {
  const pesoBase = Number(plantilla?.peso_total_kg ?? 0);
  if (!esPlantillaPorUnidad(plantilla)) return `${pesoBase.toFixed(3)} kg`;
  return `${pesoBase.toFixed(3)} kg / ${fmtCantidad(cantidadUnidadBase(plantilla))} ${nombreUnidadBase(plantilla)}`;
}

/** Precio vendible definido en la plantilla: precio anclado del corte o, si no hay, precio de venta del producto hijo. */
function precioVendibleDesdePlantilla(plantilla: Plantilla | null, productoId: string): number | null {
  if (!plantilla?.cortes?.length) return null;
  const corte = plantilla.cortes.find((c) => c.producto_hijo_id === productoId);
  if (!corte) return null;
  const ancladoRaw = corte.precio_anclado;
  if (ancladoRaw != null && ancladoRaw !== '') {
    const n = Number(ancladoRaw);
    if (Number.isFinite(n) && n >= 0) return round2(n);
  }
  const pvRaw = corte.producto_hijo?.precio_venta;
  if (pvRaw != null && pvRaw !== '') {
    const n = Number(pvRaw);
    if (Number.isFinite(n) && n >= 0) return round2(n);
  }
  return null;
}

function preciosPlantillaPorMovimientos(
  plantilla: Plantilla | null,
  movimientos: PreviewRow[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of movimientos) {
    const p = precioVendibleDesdePlantilla(plantilla, row.producto_id);
    if (p != null) out[row.producto_id] = String(p);
  }
  return out;
}

export function DespieceIngresosClient() {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [plantillaId, setPlantillaId] = useState('');
  const [pesoIngresado, setPesoIngresado] = useState(0);
  const [cantidadModo, setCantidadModo] = useState<'kg' | 'unidad' | 'contenedor'>('kg');
  const [cantidadUnidad, setCantidadUnidad] = useState('');
  const [cantidadContenedores, setCantidadContenedores] = useState('');
  const [unidadesContenedor, setUnidadesContenedor] = useState('');
  const [costoKg, setCostoKg] = useState(0);
  const [mermaPct, setMermaPct] = useState('');
  const [mermaKg, setMermaKg] = useState('');
  const [mermaOrigen, setMermaOrigen] = useState<'pct' | 'kg'>('pct');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [registrarIngresoPadre, setRegistrarIngresoPadre] = useState(false);
  const [registrarFacturaCompra, setRegistrarFacturaCompra] = useState(false);
  const [tipoComprobanteCompra, setTipoComprobanteCompra] = useState<(typeof TIPO_COMPRA_OPTS)[number]['value']>('factura_c');
  const [fechaCompra, setFechaCompra] = useState(() => hoyEnAR());
  const [fechaVencimientoCompra, setFechaVencimientoCompra] = useState(() => hoyEnAR());
  const [puntoVentaCompra, setPuntoVentaCompra] = useState('');
  const [numeroDocumentoCompra, setNumeroDocumentoCompra] = useState('');
  const [observacionesCompra, setObservacionesCompra] = useState('');
  const [aplicarPrecios, setAplicarPrecios] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<IngresoResult | null>(null);
  const [preview, setPreview] = useState<IngresoResult | null>(null);
  const [preciosEditados, setPreciosEditados] = useState<Record<string, string>>({});
  const [cantidadesEditadas, setCantidadesEditadas] = useState<Record<string, string>>({});
  const [dialogPredeterminadasOpen, setDialogPredeterminadasOpen] = useState(false);

  const selected = plantillas.find((p) => p.id === plantillaId) ?? null;
  const previewKgVendibles = preview
    ? round3(
        preview.movimientos.reduce((acc, row) => {
          const raw = cantidadesEditadas[row.producto_id];
          const kg = raw == null || raw === '' ? 0 : Number(raw);
          return acc + (Number.isFinite(kg) ? kg : row.cantidad);
        }, 0),
      )
    : 0;
  const previewMermaKg = preview ? round3(pesoIngresado - previewKgVendibles) : 0;
  const previewMermaPct = preview && pesoIngresado > 0 ? round2((previewMermaKg / pesoIngresado) * 100) : 0;
  const previewRendimientoPct =
    preview && pesoIngresado > 0 ? round2((previewKgVendibles / pesoIngresado) * 100) : 0;
  const previewCostoEfectivo =
    preview && previewKgVendibles > 0 ? round2((costoKg * pesoIngresado) / previewKgVendibles) : null;
  const previewExcedePeso = preview ? previewKgVendibles - pesoIngresado > 0.01 : false;

  function limpiarPreview() {
    setPreview(null);
    setResult(null);
    setPreciosEditados({});
    setCantidadesEditadas({});
  }

  const setMermaDesdePlantilla = useCallback((plantilla: Plantilla | null, pesoObjetivo?: number) => {
    const pesoBase = Number(plantilla?.peso_total_kg ?? 0);
    const kgVendiblesBase =
      plantilla?.cortes?.reduce((acc, corte) => acc + Number(corte.kg_rendimiento ?? 0), 0) ?? 0;
    const mermaBaseKg = pesoBase > 0 ? Math.max(0, pesoBase - kgVendiblesBase) : 0;
    const mermaBasePct = pesoBase > 0 ? round2((mermaBaseKg / pesoBase) * 100) : 0;
    setMermaOrigen('pct');
    setMermaPct(String(mermaBasePct));
    setMermaKg(String(round3((Number(pesoObjetivo ?? pesoBase) * mermaBasePct) / 100)));
  }, []);

  function actualizarPesoIngresado(nextPeso: number) {
    setPesoIngresado(nextPeso);
    if (mermaOrigen === 'pct') {
      const pct = Number(mermaPct);
      setMermaKg(Number.isFinite(nextPeso) && Number.isFinite(pct) ? String(round3((nextPeso * pct) / 100)) : '');
    } else {
      const kg = Number(mermaKg);
      setMermaPct(
        Number.isFinite(nextPeso) && nextPeso > 0 && Number.isFinite(kg)
          ? String(round2((kg / nextPeso) * 100))
          : '',
      );
    }
    limpiarPreview();
  }

  function onPesoIngresadoChange(value: string) {
    setCantidadModo('kg');
    actualizarPesoIngresado(Number(value));
  }

  function onCantidadUnidadChange(value: string) {
    setCantidadModo('unidad');
    setCantidadUnidad(value);
    const cantidad = Number(value);
    actualizarPesoIngresado(pesoKgDesdeUnidades(selected, cantidad));
  }

  function onCantidadContenedoresChange(value: string) {
    setCantidadModo('contenedor');
    setCantidadContenedores(value);
    const contenedores = Number(value);
    const porContenedor = Number(unidadesContenedor);
    const cantidad = contenedores * porContenedor;
    if (Number.isFinite(cantidad)) setCantidadUnidad(String(round3(cantidad)));
    actualizarPesoIngresado(pesoKgDesdeUnidades(selected, cantidad));
  }

  function onUnidadesContenedorChange(value: string) {
    setCantidadModo('contenedor');
    setUnidadesContenedor(value);
    const contenedores = Number(cantidadContenedores);
    const porContenedor = Number(value);
    const cantidad = contenedores * porContenedor;
    if (Number.isFinite(cantidad)) setCantidadUnidad(String(round3(cantidad)));
    actualizarPesoIngresado(pesoKgDesdeUnidades(selected, cantidad));
  }

  const prepararIngresoDesdePlantilla = useCallback((plantilla: Plantilla) => {
    const pesoBase = Number(plantilla.peso_total_kg);
    setPesoIngresado(pesoBase);
    setCostoKg(Number(plantilla.producto_padre?.precio_costo ?? 0));
    setMermaDesdePlantilla(plantilla, pesoBase);
    if (esPlantillaPorUnidad(plantilla)) {
      setCantidadModo('unidad');
      setCantidadUnidad(fmtCantidad(cantidadUnidadBase(plantilla)));
      setCantidadContenedores('1');
      setUnidadesContenedor(fmtCantidad(unidadesPorContenedor(plantilla)));
    } else {
      setCantidadModo('kg');
      setCantidadUnidad('');
      setCantidadContenedores('');
      setUnidadesContenedor('');
    }
  }, [setMermaDesdePlantilla]);

  function onMermaPctChange(value: string) {
    setMermaOrigen('pct');
    setMermaPct(value);
    const pct = Number(value);
    setMermaKg(value === '' || !Number.isFinite(pct) ? '' : String(round3((pesoIngresado * pct) / 100)));
    limpiarPreview();
  }

  function onMermaKgChange(value: string) {
    setMermaOrigen('kg');
    setMermaKg(value);
    const kg = Number(value);
    setMermaPct(
      value === '' || !Number.isFinite(kg) || pesoIngresado <= 0
        ? ''
        : String(round2((kg / pesoIngresado) * 100)),
    );
    limpiarPreview();
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const plantillasJson = await fetchJson('/api/despiece/plantillas?activo=true');
      const rows = (plantillasJson.plantillas ?? []) as Plantilla[];
      setPlantillas(rows);
      if (!plantillaId && rows[0]) {
        setPlantillaId(rows[0].id);
        prepararIngresoDesdePlantilla(rows[0]);
        setProveedorId(rows[0].producto_padre?.proveedor_id ?? '');
      }
      try {
        const proveedoresJson = await fetchJson('/api/proveedores');
        setProveedores(((proveedoresJson.proveedores ?? []) as Proveedor[]).filter((p) => p.activo !== false));
      } catch {
        setProveedores([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar plantillas.');
    } finally {
      setLoading(false);
    }
  }, [plantillaId, prepararIngresoDesdePlantilla]);

  useEffect(() => {
    void load();
  }, [load]);

  function onPlantillaChange(id: string) {
    setPlantillaId(id);
    setPreview(null);
    setResult(null);
    setPreciosEditados({});
    setCantidadesEditadas({});
    const p = plantillas.find((row) => row.id === id);
    if (p) {
      prepararIngresoDesdePlantilla(p);
      setProveedorId(p.producto_padre?.proveedor_id ?? '');
    }
  }

  async function cargarPredeterminadas(slug: string) {
    setSaving(true);
    try {
      const json = await fetchJson('/api/despiece/predeterminadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      toast.success(`Plantillas listas: ${json.plantillas?.length ?? 0}`);
      await load();
      setDialogPredeterminadasOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron crear plantillas.');
    } finally {
      setSaving(false);
    }
  }

  function ingresoPayload(extra?: Record<string, unknown>) {
    const mermaValue = mermaOrigen === 'kg' ? mermaKg : mermaPct;
    const unidadPayload =
      esPlantillaPorUnidad(selected) && cantidadModo === 'unidad'
        ? { cantidad_unidad_base: cantidadUnidad === '' ? null : Number(cantidadUnidad) }
        : esPlantillaPorUnidad(selected) && cantidadModo === 'contenedor'
          ? {
              cantidad_contenedores: cantidadContenedores === '' ? null : Number(cantidadContenedores),
              unidades_por_contenedor: unidadesContenedor === '' ? null : Number(unidadesContenedor),
            }
          : {};
    return {
      plantilla_id: plantillaId,
      peso_ingresado_kg: pesoIngresado,
      ...unidadPayload,
      costo_kg: costoKg,
      ...(mermaOrigen === 'kg'
        ? { merma_kg: mermaValue === '' ? null : Number(mermaValue) }
        : { merma_pct: mermaValue === '' ? null : Number(mermaValue) }),
      fecha_vencimiento: fechaVencimiento || null,
      proveedor_id: proveedorId || null,
      registrar_ingreso_padre: registrarIngresoPadre,
      registrar_factura_compra: registrarFacturaCompra,
      tipo_comprobante_compra: tipoComprobanteCompra,
      fecha_compra: fechaCompra || null,
      fecha_vencimiento_compra: fechaVencimientoCompra || null,
      punto_venta_compra: puntoVentaCompra.trim() === '' ? null : Number(puntoVentaCompra),
      numero_documento_compra: numeroDocumentoCompra.trim() === '' ? null : Number(numeroDocumentoCompra),
      observaciones_compra: observacionesCompra.trim() || null,
      aplicar_precios: aplicarPrecios,
      estrategia: 'fija',
      ...extra,
    };
  }

  function cortesRealesPayload() {
    if (!preview) return [];
    return preview.movimientos.map((row) => ({
      producto_id: row.producto_id,
      nombre: row.nombre,
      kg_ingresado:
        cantidadesEditadas[row.producto_id] == null || cantidadesEditadas[row.producto_id] === ''
          ? 0
          : Number(cantidadesEditadas[row.producto_id]),
    }));
  }

  async function previsualizar() {
    setSaving(true);
    setResult(null);
    try {
      const cortesReales = preview ? cortesRealesPayload() : undefined;
      const json = await fetchJson('/api/despiece/ingresos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ingresoPayload({ preview: true, cortes_reales: cortesReales })),
      });
      setPreview(json);
      const nextCantidades: Record<string, string> = {};
      for (const row of (json.movimientos ?? []) as PreviewRow[]) {
        nextCantidades[row.producto_id] = String(row.cantidad);
      }
      setCantidadesEditadas(nextCantidades);
      const plantillaActual = plantillas.find((p) => p.id === plantillaId) ?? null;
      if (!aplicarPrecios) {
        setPreciosEditados(preciosPlantillaPorMovimientos(plantillaActual, (json.movimientos ?? []) as PreviewRow[]));
      } else {
        setPreciosEditados({});
      }
      toast.success(`Preview listo: ${json.movimientos?.length ?? 0} cortes`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo calcular el preview.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmarIngreso() {
    if (!preview) return;
    if (previewExcedePeso) {
      toast.error('Los kg vendibles no pueden superar el peso ingresado.');
      return;
    }
    if ((registrarIngresoPadre || registrarFacturaCompra) && !selected?.producto_padre?.id) {
      toast.error('La plantilla necesita un producto padre.');
      return;
    }
    if ((registrarIngresoPadre || registrarFacturaCompra) && !proveedorId) {
      toast.error('Elegí un proveedor para registrar el ingreso del padre.');
      return;
    }
    if (registrarFacturaCompra) {
      if (!fechaCompra || !puntoVentaCompra.trim() || !numeroDocumentoCompra.trim()) {
        toast.error('Completá fecha, punto de venta y número de comprobante.');
        return;
      }
      const pv = Number(puntoVentaCompra);
      const nd = Number(numeroDocumentoCompra);
      if (!Number.isFinite(pv) || pv <= 0 || !Number.isFinite(nd) || nd <= 0) {
        toast.error('Punto de venta y número deben ser mayores a 0.');
        return;
      }
    }
    setSaving(true);
    setResult(null);
    try {
      const preciosEditadosPayload = Object.entries(preciosEditados).map(([productoId, precioVenta]) => ({
        producto_id: productoId,
        precio_venta: precioVenta === '' ? null : Number(precioVenta),
      }));
      const json = await fetchJson('/api/despiece/ingresos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          ingresoPayload({
            cortes_reales: cortesRealesPayload(),
            precios_editados: preciosEditadosPayload,
          }),
        ),
      });
      setResult(json);
      setPreview(null);
      setCantidadesEditadas({});
      setPreciosEditados({});
      toast.success(
        `Stock creado en ${json.movimientos?.length ?? 0} cortes${json.comprobante_compra_id ? ' y factura registrada' : ''}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo ingresar carne.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ingresos de carne</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cargá lo que entró y el sistema reparte el stock en todos los cortes de la plantilla.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/despiece/plantillas" className={cn(buttonVariants({ variant: 'outline' }))}>
            Plantillas
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogPredeterminadasOpen(true)}
            disabled={saving}
          >
            Cargar predeterminadas
          </Button>
        </div>
      </div>

      <section className="rounded-lg border bg-card p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : plantillas.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No hay plantillas. Podés cargar las predeterminadas del Excel para arrancar.
            </p>
            <Button
              type="button"
              onClick={() => setDialogPredeterminadasOpen(true)}
              disabled={saving}
            >
              Elegir plantilla predeterminada
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Plantilla</span>
              <select
                value={plantillaId}
                onChange={(e) => onPlantillaChange(e.target.value)}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} - {p.producto_padre?.nombre ?? 'sin padre'}
                  </option>
                ))}
              </select>
            </label>
            {esPlantillaPorUnidad(selected) ? (
              <div className="space-y-2 text-sm md:col-span-2">
                <span className="block text-muted-foreground">Cantidad ingresada</span>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Cantidad de {nombreUnidadBase(selected)}</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={cantidadUnidad}
                      onChange={(e) => onCantidadUnidadChange(e.target.value)}
                    />
                  </label>
                  {selected?.unidad_contenedor_nombre ? (
                    <>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">{selected.unidad_contenedor_nombre}</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={cantidadContenedores}
                          onChange={(e) => onCantidadContenedoresChange(e.target.value)}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          {nombreUnidadBase(selected)} por {selected.unidad_contenedor_nombre}
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={unidadesContenedor}
                          onChange={(e) => onUnidadesContenedorChange(e.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Kg equivalentes</span>
                    <Input
                      type="number"
                      step="0.001"
                      value={pesoIngresado}
                      onChange={(e) => onPesoIngresadoChange(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Kg ingresados</span>
                <Input
                  type="number"
                  step="0.001"
                  value={pesoIngresado}
                  onChange={(e) => onPesoIngresadoChange(e.target.value)}
                />
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Merma %</span>
              <Input
                type="number"
                min="0"
                max="99.999"
                step="0.01"
                value={mermaPct}
                onChange={(e) => onMermaPctChange(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Merma kg</span>
              <Input
                type="number"
                min="0"
                step="0.001"
                value={mermaKg}
                onChange={(e) => onMermaKgChange(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Costo por kg</span>
              <Input
                type="number"
                step="0.01"
                value={costoKg}
                onChange={(e) => {
                  setCostoKg(Number(e.target.value));
                  setPreview(null);
                  setResult(null);
                  setPreciosEditados({});
                  setCantidadesEditadas({});
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Vencimiento/lote</span>
              <Input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => {
                  setFechaVencimiento(e.target.value);
                  setPreview(null);
                  setResult(null);
                  setPreciosEditados({});
                  setCantidadesEditadas({});
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Proveedor</span>
              <select
                value={proveedorId}
                onChange={(e) => {
                  setProveedorId(e.target.value);
                  limpiarPreview();
                }}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={registrarIngresoPadre}
                disabled={!selected?.producto_padre?.id}
                onChange={(e) => {
                  setRegistrarIngresoPadre(e.target.checked);
                  if (!e.target.checked) setRegistrarFacturaCompra(false);
                  limpiarPreview();
                }}
                className="size-4"
              />
              Registrar ingreso del padre
            </label>
            <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={registrarFacturaCompra}
                disabled={!registrarIngresoPadre || !selected?.producto_padre?.id}
                onChange={(e) => {
                  setRegistrarFacturaCompra(e.target.checked);
                  if (e.target.checked) setRegistrarIngresoPadre(true);
                  limpiarPreview();
                }}
                className="size-4"
              />
              Registrar factura de compra
            </label>
            {registrarFacturaCompra ? (
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:col-span-2 md:grid-cols-4">
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Tipo</span>
                  <select
                    value={tipoComprobanteCompra}
                    onChange={(e) => {
                      setTipoComprobanteCompra(e.target.value as (typeof TIPO_COMPRA_OPTS)[number]['value']);
                      limpiarPreview();
                    }}
                    className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                  >
                    {TIPO_COMPRA_OPTS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Fecha</span>
                  <Input
                    type="date"
                    value={fechaCompra}
                    onChange={(e) => {
                      setFechaCompra(e.target.value);
                      limpiarPreview();
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Punto venta</span>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={puntoVentaCompra}
                    onChange={(e) => {
                      setPuntoVentaCompra(e.target.value);
                      limpiarPreview();
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Numero</span>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={numeroDocumentoCompra}
                    onChange={(e) => {
                      setNumeroDocumentoCompra(e.target.value);
                      limpiarPreview();
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Vencimiento</span>
                  <Input
                    type="date"
                    value={fechaVencimientoCompra}
                    onChange={(e) => {
                      setFechaVencimientoCompra(e.target.value);
                      limpiarPreview();
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm md:col-span-3">
                  <span className="text-xs text-muted-foreground">Observaciones</span>
                  <Input
                    value={observacionesCompra}
                    onChange={(e) => {
                      setObservacionesCompra(e.target.value);
                      limpiarPreview();
                    }}
                  />
                </label>
              </div>
            ) : null}
            <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={aplicarPrecios}
                onChange={(e) => {
                  setAplicarPrecios(e.target.checked);
                  setPreview(null);
                  setResult(null);
                  setPreciosEditados({});
                  setCantidadesEditadas({});
                }}
                className="size-4"
              />
              Aplicar precios sugeridos
            </label>
            <div className="md:col-span-2">
              <Button type="button" onClick={previsualizar} disabled={saving || !plantillaId}>
                <Eye className="size-4" />
                {preview ? 'Recalcular preview' : 'Previsualizar cortes'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {selected ? (
        <section className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Producto padre</span>
            <p className="font-medium">{selected.producto_padre?.nombre ?? '-'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Peso base</span>
            <p className="font-medium">{basePlantillaLabel(selected)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Cortes</span>
            <p className="font-medium">{selected.cortes?.length ?? 0}</p>
          </div>
        </section>
      ) : null}

      {preview ? (
        <section className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Preview de stock a crear</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Revisá cantidades y el precio de venta. Podés usar los precios de la plantilla (anclado o precio del
                producto) o combinarlos con los sugeridos.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Costo efectivo por kg de corte: {money(previewCostoEfectivo ?? preview.costo_efectivo_kg_corte)}
              </p>
            </div>
            <Button type="button" onClick={confirmarIngreso} disabled={saving || previewExcedePeso}>
              <Check className="size-4" />
              Aceptar y cargar stock
            </Button>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <span className="text-muted-foreground">Kg vendibles</span>
              <p className="font-medium tabular-nums">{previewKgVendibles.toFixed(3)} kg</p>
            </div>
            <div>
              <span className="text-muted-foreground">Merma</span>
              <p className="font-medium tabular-nums">
                {previewMermaKg.toFixed(3)} kg ({previewMermaPct.toFixed(2)}%)
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Rendimiento</span>
              <p className="font-medium tabular-nums">{previewRendimientoPct.toFixed(2)}%</p>
            </div>
            <div>
              <span className="text-muted-foreground">Costo total</span>
              <p className="font-medium tabular-nums">{money(costoKg * pesoIngresado)}</p>
            </div>
          </div>
          {previewExcedePeso ? (
            <p className="mt-3 text-sm text-destructive">
              Los kg vendibles no pueden superar los kg ingresados.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selected}
              onClick={() => {
                if (!preview || !selected) return;
                setPreciosEditados((prev) => {
                  const next = { ...prev };
                  for (const m of preview.movimientos) {
                    const tpl = precioVendibleDesdePlantilla(selected, m.producto_id);
                    if (tpl != null) next[m.producto_id] = String(tpl);
                  }
                  return next;
                });
                toast.success('Precios de plantilla aplicados a los cortes que los tienen definidos.');
              }}
            >
              Usar precios de plantilla
            </Button>
            <span className="text-xs text-muted-foreground">
              Usa el precio anclado del corte en la plantilla; si no hay, el precio de venta del producto.
            </span>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <div className="min-w-[620px] text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_9rem] items-center gap-x-3 border-b bg-muted/50 px-3 py-2 text-muted-foreground">
                <div className="font-medium">Corte</div>
                <div className="text-right font-medium">Kg reales</div>
                <div className="text-right font-medium">Precio venta</div>
              </div>
              <div className="divide-y">
                {preview.movimientos.map((m) => (
                  <div
                    key={m.producto_id}
                    className="grid grid-cols-[minmax(0,1fr)_8rem_9rem] items-center gap-x-3 px-3 py-2"
                  >
                    <span className="font-medium">{m.nombre}</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={cantidadesEditadas[m.producto_id] ?? String(m.cantidad)}
                      onChange={(e) =>
                        setCantidadesEditadas((prev) => ({
                          ...prev,
                          [m.producto_id]: e.target.value,
                        }))
                      }
                      className="w-full max-w-full text-right tabular-nums"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        preciosEditados[m.producto_id] ??
                        (m.precio_venta_nuevo == null ? '' : String(m.precio_venta_nuevo))
                      }
                      onChange={(e) =>
                        setPreciosEditados((prev) => ({
                          ...prev,
                          [m.producto_id]: e.target.value,
                        }))
                      }
                      className="w-full max-w-full text-right tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Stock creado</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Costo efectivo por kg de corte: {money(result.costo_efectivo_kg_corte)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vendible: {Number(result.kg_vendibles ?? 0).toFixed(3)} kg - Merma:{' '}
            {Number(result.merma_kg ?? 0).toFixed(3)} kg ({Number(result.merma_pct ?? 0).toFixed(2)}%)
          </p>
          {result.movimiento_padre || result.comprobante_compra_id ? (
            <div className="mt-4 grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
              {result.movimiento_padre ? (
                <div>
                  <span className="text-muted-foreground">Ingreso del padre</span>
                  <p className="font-medium">
                    {result.movimiento_padre.nombre}: {Number(result.movimiento_padre.cantidad).toFixed(3)} kg
                  </p>
                </div>
              ) : null}
              {result.comprobante_compra_id ? (
                <div>
                  <span className="text-muted-foreground">Factura de compra</span>
                  <p className="font-medium">
                    <Link href={`/facturacion/${result.comprobante_compra_id}`} className="hover:underline">
                      Ver comprobante
                    </Link>
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 divide-y rounded-lg border">
            {result.movimientos.map((m) => (
              <div key={m.producto_id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{m.nombre}</span>
                <span className="tabular-nums">{m.cantidad.toFixed(3)} kg</span>
                <span className="tabular-nums text-muted-foreground">{money(m.precio_venta_nuevo)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <DialogPredeterminadas
        open={dialogPredeterminadasOpen}
        onOpenChange={setDialogPredeterminadasOpen}
        plantillasExistentes={plantillas}
        saving={saving}
        onSeleccionar={cargarPredeterminadas}
      />
    </div>
  );
}
