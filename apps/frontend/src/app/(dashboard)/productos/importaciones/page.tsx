'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CalendarRange,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Truck,
} from 'lucide-react';

import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

type OrigenPrecio = Database['public']['Enums']['origen_precio'];

type LogRow = {
  id: string;
  created_at: string;
  archivo_nombre: string;
  origen: OrigenPrecio;
  total_filas: number;
  filas_exitosas: number;
  filas_con_error: number;
  productos_creados: number;
  productos_actualizados: number;
  detalle_errores: unknown;
  proveedor_id: string | null;
  usuario_id: string | null;
  sucursal_id: string | null;
  carga_id: string | null;
  archivo_storage_path: string | null;
  archivo_mime: string | null;
  archivo_tamano: number | null;
  estado?: 'aplicada' | 'revertida' | string | null;
  revertida_at?: string | null;
  revertida_por?: string | null;
  motivo_reversion?: string | null;
  resumen_reversion?: unknown;
  archivo_db_disponible?: boolean;
  proveedor: { nombre: string } | null;
  sucursal: { id: string; nombre: string } | null;
};

type GrupoCarga = {
  key: string;
  filas: LogRow[];
  createdMax: string;
  labelArchivo: string;
  origen: OrigenPrecio;
  descargarDesdeId: string | null;
  sucursalNombre: string | null;
  proveedorNombre: string | null;
  estado: 'aplicada' | 'revertida' | 'parcial';
  revertidaAt: string | null;
};

type ReversionResumen = {
  logs_revertidos?: number;
  snapshots_usados?: number;
  productos_desactivados?: number;
  productos_restaurados?: number;
  productos_omitidos?: number;
  movimientos_stock_revertidos?: number;
  lotes_ajustados?: number;
};

type OptProveedor = { id: string; nombre: string };

type ErrorImportacionEnriquecido = {
  filaLote: number;
  /** Posición 1-based en todo el archivo de esa carga (suma de lotes previos + fila del lote). */
  filaArchivo: number;
  loteIndex: number;
  loteCount: number;
  campo: string;
  error: string;
  errorHint: string | null;
  codigo: string | null;
  nombre: string | null;
};

function etiquetaOrigen(o: OrigenPrecio): string {
  switch (o) {
    case 'importacion_excel':
      return 'Excel / CSV';
    case 'ia_pdf':
      return 'IA (PDF)';
    case 'lista_precios':
      return 'Lista de precios';
    case 'lector_factura':
      return 'Lector de facturas';
    case 'factura_recibida':
      return 'Factura recibida';
    default:
      return 'Otro';
  }
}

function formatearFechaCorta(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function ts(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function nombreDesdeContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const mUtf = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (mUtf?.[1]) {
    try {
      return decodeURIComponent(mUtf[1].trim());
    } catch {
      return mUtf[1].trim();
    }
  }
  const m = /filename="([^"]+)"/i.exec(cd);
  if (m?.[1]) return m[1].trim();
  return null;
}

function extraerContextoFila(valorOriginal: unknown): { codigo: string | null; nombre: string | null } {
  const fromObj = (o: Record<string, unknown>) => {
    const codRaw = o.codigo;
    const nomRaw = o.nombre;
    const codigo =
      typeof codRaw === 'string'
        ? codRaw.trim() || null
        : codRaw != null && String(codRaw).trim()
          ? String(codRaw).trim()
          : null;
    const nombre = typeof nomRaw === 'string' && nomRaw.trim() ? nomRaw.trim() : null;
    return { codigo, nombre };
  };

  if (valorOriginal && typeof valorOriginal === 'object' && !Array.isArray(valorOriginal)) {
    return fromObj(valorOriginal as Record<string, unknown>);
  }
  if (typeof valorOriginal === 'string') {
    try {
      const o = JSON.parse(valorOriginal) as Record<string, unknown>;
      if (o && typeof o === 'object') return fromObj(o);
    } catch {
      /* ignore */
    }
  }
  return { codigo: null, nombre: null };
}

function humanizarErrorPostgres(msg: string): string | null {
  if (msg.includes('sucursal_id') && msg.includes('not-null')) {
    return 'El producto necesita una sucursal. Volvé a importar con una sucursal operativa seleccionada en la app.';
  }
  if (msg.includes('idx_producto_barcode') || msg.includes('codigo_barras')) {
    return 'Conflicto de código de barras con otro producto del mismo proveedor.';
  }
  if (msg.includes('duplicate key') || msg.includes('23505')) {
    return 'Ya existe un registro con esos datos únicos (duplicado en base).';
  }
  if (msg.includes('foreign key') || msg.includes('23503')) {
    return 'Referencia inválida (por ejemplo categoría o proveedor inexistente).';
  }
  return null;
}

