'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { PreviewTable } from '@/components/importar/preview-table';
import {
  clearImportDraft,
  readImportDraft,
  writeImportDraft,
  writeImportResult,
  type ImportDraftV1,
} from '@/lib/importar/draft';
import { ejecutarImportacionPorLotes, type ImportProgress } from '@/lib/importar/client-import';
import { type CampoProducto } from '@/lib/normalizador/aliases';
import { deduplicarFilas } from '@/lib/normalizador/deduplicar';
import type { MapeoColumna } from '@/lib/normalizador/mapear';
import { validarFila, validarFilas, type FilaValidada } from '@/lib/normalizador/validar';

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
  codigo_barras?: string | null;
  rubro?: string | null;
  subrubro?: string | null;
  iva_porcentaje?: number | null;
  porcentaje_ganancia?: number | null;
  ubicacion?: string | null;
  moneda?: string | null;
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
    codigo_barras: d.codigo_barras != null ? String(d.codigo_barras) : null,
    rubro: d.rubro != null ? String(d.rubro) : null,
    subrubro: d.subrubro != null ? String(d.subrubro) : null,
    iva_porcentaje: d.iva_porcentaje as number | null | undefined,
    porcentaje_ganancia: d.porcentaje_ganancia as number | null | undefined,
    ubicacion: d.ubicacion != null ? String(d.ubicacion) : null,
    moneda: d.moneda != null ? String(d.moneda) : null,
  };
}

type DraftMeta = Omit<ImportDraftV1, 'archivo'> & {
  archivo: Omit<ImportDraftV1['archivo'], 'filas'>;
};

function sinFilas(draft: ImportDraftV1): DraftMeta {
  const { filas, ...archivo } = draft.archivo;
  return {
    ...draft,
    archivo,
  };
}

function buildDraftHeaders(baseHeaders: string[], mapeo: MapeoColumna[]): string[] {
  const fileHeaders = baseHeaders.filter((h) => !String(h).startsWith('__ss_'));
  const syntheticHeaders = mapeo.filter((m) => m.sintetica).map((m) => m.headerOriginal);
  const headers = [...fileHeaders];
  for (const header of syntheticHeaders) {
    if (!headers.includes(header)) headers.push(header);
  }
  return headers;
}

