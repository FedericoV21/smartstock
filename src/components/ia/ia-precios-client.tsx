'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { ExtraerPrecios } from '@/components/ia/extraer-precios';
import { PrecioCambioPreview, type CambioPrecio } from '@/components/ia/precio-cambio-preview';
import { PreviewTable, type SugerenciaVentaFila } from '@/components/importar/preview-table';
import { ejecutarImportacionPorLotes, type ImportProgress } from '@/lib/importar/client-import';
import { writeImportResult } from '@/lib/importar/draft';
import { MAPEO_IA_PREVIEW } from '@/lib/ia/mapeo-preview';
import { type CampoProducto } from '@/lib/normalizador/aliases';
import { deduplicarFilas } from '@/lib/normalizador/deduplicar';
import type { MapeoColumna } from '@/lib/normalizador/mapear';
import { validarFilas, type FilaValidada } from '@/lib/normalizador/validar';

function copiarMapeoIa(): MapeoColumna[] {
  return MAPEO_IA_PREVIEW.map((m) => ({ ...m }));
}

function generarHeaderSintetico(campo: CampoProducto): string {
  const r =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto.randomUUID() as string).replace(/-/g, '').slice(0, 10)
      : String(Math.random()).slice(2, 12);
  return `__ss_${campo}_${r}`;
}

type FilaApi = {
  codigo: string | null;
  nombre: string;
  precio_costo?: number | null;
  precio_venta?: number | null;
  stock_actual?: number | null;
  stock_minimo?: number | null;
  categoria?: string | null;
  unidad?: string | null;
  fecha_vencimiento?: string | null;
};

function filaValidadaToPayload(f: FilaValidada): FilaApi {
  const d = f.datos;
  return {
    codigo: d.codigo != null ? String(d.codigo) : null,
    nombre: String(d.nombre ?? ''),
    precio_costo: d.precio_costo as number | null | undefined,
    precio_venta: d.precio_venta as number | null | undefined,
    stock_actual: d.stock_actual as number | null | undefined,
    stock_minimo: d.stock_minimo as number | null | undefined,
    categoria: d.categoria != null ? String(d.categoria) : null,
    unidad: d.unidad != null ? String(d.unidad) : null,
    fecha_vencimiento: d.fecha_vencimiento != null ? String(d.fecha_vencimiento) : null,
  };
}