function parseErroresBrutos(raw: unknown): { fila: number; campo: string; error: string; valor_original?: unknown }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { fila?: number; campo?: string; error?: string; valor_original?: unknown }[])
    .filter((e) => e && typeof e.fila === 'number' && typeof e.error === 'string')
    .map((e) => ({
      fila: e.fila!,
      campo: typeof e.campo === 'string' ? e.campo : 'general',
      error: e.error!,
      valor_original: e.valor_original,
    }));
}

function erroresEnriquecidosDeGrupo(filasLog: LogRow[]): ErrorImportacionEnriquecido[] {
  const ordenCron = [...filasLog].sort((a, b) => ts(a.created_at) - ts(b.created_at));
  let offsetFilas = 0;
  const out: ErrorImportacionEnriquecido[] = [];
  const loteCount = ordenCron.length;

  for (let i = 0; i < ordenCron.length; i++) {
    const row = ordenCron[i]!;
    const brutos = parseErroresBrutos(row.detalle_errores);
    for (const b of brutos) {
      const { codigo, nombre } = extraerContextoFila(b.valor_original);
      const hint = humanizarErrorPostgres(b.error);
      out.push({
        filaLote: b.fila,
        filaArchivo: offsetFilas + b.fila,
        loteIndex: i + 1,
        loteCount,
        campo: b.campo,
        error: b.error,
        errorHint: hint,
        codigo,
        nombre,
      });
    }
    offsetFilas += row.total_filas;
  }

  return out;
}