export default function ImportarPreviewPage() {
  const router = useRouter();
  const { canEdit } = useDashboardRole();
  const [draft, setDraft] = useState<DraftMeta | null>(null);
  const [filasRaw, setFilasRaw] = useState<Record<string, string | number | null>[] | null>(null);
  const [mapeo, setMapeo] = useState<MapeoColumna[] | null>(null);
  const [filasValidadas, setFilasValidadas] = useState<FilaValidada[]>([]);
  const [loading, setLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const d = await readImportDraft();
      if (cancelled) return;
      if (!d) {
        router.replace('/importar');
        return;
      }
      setDraft(sinFilas(d));
      setFilasRaw(d.archivo.filas);
      setMapeo(d.mapeo);
      setFilasValidadas(validarFilas(d.archivo.filas, d.mapeo));
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const columnasPreview = useMemo(
    () =>
      (mapeo ?? [])
        .filter((m) => !m.ignorar && m.campoDetectado)
        .map((m) => ({
          headerOriginal: m.headerOriginal,
          campo: m.campoDetectado!,
          sintetica: m.sintetica,
        })),
    [mapeo]
  );

  useEffect(() => {
    if (!draft || filasRaw === null || !mapeo) return;
    const timeout = window.setTimeout(() => {
      void writeImportDraft({
        ...draft,
        mapeo,
        archivo: {
          ...draft.archivo,
          filas: filasRaw,
          headers: buildDraftHeaders(draft.archivo.headers, mapeo),
        },
      });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [draft, filasRaw, mapeo]);

  const onFilaEdit = useCallback(
    (index: number, headerOriginal: string, valor: string | number | null) => {
      if (!filasRaw || !mapeo) return;
      const nextRows = [...filasRaw];
      const updatedRow = { ...nextRows[index], [headerOriginal]: valor };
      nextRows[index] = updatedRow;

      setFilasRaw(nextRows);
      setFilasValidadas((prev) => {
        const next = prev.length === nextRows.length ? [...prev] : validarFilas(nextRows, mapeo);
        next[index] = validarFila(updatedRow, index, mapeo);
        return next;
      });
    },
    [filasRaw, mapeo]
  );

  const onAgregarColumna = useCallback(
    (campo: CampoProducto) => {
      if (!filasRaw || !mapeo) return;
      const header = generarHeaderSintetico(campo);
      const nextRows = filasRaw.map((row) => ({ ...row, [header]: null }));
      const nextMapeo = [
        ...(mapeo ?? []),
        {
          headerOriginal: header,
          campoDetectado: campo,
          confianza: 'ninguna' as const,
          ignorar: false,
          sintetica: true,
        },
      ];
      setMapeo((prev) => [
        ...(prev ?? []),
        {
          headerOriginal: header,
          campoDetectado: campo,
          confianza: 'ninguna',
          ignorar: false,
          sintetica: true,
        },
      ]);
      setFilasRaw(nextRows);
      setFilasValidadas(validarFilas(nextRows, nextMapeo));
    },
    [filasRaw, mapeo]
  );

  const onQuitarColumna = useCallback(
    (headerOriginal: string) => {
      if (!filasRaw || !mapeo) return;
      const target = (mapeo ?? []).find((m) => m.headerOriginal === headerOriginal);
      if (!target?.sintetica) return;
      const nextMapeo = mapeo.filter((m) => m.headerOriginal !== headerOriginal);
      const nextRows = filasRaw.map((row) => {
        const next = { ...row };
        delete next[headerOriginal];
        return next;
      });
      setMapeo((prev) => (prev ?? []).filter((m) => m.headerOriginal !== headerOriginal));
      setFilasRaw(nextRows);
      setFilasValidadas(validarFilas(nextRows, nextMapeo));
    },
    [filasRaw, mapeo]
  );

  const onBulkFill = useCallback(
    (headerOriginal: string, valorTexto: string, filaIndices: number[]) => {
      if (!filasRaw || !mapeo) return;

      const nextRows = [...filasRaw];
      const nextValidated = [...filasValidadas];
      for (const rowIndex of filaIndices) {
        const updatedRow = {
          ...nextRows[rowIndex],
          [headerOriginal]: valorTexto === '' ? null : valorTexto,
        };
        nextRows[rowIndex] = updatedRow;
        nextValidated[rowIndex] = validarFila(updatedRow, rowIndex, mapeo);
      }

      setFilasRaw(nextRows);
      setFilasValidadas(nextValidated);
    },
    [filasRaw, filasValidadas, mapeo]
  );

  const onCalcularVentaPorMargen = useCallback(
    (headerPrecioVenta: string, porcentajeSobreCosto: number, filaIndices: number[]) => {
      if (!filasRaw || !mapeo) return;

      const nextRows = [...filasRaw];
      const nextValidated = [...filasValidadas];

      for (const rowIndex of filaIndices) {
        const costoRaw = filasValidadas[rowIndex]?.datos.precio_costo;
        const costo = typeof costoRaw === 'number' && !Number.isNaN(costoRaw) ? costoRaw : null;
        if (costo === null) continue;

        const venta = Math.round(costo * (1 + porcentajeSobreCosto / 100) * 100) / 100;
        const updatedRow = { ...nextRows[rowIndex], [headerPrecioVenta]: venta };
        nextRows[rowIndex] = updatedRow;
        nextValidated[rowIndex] = validarFila(updatedRow, rowIndex, mapeo);
      }

      setFilasRaw(nextRows);
      setFilasValidadas(nextValidated);
    },
    [filasRaw, filasValidadas, mapeo]
  );

  const onFilaDescartar = useCallback(
    (index: number) => {
      if (!filasRaw || !mapeo) return;
      const nextRows = filasRaw.filter((_, i) => i !== index);
      setFilasRaw(nextRows);
      setFilasValidadas(validarFilas(nextRows, mapeo));
    },
    [filasRaw, mapeo]
  );

  const ejecutarImportacion = useCallback(async () => {
    if (!draft || !canEdit) return;
    const validas = filasValidadas.filter((f) => f.valida);
    const { unicas, duplicadasDescartadas } = deduplicarFilas(validas);
    const filas = unicas.map(filaValidadaToPayload);

    setLoading(true);
    setImportProgress(null);
    try {
      const resultado = await ejecutarImportacionPorLotes(
        {
          filas,
          proveedor_id: draft.proveedorId,
          archivo_nombre: draft.archivo.nombreArchivo,
          origen: 'importacion_excel',
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
        archivo_nombre: draft.archivo.nombreArchivo,
      });
      await clearImportDraft();
      router.push('/importar/resumen');
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  }, [draft, canEdit, filasValidadas, router]);

  const progressText = importProgress
    ? `Importando lote ${importProgress.currentChunk}/${importProgress.totalChunks} · ${importProgress.processedRows}/${importProgress.totalRows} filas procesadas`
    : null;

  if (!filasRaw || !mapeo || !draft) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <p className="text-sm text-muted-foreground">
        <Link
          href={draft.saltoMapeoPorPerfil ? '/importar' : '/importar/mapeo'}
          className="underline underline-offset-4"
        >
          ← {draft.saltoMapeoPorPerfil ? 'Volver al inicio' : 'Volver al mapeo'}
        </Link>
      </p>

      {!canEdit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Tu rol no permite ejecutar la importación.
        </p>
      ) : null}

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
        loading={loading || !canEdit}
        statusText={progressText}
      />
    </div>
  );
}