export function IaPreciosClient() {
  const router = useRouter();
  const { canEdit } = useDashboardRole();
  const [step, setStep] = useState<'carga' | 'preview'>('carga');
  const [filasRaw, setFilasRaw] = useState<Record<string, string | number | null>[] | null>(null);
  const [archivoNombre, setArchivoNombre] = useState('');
  const [loadingEjec, setLoadingEjec] = useState(false);
  const [cambios, setCambios] = useState<CambioPrecio[]>([]);
  const [sugerencias, setSugerencias] = useState<(SugerenciaVentaFila | null)[]>([]);
  const [limite, setLimite] = useState<{ usadas: number; limite: number; permitido: boolean } | null>(
    null,
  );
  const [mapeoIa, setMapeoIa] = useState<MapeoColumna[]>(() => copiarMapeoIa());
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const refreshLimite = useCallback(async () => {
    try {
      const res = await fetch('/api/ia/limite');
      const j = (await res.json()) as {
        usadas?: number;
        limite?: number;
        permitido?: boolean;
      };
      if (res.ok) {
        setLimite({
          usadas: j.usadas ?? 0,
          limite: j.limite ?? 50,
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

  const columnasPreview = useMemo(
    () =>
      mapeoIa
        .filter((m) => !m.ignorar && m.campoDetectado)
        .map((m) => ({
          headerOriginal: m.headerOriginal,
          campo: m.campoDetectado!,
          sintetica: m.sintetica,
        })),
    [mapeoIa],
  );

  const filasValidadas = useMemo(() => {
    if (!filasRaw) return [];
    return validarFilas(filasRaw, mapeoIa);
  }, [filasRaw, mapeoIa]);

  useEffect(() => {
    if (step !== 'preview' || !filasRaw?.length) return;

    const payload = filasValidadas.map((f) => ({
      codigo: f.datos.codigo != null ? String(f.datos.codigo).trim() : null,
      nombre: String(f.datos.nombre ?? ''),
      precio_venta: typeof f.datos.precio_venta === 'number' ? f.datos.precio_venta : null,
      precio_costo: typeof f.datos.precio_costo === 'number' ? f.datos.precio_costo : null,
    }));

    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch('/api/ia/previsualizar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filas: payload }),
          });
          const j = (await res.json()) as {
            cambios?: CambioPrecio[];
            sugerencias?: (SugerenciaVentaFila | null)[];
            error?: string;
          };
          if (res.ok) {
            setCambios(j.cambios ?? []);
            setSugerencias(j.sugerencias ?? []);
          } else {
            setCambios([]);
            setSugerencias([]);
          }
        } catch {
          setCambios([]);
          setSugerencias([]);
        }
      })();
    }, 350);

    return () => clearTimeout(t);
  }, [filasValidadas, filasRaw, step]);

  const onExtraccionCompleta = useCallback(
    (
      productos: {
        codigo: string | null;
        nombre: string;
        precio_venta: number | null;
        precio_costo: number | null;
        unidad: string | null;
      }[],
      name: string,
    ) => {
      setArchivoNombre(name);
      setMapeoIa(copiarMapeoIa());
      setFilasRaw(
        productos.map((p) => ({
          codigo: p.codigo ?? '',
          nombre: p.nombre,
          precio_venta: p.precio_venta ?? '',
          precio_costo: p.precio_costo ?? '',
          unidad: p.unidad ?? '',
        })),
      );
      setStep('preview');
    },
    [],
  );

  const onFilaEdit = useCallback((index: number, headerOriginal: string, valor: string | number | null) => {
    setFilasRaw((prev) => {
      if (!prev) return prev;
      return prev.map((row, i) => (i === index ? { ...row, [headerOriginal]: valor } : row));
    });
  }, []);

  const onAgregarColumna = useCallback((campo: CampoProducto) => {
    const header = generarHeaderSintetico(campo);
    setMapeoIa((prev) => [
      ...prev,
      {
        headerOriginal: header,
        campoDetectado: campo,
        confianza: 'ninguna',
        ignorar: false,
        sintetica: true,
      },
    ]);
    setFilasRaw((prev) => (prev ? prev.map((row) => ({ ...row, [header]: null })) : null));
  }, []);

  const onQuitarColumna = useCallback(
    (headerOriginal: string) => {
      const target = mapeoIa.find((m) => m.headerOriginal === headerOriginal);
      if (!target?.sintetica) return;
      setMapeoIa((prev) => prev.filter((m) => m.headerOriginal !== headerOriginal));
      setFilasRaw((prev) =>
        prev
          ? prev.map((row) => {
              const next = { ...row };
              delete next[headerOriginal];
              return next;
            })
          : null,
      );
    },
    [mapeoIa],
  );

  const onBulkFill = useCallback(
    (headerOriginal: string, valorTexto: string, filaIndices: number[]) => {
      const set = new Set(filaIndices);
      setFilasRaw((prev) =>
        prev
          ? prev.map((row, i) =>
              set.has(i)
                ? { ...row, [headerOriginal]: valorTexto === '' ? null : valorTexto }
                : row
            )
          : null,
      );
    },
    [],
  );

  const onCalcularVentaPorMargen = useCallback(
    (headerPrecioVenta: string, porcentajeSobreCosto: number, filaIndices: number[]) => {
      const idxSet = new Set(filaIndices);
      setFilasRaw((prev) => {
        if (!prev) return prev;
        const v = validarFilas(prev, mapeoIa);
        return prev.map((row, i) => {
          if (!idxSet.has(i)) return row;
          const costoRaw = v[i]?.datos.precio_costo;
          const costo =
            typeof costoRaw === 'number' && !Number.isNaN(costoRaw) ? costoRaw : null;
          if (costo === null) return row;
          const venta =
            Math.round(costo * (1 + porcentajeSobreCosto / 100) * 100) / 100;
          return { ...row, [headerPrecioVenta]: venta };
        });
      });
    },
    [mapeoIa],
  );

  const onFilaDescartar = useCallback((index: number) => {
    setFilasRaw((prev) => (prev ? prev.filter((_, i) => i !== index) : null));
  }, []);

  const ejecutarImportacion = useCallback(async () => {
    if (!canEdit || !filasRaw) return;
    const validas = filasValidadas.filter((f) => f.valida);
    const { unicas, duplicadasDescartadas } = deduplicarFilas(validas);
    const filas = unicas.map(filaValidadaToPayload);

    setLoadingEjec(true);
    setImportProgress(null);
    try {
      const resultado = await ejecutarImportacionPorLotes(
        {
          filas,
          proveedor_id: null,
          archivo_nombre: archivoNombre,
          origen: 'ia_pdf',
        },
        {
          onProgress: (progress) => setImportProgress(progress),
        }
      );

      writeImportResult({
        total_filas: resultado.total_filas,
        productos_creados: resultado.productos_creados,
        productos_actualizados: resultado.productos_actualizados,
        filas_con_error: resultado.filas_con_error,
        detalle_errores: resultado.detalle_errores.map((e) => ({
          fila: e.fila,
          campo: e.campo,
          error: e.error,
        })),
        duplicadas_descartadas: duplicadasDescartadas,
        archivo_nombre: archivoNombre,
      });
      setStep('carga');
      setFilasRaw(null);
      setArchivoNombre('');
      void refreshLimite();
      router.push('/importar/resumen');
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    } finally {
      setLoadingEjec(false);
      setImportProgress(null);
    }
  }, [canEdit, filasRaw, filasValidadas, archivoNombre, router, refreshLimite]);

  const quedan = limite != null ? limite.limite - limite.usadas : null;
  const progressText = importProgress
    ? `Importando lote ${importProgress.currentChunk}/${importProgress.totalChunks} · ${importProgress.processedRows}/${importProgress.totalRows} filas procesadas`
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">IA de precios</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Extracción con Gemini y mismo flujo de preview que el importador Excel.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <Link
            href="/ia-precios/historial"
            className="text-purple-700 underline underline-offset-4 hover:text-purple-900"
          >
            Historial de precios
          </Link>
          {limite ? (
            <div
              className={`rounded-md border px-3 py-2 text-right ${
                quedan != null && quedan < 5
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-border bg-muted/40 text-muted-foreground'
              }`}
            >
              <span className="font-medium text-foreground">
                {limite.usadas}/{limite.limite}
              </span>{' '}
              extracciones usadas este mes
              {quedan != null && quedan < 5 && quedan >= 0 ? (
                <p className="mt-1 text-xs">Quedan pocas extracciones disponibles.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {step === 'carga' ? (
        <ExtraerPrecios
          onExtraccionCompleta={onExtraccionCompleta}
          onLimiteRefresh={refreshLimite}
          disabled={limite != null && !limite.permitido}
        />
      ) : null}

      {step === 'preview' && filasRaw ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setStep('carga');
                setFilasRaw(null);
                setMapeoIa(copiarMapeoIa());
                setArchivoNombre('');
                setCambios([]);
                setSugerencias([]);
              }}
            >
              ← Nueva extracción
            </button>
            <span className="mx-2">·</span>
            <span className="text-foreground">{archivoNombre}</span>
          </p>

          {!canEdit ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Tu rol no permite ejecutar la importación.
            </p>
          ) : null}

          {cambios.length > 0 ? <PrecioCambioPreview cambios={cambios} /> : null}

          <PreviewTable
            filas={filasValidadas}
            filasRaw={filasRaw}
            columnas={columnasPreview}
            onFilaEdit={onFilaEdit}
            onFilaDescartar={onFilaDescartar}
            onAgregarColumna={onAgregarColumna}
            onQuitarColumna={onQuitarColumna}
            onBulkFill={onBulkFill}
            onCalcularVentaPorMargen={onCalcularVentaPorMargen}
            onConfirmar={() => void ejecutarImportacion()}
            loading={loadingEjec || !canEdit}
            sugerenciasVentaPorFila={sugerencias}
            statusText={progressText}
          />
        </div>
      ) : null}
    </div>
  );
}