function agrupar(logs: LogRow[]): GrupoCarga[] {
  const ordenados = [...logs].sort((a, b) => ts(b.created_at) - ts(a.created_at));

  const map = new Map<string, LogRow[]>();
  for (const row of ordenados) {
    const key = row.carga_id ? `c:${row.carga_id}` : `s:${row.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  for (const arr of map.values()) {
    arr.sort((a, b) => ts(a.created_at) - ts(b.created_at));
  }

  const entries = [...map.entries()].map(([key, filas]) => {
    const createdMax = filas.reduce(
      (acc, f) => (ts(f.created_at) > ts(acc) ? f.created_at : acc),
      filas[0]!.created_at,
    );
    const masReciente = filas.reduce((best, f) =>
      ts(f.created_at) > ts(best.created_at) ? f : best,
    filas[0]!);
    const conArchivo =
      [...filas]
        .reverse()
        .find((f) => Boolean(f.archivo_storage_path) || Boolean(f.archivo_db_disponible)) ?? null;
    const estados = filas.map((f) => f.estado ?? 'aplicada');
    const estado =
      estados.every((e) => e === 'revertida')
        ? 'revertida'
        : estados.some((e) => e === 'revertida')
          ? 'parcial'
          : 'aplicada';
    const revertidaAt =
      filas
        .map((f) => f.revertida_at)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .sort((a, b) => ts(b) - ts(a))[0] ?? null;
    const g: GrupoCarga = {
      key,
      filas,
      createdMax,
      labelArchivo: masReciente.archivo_nombre,
      origen: masReciente.origen,
      descargarDesdeId: conArchivo?.id ?? null,
      sucursalNombre: masReciente.sucursal?.nombre ?? null,
      proveedorNombre: masReciente.proveedor?.nombre ?? null,
      estado,
      revertidaAt,
    };
    return g;
  });

  return entries.sort((a, b) => ts(b.createdMax) - ts(a.createdMax));
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ProductosImportacionesPage() {
  const { alert: showAlertModal, confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [abrirId, setAbrirId] = useState<string | null>(null);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [revirtiendoKey, setRevirtiendoKey] = useState<string | null>(null);
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [filtroAplicadoDesde, setFiltroAplicadoDesde] = useState('');
  const [filtroAplicadoHasta, setFiltroAplicadoHasta] = useState('');
  const [proveedores, setProveedores] = useState<OptProveedor[]>([]);
  const [filtroProveedorId, setFiltroProveedorId] = useState('');
  const [filtroAplicadoProveedorId, setFiltroAplicadoProveedorId] = useState('');

  const proveedorLabel = useMemo(() => {
    if (!filtroProveedorId) return 'Todos';
    if (filtroProveedorId === '__sin__') return 'Sin proveedor';
    return proveedores.find((p) => p.id === filtroProveedorId)?.nombre ?? 'Proveedor';
  }, [filtroProveedorId, proveedores]);

  const loadProveedores = useCallback(async () => {
    try {
      const res = await fetch('/api/proveedores');
      const j = (await res.json()) as { proveedores?: { id: string; nombre: string; activo: boolean }[] };
      if (res.ok && j.proveedores) {
        setProveedores(
          j.proveedores.filter((x) => x.activo).map((x) => ({ id: x.id, nombre: x.nombre })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '120');
      if (filtroAplicadoDesde) params.set('desde', filtroAplicadoDesde);
      if (filtroAplicadoHasta) params.set('hasta', filtroAplicadoHasta);
      if (filtroAplicadoProveedorId) params.set('proveedor_id', filtroAplicadoProveedorId);
      const res = await fetch(`/api/importar/logs?${params.toString()}`);
      const j = (await res.json()) as { error?: string; logs?: LogRow[] };
      if (!res.ok) {
        throw new Error(j.error ?? 'No se pudo cargar el historial');
      }
      setLogs(j.logs ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filtroAplicadoDesde, filtroAplicadoHasta, filtroAplicadoProveedorId]);

  useEffect(() => {
    void loadProveedores();
  }, [loadProveedores]);

  useEffect(() => {
    void load();
  }, [load]);

  const grupos = useMemo(() => agrupar(logs), [logs]);

  const aplicarFiltros = () => {
    setFiltroAplicadoDesde(filtroDesde.trim());
    setFiltroAplicadoHasta(filtroHasta.trim());
    setFiltroAplicadoProveedorId(filtroProveedorId);
  };

  const limpiarFiltros = () => {
    setFiltroDesde('');
    setFiltroHasta('');
    setFiltroAplicadoDesde('');
    setFiltroAplicadoHasta('');
    setFiltroProveedorId('');
    setFiltroAplicadoProveedorId('');
  };

  const setRangoUltimosDias = (dias: number) => {
    const hasta = new Date();
    const desde = new Date();
    desde.setDate(desde.getDate() - (dias - 1));
    const d0 = ymdLocal(desde);
    const d1 = ymdLocal(hasta);
    setFiltroDesde(d0);
    setFiltroHasta(d1);
    setFiltroAplicadoDesde(d0);
    setFiltroAplicadoHasta(d1);
  };

  const descargar = async (importacionId: string, nombreFallback: string) => {
    setDescargandoId(importacionId);
    try {
      const res = await fetch(`/api/importar/logs/${importacionId}/archivo`);
      const ct = res.headers.get('content-type') || '';

      if (!res.ok) {
        if (ct.includes('application/json')) {
          const j = (await res.json()) as { error?: string };
          await showAlertModal({
            title: 'Descarga',
            description: j.error ?? 'No se pudo descargar',
          });
        } else {
          await showAlertModal({
            title: 'Descarga',
            description: 'No se pudo descargar el archivo',
          });
        }
        return;
      }

      if (!ct.includes('application/json')) {
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition');
        const desdeHeader = nombreDesdeContentDisposition(cd);
        const nombre = (desdeHeader || nombreFallback || 'importacion').replace(
          /[/\\?%*:|"<>]/g,
          '_',
        );
        const urlObj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlObj;
        a.download = nombre;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(urlObj);
        return;
      }

      const j = (await res.json()) as { error?: string; url?: string; archivo_nombre?: string };
      if (!j.url) {
        await showAlertModal({
          title: 'Descarga',
          description: j.error ?? 'No se recibió URL de descarga',
        });
        return;
      }
      let blob: Blob;
      try {
        const fileRes = await fetch(j.url, { mode: 'cors', credentials: 'omit' });
        if (!fileRes.ok) {
          window.open(j.url, '_blank', 'noopener,noreferrer');
          return;
        }
        blob = await fileRes.blob();
      } catch {
        window.open(j.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const nombre = (j.archivo_nombre || nombreFallback || 'importacion').replace(
        /[/\\?%*:|"<>]/g,
        '_',
      );
      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlObj;
      a.download = nombre;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
    } catch (e) {
      await showAlertModal({
        title: 'Descarga',
        description: (e as Error).message,
      });
    } finally {
      setDescargandoId(null);
    }
  };

  const revertirCarga = async (grupo: GrupoCarga) => {
    if (grupo.estado !== 'aplicada') return;
    const importacionId = grupo.filas[grupo.filas.length - 1]?.id;
    if (!importacionId) return;

    const creados = grupo.filas.reduce((acc, row) => acc + row.productos_creados, 0);
    const actualizados = grupo.filas.reduce((acc, row) => acc + row.productos_actualizados, 0);
    const ok = await confirm({
      title: 'Revertir carga',
      description: (
        <span className="space-y-2">
          <span className="block">
            Se van a dar de baja los productos creados por esta carga y restaurar los datos de los
            productos actualizados usando la trazabilidad guardada.
          </span>
          <span className="block">
            Impacto estimado: {creados} creados, {actualizados} actualizados. Las cargas antiguas
            sin trazabilidad no se pueden revertir automáticamente.
          </span>
        </span>
      ),
      confirmLabel: 'Revertir carga',
      confirmVariant: 'destructive',
    });
    if (!ok) return;

    setRevirtiendoKey(grupo.key);
    try {
      const res = await fetch(`/api/importar/logs/${importacionId}/revertir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivo: 'Reversión manual desde historial de importaciones',
        }),
      });
      const json = (await res.json()) as { error?: string; resumen?: ReversionResumen };
      if (!res.ok) {
        throw new Error(json.error ?? 'No se pudo revertir la carga');
      }

      const r = json.resumen ?? {};
      await showAlertModal({
        title: 'Carga revertida',
        description: `Dados de baja: ${r.productos_desactivados ?? 0}. Restaurados: ${
          r.productos_restaurados ?? 0
        }. Movimientos de stock revertidos: ${r.movimientos_stock_revertidos ?? 0}.`,
      });
      await load();
    } catch (e) {
      await showAlertModal({
        title: 'Reversión',
        description: (e as Error).message,
      });
    } finally {
      setRevirtiendoKey(null);
    }
  };

  const hayFiltrosActivos = Boolean(
    filtroAplicadoDesde || filtroAplicadoHasta || filtroAplicadoProveedorId,
  );

  return (
    <>
      {ConfirmDialog}
      <div className="mx-auto max-w-6xl space-y-6 p-6 pb-16">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cargas de importación</h1>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            Historial de archivos procesados: productos creados o actualizados, errores por fila y
            descarga del original cuando esté guardado (hasta 10 MB por carga).
          </p>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Link href="/productos" className="text-primary underline underline-offset-4">
              ← Productos
            </Link>
            <span className="text-border" aria-hidden>
              ·
            </span>
            <Link href="/importar" className="text-primary underline underline-offset-4">
              Nueva importación
            </Link>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 self-start"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </div>

      <details className="group rounded-xl border border-border/80 bg-muted/20 open:bg-muted/30">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <Info className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
          Cómo leer filas, errores y &quot;actualizados&quot;
          <span className="text-muted-foreground ml-auto text-xs font-normal group-open:hidden">
            Mostrar
          </span>
          <span className="text-muted-foreground ml-auto hidden text-xs font-normal group-open:inline">
            Ocultar
          </span>
        </summary>
        <div className="text-muted-foreground space-y-3 border-t border-border/60 px-4 pb-4 pt-3 text-sm leading-relaxed">
          <p>
            <span className="text-foreground font-medium">Fila en el archivo</span> es la posición
            1-based dentro del conjunto de filas que importaste (misma numeración que en la vista
            previa). Si la carga se partió en varios lotes, sumamos para que coincida con tu CSV o
            Excel.
          </p>
          <p>
            <span className="text-foreground font-medium">Creados</span>: productos nuevos en esta
            sucursal. <span className="text-foreground font-medium">Actualizados</span>: ya existía
            el mismo código + nombre + proveedor; se pisan datos de catálogo (nombre, costos,
            categoría, etc.), se recalcula precio de venta, se registra historial de precios si
            cambian costo o venta, y el stock del archivo aplica como ajuste por movimiento cuando
            corresponde.
          </p>
        </div>
      </details>

      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-brand-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CalendarRange className="text-muted-foreground h-4 w-4" aria-hidden />
            Filtros
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setRangoUltimosDias(7)}>
              Últimos 7 días
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setRangoUltimosDias(30)}>
              Últimos 30 días
            </Button>
            {hayFiltrosActivos ? (
              <Button type="button" variant="ghost" size="sm" onClick={limpiarFiltros}>
                Quitar filtros
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Las fechas se comparan en UTC (medianoche a fin de día). Para un rango exacto en hora
          local, elegí un día de más si hace falta. Tocá Aplicar para actualizar fechas y proveedor.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-[200px]">
              <label htmlFor="imp-fecha-desde" className="text-muted-foreground text-xs font-medium">
                Desde
              </label>
              <Input
                id="imp-fecha-desde"
                type="date"
                value={filtroDesde}
                onChange={(e) => setFiltroDesde(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-[200px]">
              <label htmlFor="imp-fecha-hasta" className="text-muted-foreground text-xs font-medium">
                Hasta
              </label>
              <Input
                id="imp-fecha-hasta"
                type="date"
                value={filtroHasta}
                onChange={(e) => setFiltroHasta(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-[240px]">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Proveedor
              </span>
              <Select
                value={filtroProveedorId || '__all__'}
                onValueChange={(v) => setFiltroProveedorId(v == null || v === '__all__' ? '' : v)}
              >
                <SelectTrigger id="imp-filtro-proveedor" className="w-full">
                  <SelectValue placeholder="Todos">{proveedorLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  <SelectItem value="__sin__">Sin proveedor</SelectItem>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" className="sm:mb-0.5" onClick={aplicarFiltros}>
              Aplicar
            </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando historial…
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!loading && !error && grupos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-10 text-center">
          <Package className="text-muted-foreground mx-auto h-10 w-10 opacity-60" aria-hidden />
          <p className="text-muted-foreground mt-3 text-sm">
            {hayFiltrosActivos
              ? 'No hay importaciones que coincidan con los filtros.'
              : 'Todavía no hay importaciones registradas.'}
          </p>
        </div>
      ) : null}

      <ul className="space-y-4">
        {grupos.map((g) => {
          const filas = g.filas;
          const suma = (fn: (r: LogRow) => number) => filas.reduce((a, r) => a + fn(r), 0);
          const total = suma((r) => r.total_filas);
          const creados = suma((r) => r.productos_creados);
          const upd = suma((r) => r.productos_actualizados);
          const errC = suma((r) => r.filas_con_error);
          const errsRich = erroresEnriquecidosDeGrupo(filas);
          const loteN = filas.length;
          const abrir = abrirId === g.key;
          const okFilas = suma((r) => r.filas_exitosas);
          const pctExito = total > 0 ? Math.min(100, Math.round((okFilas / total) * 100)) : 0;

          return (
            <li
              key={g.key}
              className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-brand-sm"
            >
              <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                      <FileSpreadsheet className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold leading-tight">{g.labelArchivo}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {formatearFechaCorta(g.createdMax)} · {etiquetaOrigen(g.origen)}
                        {g.sucursalNombre ? ` · ${g.sucursalNombre}` : ''}
                        {g.proveedorNombre ? ` · ${g.proveedorNombre}` : ''}
                        {loteN > 1 ? ` · ${loteN} lotes` : ''}
                      </p>
                      {g.estado !== 'aplicada' ? (
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-md border px-2 py-0.5 font-medium',
                              g.estado === 'revertida'
                                ? 'border-rose-500/25 bg-rose-500/10 text-rose-900 dark:text-rose-100'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100',
                            )}
                          >
                            {g.estado === 'revertida' ? 'Revertida' : 'Reversión parcial'}
                          </span>
                          {g.revertidaAt ? (
                            <span className="text-muted-foreground">
                              {formatearFechaCorta(g.revertidaAt)}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                  <Button
                    type="button"
                    variant={g.estado === 'aplicada' ? 'destructive' : 'secondary'}
                    size="sm"
                    className="gap-1.5"
                    disabled={g.estado !== 'aplicada' || revirtiendoKey === g.key}
                    onClick={() => void revertirCarga(g)}
                  >
                    {revirtiendoKey === g.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {g.estado === 'aplicada'
                      ? 'Revertir carga'
                      : g.estado === 'revertida'
                        ? 'Ya revertida'
                        : 'Reversión parcial'}
                  </Button>
                  {g.descargarDesdeId ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      disabled={descargandoId === g.descargarDesdeId}
                      onClick={() => void descargar(g.descargarDesdeId!, g.labelArchivo)}
                    >
                      {descargandoId === g.descargarDesdeId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Descargar archivo
                    </Button>
                  ) : (
                    <p className="text-muted-foreground max-w-[220px] text-right text-xs leading-snug">
                      Sin copia del archivo (p. ej. mayor a 10 MB, error al guardar o importación
                      antigua).
                    </p>
                  )}
                </div>
              </div>

              <div className="px-4 py-4">
                <div
                  className="mb-3 h-2 overflow-hidden rounded-full bg-muted"
                  title={total > 0 ? `${pctExito}% filas procesadas sin error (${okFilas}/${total})` : undefined}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500/90 to-emerald-600/85 transition-[width] duration-500"
                    style={{ width: `${pctExito}%` }}
                  />
                </div>

                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1">
                    <span className="text-muted-foreground">Filas</span>
                    <span className="font-semibold tabular-nums">{total}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1 text-emerald-900 dark:text-emerald-100">
                    <Sparkles className="h-3.5 w-3.5 opacity-70" aria-hidden />
                    <span className="text-muted-foreground">Creados</span>
                    <span className="font-semibold tabular-nums">{creados}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/25 bg-sky-500/5 px-2.5 py-1 text-sky-950 dark:text-sky-100">
                    <ArrowLeftRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
                    <span className="text-muted-foreground">Actualizados</span>
                    <span className="font-semibold tabular-nums">{upd}</span>
                  </span>
                  {errC > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-950 dark:text-amber-100">
                      <span className="text-muted-foreground">Con error</span>
                      <span className="font-semibold tabular-nums">{errC}</span>
                    </span>
                  ) : null}
                </div>

                {errC > 0 && errsRich.length > 0 ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40',
                        abrir && 'border-primary/30 bg-primary/5',
                      )}
                      onClick={() => setAbrirId((k) => (k === g.key ? null : g.key))}
                    >
                      <span className="font-medium">
                        {abrir ? 'Ocultar' : 'Ver'} errores por fila
                        <span className="text-muted-foreground ml-1.5 font-normal">
                          ({Math.min(errsRich.length, 200)})
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">{abrir ? '▲' : '▼'}</span>
                    </button>
                    {abrir ? (
                      <ul className="mt-2 space-y-2">
                        {errsRich.slice(0, 200).map((e, i) => (
                          <li
                            key={`${g.key}-e-${e.filaArchivo}-${e.loteIndex}-${i}`}
                            className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm dark:bg-amber-950/20"
                          >
                            <div className="flex flex-wrap items-center gap-2 gap-y-1">
                              <span className="bg-background text-foreground inline-flex items-center rounded-md border border-border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
                                Fila archivo {e.filaArchivo}
                              </span>
                              {e.loteCount > 1 ? (
                                <span className="text-muted-foreground text-xs">
                                  Lote {e.loteIndex}/{e.loteCount} · fila en lote {e.filaLote}
                                </span>
                              ) : null}
                            </div>
                            {e.campo && e.campo !== 'general' ? (
                              <p className="text-muted-foreground mt-1.5 text-xs">
                                Campo: <span className="text-foreground font-medium">{e.campo}</span>
                              </p>
                            ) : null}
                            {(e.codigo || e.nombre) && (
                              <div className="mt-2 flex flex-col gap-0.5 text-xs sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
                                {e.codigo ? (
                                  <span>
                                    <span className="text-muted-foreground">Código</span>{' '}
                                    <code className="text-foreground rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8rem]">
                                      {e.codigo}
                                    </code>
                                  </span>
                                ) : null}
                                {e.nombre ? (
                                  <span className="min-w-0">
                                    <span className="text-muted-foreground">Nombre</span>{' '}
                                    <span className="text-foreground font-medium">{e.nombre}</span>
                                  </span>
                                ) : null}
                              </div>
                            )}
                            {e.errorHint ? (
                              <p className="text-foreground mt-2 text-sm leading-snug">{e.errorHint}</p>
                            ) : null}
                            <p
                              className={cn(
                                'mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground',
                                e.errorHint && 'opacity-80',
                              )}
                            >
                              {e.error}
                            </p>
                          </li>
                        ))}
                        {errsRich.length > 200 ? (
                          <li className="text-muted-foreground px-1 text-xs">
                            …y más (mostrando 200)
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
    </>
  );
}
