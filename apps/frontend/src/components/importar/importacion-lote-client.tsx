'use client';

import { AlertCircle, Check, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { MapeoColumnas } from '@/components/importar/mapeo-columnas';
import { Button } from '@/components/ui/button';
import {
  procesarArchivoImportacionLote,
  type ResultadoArchivoImportLote,
} from '@/lib/importar/import-lote';
import { mapearHeaders, type MapeoColumna } from '@/lib/normalizador/mapear';
import { parsearArchivo, type ArchivoParseado } from '@/lib/normalizador/parsear';
import { cn } from '@/lib/utils';

const EXT_OK = ['.csv', '.xlsx', '.xls'];
const MAX_BYTES = 10 * 1024 * 1024;

type EstadoItemCola =
  | 'parseando'
  | 'mapeo'
  | 'listo'
  | 'procesando'
  | 'ok'
  | 'parcial'
  | 'error';

type ItemCola = {
  id: string;
  file: File;
  estado: EstadoItemCola;
  parsed?: ArchivoParseado;
  mapeo?: MapeoColumna[];
  errorParseo?: string;
  resultado?: ResultadoArchivoImportLote;
};

function nuevoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `lote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function aceptaArchivo(name: string): boolean {
  const idx = name.lastIndexOf('.');
  const ext = idx >= 0 ? name.slice(idx).toLowerCase() : '';
  return EXT_OK.includes(ext);
}

function etiquetaEstadoItem(item: ItemCola): string {
  switch (item.estado) {
    case 'parseando':
      return 'Leyendo archivo…';
    case 'mapeo':
      return 'Mapeo pendiente';
    case 'listo':
      return 'Listo para importar';
    case 'procesando':
      return 'Importando…';
    case 'ok':
    case 'parcial':
    case 'error':
      return item.resultado?.proveedorNombre ?? '—';
    default:
      return '';
  }
}

export function ImportacionLoteClient() {
  const { canEdit } = useDashboardRole();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cola, setCola] = useState<ItemCola[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [indiceActual, setIndiceActual] = useState(0);
  const [progresoArchivo, setProgresoArchivo] = useState<string | null>(null);
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null);
  const [mapeoActivoId, setMapeoActivoId] = useState<string | null>(null);

  const parsearItem = useCallback(async (id: string, file: File) => {
    try {
      const parsed = await parsearArchivo(file);
      const mapeo = mapearHeaders(parsed.headers);
      let activarMapeoId: string | null = null;
      setCola((prev) => {
        if (!prev.some((x) => x.estado === 'mapeo')) activarMapeoId = id;
        return prev.map((x) =>
          x.id === id ? { ...x, estado: 'mapeo' as const, parsed, mapeo } : x,
        );
      });
      if (activarMapeoId) setMapeoActivoId(activarMapeoId);
    } catch (e) {
      setCola((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                estado: 'error' as const,
                errorParseo: (e as Error).message,
              }
            : x,
        ),
      );
    }
  }, []);

  const agregarArchivos = useCallback(
    (files: FileList | File[]) => {
      setErrorGlobal(null);
      const nuevos: ItemCola[] = [];
      for (const file of files) {
        if (!aceptaArchivo(file.name)) {
          setErrorGlobal('Solo se aceptan archivos .csv, .xlsx o .xls');
          continue;
        }
        if (file.size > MAX_BYTES) {
          setErrorGlobal(`"${file.name}" supera 10 MB`);
          continue;
        }
        nuevos.push({ id: nuevoId(), file, estado: 'parseando' });
      }
      if (nuevos.length > 0) {
        setCola((prev) => [...prev, ...nuevos]);
        for (const item of nuevos) {
          void parsearItem(item.id, item.file);
        }
      }
    },
    [parsearItem],
  );

  const quitarItem = useCallback(
    (id: string) => {
      if (procesando) return;
      setCola((prev) => prev.filter((x) => x.id !== id));
      setMapeoActivoId((prev) => (prev === id ? null : prev));
    },
    [procesando],
  );

  const limpiarTerminados = useCallback(() => {
    if (procesando) return;
    setCola((prev) => prev.filter((x) => x.estado === 'parseando' || x.estado === 'mapeo' || x.estado === 'listo'));
  }, [procesando]);

  const confirmarMapeoActivo = useCallback(() => {
    if (!mapeoActivoId) return;
    setCola((prev) => {
      const next = prev.map((x) =>
        x.id === mapeoActivoId && x.estado === 'mapeo' ? { ...x, estado: 'listo' as const } : x,
      );
      const siguiente = next.find((x) => x.estado === 'mapeo');
      setMapeoActivoId(siguiente?.id ?? null);
      return next;
    });
  }, [mapeoActivoId]);

  const ejecutarCola = useCallback(async () => {
    if (!canEdit || procesando) return;
    const listos = cola.filter((x) => x.estado === 'listo' && x.mapeo);
    if (listos.length === 0) return;

    setProcesando(true);
    setErrorGlobal(null);
    setMapeoActivoId(null);
    const proveedorCache = new Map<string, string>();

    const totalEnCola = listos.length;
    for (let i = 0; i < totalEnCola; i++) {
      const item = listos[i]!;
      setIndiceActual(i + 1);
      setCola((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, estado: 'procesando' } : x)),
      );
      setProgresoArchivo(null);

      const resultado = await procesarArchivoImportacionLote(item.file, proveedorCache, {
        mapeo: item.mapeo,
        onFileProgress: (p) => {
          setProgresoArchivo(
            `Lote ${p.currentChunk}/${p.totalChunks} · ${p.processedRows}/${p.totalRows} filas`,
          );
        },
      });

      setCola((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? {
                ...x,
                estado: resultado.estado,
                resultado,
              }
            : x,
        ),
      );
    }

    setProcesando(false);
    setProgresoArchivo(null);
    setIndiceActual(0);
  }, [canEdit, cola, procesando]);

  const pendientesMapeo = cola.filter((x) => x.estado === 'mapeo').length;
  const parseando = cola.filter((x) => x.estado === 'parseando').length;
  const listos = cola.filter((x) => x.estado === 'listo').length;
  const terminados = cola.filter(
    (x) => x.estado === 'ok' || x.estado === 'parcial' || (x.estado === 'error' && x.resultado),
  );

  const itemMapeoActivo = cola.find((x) => x.id === mapeoActivoId && x.estado === 'mapeo');

  useEffect(() => {
    if (procesando || mapeoActivoId) return;
    const primero = cola.find((x) => x.estado === 'mapeo');
    if (primero) setMapeoActivoId(primero.id);
  }, [cola, mapeoActivoId, procesando]);

  const puedeImportar =
    canEdit &&
    !procesando &&
    listos > 0 &&
    pendientesMapeo === 0 &&
    parseando === 0;

  const totales = terminados.reduce(
    (acc, item) => {
      const r = item.resultado;
      if (!r) return acc;
      acc.creados += r.productos_creados;
      acc.actualizados += r.productos_actualizados;
      acc.errores += r.filas_con_error;
      if (item.estado === 'ok') acc.ok++;
      else if (item.estado === 'parcial') acc.parcial++;
      else acc.error++;
      return acc;
    },
    { ok: 0, parcial: 0, error: 0, creados: 0, actualizados: 0, errores: 0 },
  );

  const archivosEnFlujoMapeo = cola.filter(
    (x) =>
      x.estado === 'mapeo' ||
      x.estado === 'listo' ||
      x.estado === 'parseando' ||
      (x.estado === 'error' && x.errorParseo),
  );
  const indiceMapeoActivo =
    itemMapeoActivo != null
      ? archivosEnFlujoMapeo.findIndex((x) => x.id === itemMapeoActivo.id) + 1
      : 0;
  const totalParaMapeo = archivosEnFlujoMapeo.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importación en lote</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subí varios CSV o Excel. Para cada archivo vas a{' '}
          <span className="text-foreground">mapear las columnas</span> antes de importar. Debe haber
          una columna <span className="text-foreground">Proveedor</span> con un único nombre por
          archivo; si no existe en el sistema, se crea automáticamente. Solo se actualizan{' '}
          <span className="text-foreground">precios</span> (sin stock ni cuenta corriente).
        </p>
        <p className="mt-2 text-sm">
          <Link href="/importar" className="underline underline-offset-4">
            Importación estándar (un archivo)
          </Link>
        </p>
      </div>

      {!canEdit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Tu rol no permite importar datos.
        </p>
      ) : null}

      <div
        className={cn(
          'rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          'border-muted-foreground/25 hover:border-primary/50',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          disabled={!canEdit || procesando}
          onChange={(e) => {
            if (e.target.files?.length) void agregarArchivos(e.target.files);
            e.target.value = '';
          }}
        />
        <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Arrastrá archivos aquí o elegí varios a la vez
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 gap-2"
          disabled={!canEdit || procesando}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Elegir archivos
        </Button>
      </div>

      {errorGlobal ? (
        <p className="text-sm text-destructive">{errorGlobal}</p>
      ) : null}

      {itemMapeoActivo?.parsed && itemMapeoActivo.mapeo ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Archivo: <span className="font-medium text-foreground">{itemMapeoActivo.file.name}</span>
            {totalParaMapeo > 1 ? (
              <>
                {' '}
                ({indiceMapeoActivo > 0 ? indiceMapeoActivo : 1} de {totalParaMapeo} en cola)
              </>
            ) : null}
          </p>
          <MapeoColumnas
            mapeo={itemMapeoActivo.mapeo}
            onMapeoChange={(nuevo) => {
              const id = itemMapeoActivo.id;
              setCola((prev) =>
                prev.map((x) => (x.id === id ? { ...x, mapeo: nuevo } : x)),
              );
            }}
            filasMuestra={itemMapeoActivo.parsed.filas.slice(0, 5)}
            requiereProveedor
            confirmLabel={
              pendientesMapeo > 1 ? 'Confirmar y siguiente archivo' : 'Confirmar mapeo'
            }
            titulo="Mapeo de columnas de este archivo"
            onConfirmar={confirmarMapeoActivo}
          />
        </div>
      ) : null}

      {cola.length > 0 ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Cola: {cola.length} archivo(s)
              {listos > 0 ? ` · ${listos} listo(s)` : null}
              {pendientesMapeo > 0 ? ` · ${pendientesMapeo} con mapeo pendiente` : null}
              {parseando > 0 ? ` · ${parseando} leyendo…` : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {terminados.length > 0 && !procesando ? (
                <Button type="button" variant="ghost" size="sm" onClick={limpiarTerminados}>
                  Quitar terminados
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={!puedeImportar}
                onClick={() => void ejecutarCola()}
              >
                {procesando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando archivo {indiceActual}…
                  </>
                ) : (
                  `Importar ${listos} archivo(s)`
                )}
              </Button>
            </div>
          </div>

          {!puedeImportar && listos === 0 && cola.some((x) => x.estado === 'mapeo' || x.estado === 'parseando') ? (
            <p className="text-xs text-muted-foreground">
              Confirmá el mapeo de cada archivo antes de importar.
            </p>
          ) : null}

          {procesando && progresoArchivo ? (
            <p className="text-xs text-muted-foreground">{progresoArchivo}</p>
          ) : null}

          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {cola.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex items-start justify-between gap-2 rounded border px-3 py-2',
                  item.id === mapeoActivoId && item.estado === 'mapeo' && 'border-primary/50 bg-muted/30',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.file.name}</p>
                  {item.estado === 'procesando' ? (
                    <p className="text-xs text-muted-foreground">Importando…</p>
                  ) : item.resultado ? (
                    <p className="text-xs text-muted-foreground">
                      {item.resultado.proveedorNombre ?? '—'}
                      {' · '}
                      +{item.resultado.productos_creados} / ↑{item.resultado.productos_actualizados}
                      {item.resultado.filas_con_error > 0
                        ? ` · ${item.resultado.filas_con_error} error(es)`
                        : null}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{etiquetaEstadoItem(item)}</p>
                  )}
                  {item.errorParseo ? (
                    <p className="mt-1 text-xs text-destructive">{item.errorParseo}</p>
                  ) : null}
                  {item.resultado?.mensaje ? (
                    <p className="mt-1 text-xs text-destructive">{item.resultado.mensaje}</p>
                  ) : null}
                  {item.resultado && item.resultado.detalle_errores.length > 0 ? (
                    <details className="mt-1 text-xs text-red-700">
                      <summary className="cursor-pointer">
                        Ver errores ({item.resultado.detalle_errores.length})
                      </summary>
                      <ul className="mt-1 max-h-24 overflow-y-auto">
                        {item.resultado.detalle_errores.slice(0, 30).map((err, idx) => (
                          <li key={idx}>
                            Fila {err.fila}: {err.error}
                          </li>
                        ))}
                        {item.resultado.detalle_errores.length > 30 ? (
                          <li>…y {item.resultado.detalle_errores.length - 30} más</li>
                        ) : null}
                      </ul>
                    </details>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.estado === 'ok' ? (
                    <Check className="h-4 w-4 text-green-600" aria-label="OK" />
                  ) : item.estado === 'parcial' ? (
                    <AlertCircle className="h-4 w-4 text-amber-600" aria-label="Parcial" />
                  ) : item.estado === 'error' ? (
                    <AlertCircle className="h-4 w-4 text-destructive" aria-label="Error" />
                  ) : item.estado === 'procesando' || item.estado === 'parseando' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : item.estado === 'listo' ? (
                    <Check className="h-4 w-4 text-muted-foreground" aria-label="Listo" />
                  ) : null}
                  {!procesando && (item.estado === 'mapeo' || item.estado === 'listo') ? (
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs hover:bg-muted"
                      onClick={() => {
                        if (item.estado === 'listo') {
                          setCola((prev) =>
                            prev.map((x) =>
                              x.id === item.id ? { ...x, estado: 'mapeo' as const } : x,
                            ),
                          );
                        }
                        setMapeoActivoId(item.id);
                      }}
                    >
                      {item.estado === 'listo' ? 'Editar' : 'Mapear'}
                    </button>
                  ) : null}
                  {!procesando &&
                  (item.estado === 'mapeo' ||
                    item.estado === 'listo' ||
                    item.estado === 'parseando' ||
                    (item.estado === 'error' && item.errorParseo)) ? (
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-muted"
                      aria-label="Quitar"
                      onClick={() => quitarItem(item.id)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {terminados.length > 0 && !procesando ? (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-medium">Resumen del lote</p>
          <ul className="mt-2 list-inside list-disc text-muted-foreground">
            <li>
              {totales.ok} archivo(s) sin errores, {totales.parcial} parcial(es), {totales.error}{' '}
              fallido(s)
            </li>
            <li>
              {totales.creados} productos creados, {totales.actualizados} actualizados
            </li>
            {totales.errores > 0 ? <li>{totales.errores} filas con error en total</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
