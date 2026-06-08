'use client';

import { useCallback, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Brain, Info, Loader2, Upload, X } from 'lucide-react';

export type LectorExtraccionOk = Record<string, unknown>;

interface Props {
  onExtraccionCompleta: (payload: LectorExtraccionOk, archivoNombre: string) => void;
  onLimiteRefresh?: () => void;
  disabled?: boolean;
}

function nombreGrupoArchivos(files: File[]): string {
  if (files.length === 0) return '';
  if (files.length === 1) return files[0]?.name ?? 'factura';
  return `${files[0]?.name ?? 'factura'} (+${files.length - 1} archivos)`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function ExtraerFactura({ onExtraccionCompleta, onLimiteRefresh, disabled }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);

  const totalBytes = useMemo(
    () => archivos.reduce((acc, file) => acc + file.size, 0),
    [archivos],
  );

  const moverArchivo = useCallback((from: number, to: number) => {
    setArchivos((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (!item) return prev;
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const procesarArchivos = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        setError('Selecciona al menos un archivo.');
        return;
      }

      setLoading(true);
      setError(null);

      const formData = new FormData();
      for (const file of files) {
        formData.append('archivo', file);
      }

      try {
        const res = await fetch('/api/lector-facturas/extraer', {
          method: 'POST',
          body: formData,
        });

        const json = (await res.json()) as { error?: string; respuesta_raw?: string; archivo_nombre?: string } & LectorExtraccionOk;

        if (!res.ok) {
          setError(json.error || 'Error al procesar el archivo');
          return;
        }

        onExtraccionCompleta(json, json.archivo_nombre || nombreGrupoArchivos(files));
        onLimiteRefresh?.();
      } catch {
        setError('Error de conexion. Intenta de nuevo.');
      } finally {
        setLoading(false);
      }
    },
    [onExtraccionCompleta, onLimiteRefresh],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-purple-600" />
        <div>
          <h2 className="text-lg font-semibold">Extraccion con IA</h2>
          <p className="text-muted-foreground text-sm">
            Subi un PDF o varias hojas de una factura o ticket. La IA extrae items, CUITs y totales; despues
            revisas y confirmas como en IA Precios.
          </p>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <div className="space-y-1.5 leading-snug">
          <p className="font-medium">Antes de subir el archivo</p>
          <p>
            Es importante que la foto o el escaneo sea <strong>lo mas claro posible</strong>: buena luz, buen enfoque
            y que esten <strong>visibles todos los datos</strong> del comprobante.
          </p>
          <p>
            Si subis varias imagenes, ordenalas como aparecen en la factura. Los totales pueden estar solo en la ultima
            hoja.
          </p>
        </div>
      </div>

      <div
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          loading || disabled
            ? 'pointer-events-none border-purple-200 bg-purple-50 opacity-50'
            : 'border-muted-foreground/25'
        }`}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-purple-600" />
            <p className="text-sm text-purple-700">
              Analizando <span className="font-medium">{nombreGrupoArchivos(archivos)}</span> con IA...
            </p>
            <p className="text-xs text-muted-foreground">Puede tardar entre 30 segundos y 2 minutos</p>
          </div>
        ) : (
          <>
            <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-4 text-sm text-muted-foreground">
              Formatos: PDF, JPG, PNG, WebP. Podes seleccionar varias hojas.
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700">
              <Brain className="h-4 w-4" />
              Seleccionar archivos
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                disabled={disabled}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  setArchivos(selected);
                  setError(null);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </>
        )}
      </div>

      {archivos.length > 0 && !loading ? (
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <p className="text-sm font-medium">Hojas seleccionadas</p>
              <p className="text-muted-foreground text-xs">
                {archivos.length} archivo(s), {formatBytes(totalBytes)}
              </p>
            </div>
            <button
              type="button"
              className="rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              disabled={disabled || archivos.length === 0}
              onClick={() => void procesarArchivos(archivos)}
            >
              Procesar con IA
            </button>
          </div>

          <ul className="divide-y">
            {archivos.map((file, idx) => (
              <li key={`${file.name}-${file.size}-${idx}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{idx + 1}</span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-muted-foreground text-xs">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  className="rounded border p-1.5 hover:bg-muted disabled:opacity-40"
                  title="Subir hoja"
                  disabled={idx === 0}
                  onClick={() => moverArchivo(idx, idx - 1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded border p-1.5 hover:bg-muted disabled:opacity-40"
                  title="Bajar hoja"
                  disabled={idx === archivos.length - 1}
                  onClick={() => moverArchivo(idx, idx + 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded border p-1.5 text-destructive hover:bg-destructive/10"
                  title="Quitar hoja"
                  onClick={() => setArchivos((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}
    </div>
  );
}
