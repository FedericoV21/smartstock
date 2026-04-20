'use client';

import { useCallback, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { parsearArchivo, type ArchivoParseado } from '@/lib/normalizador/parsear';

interface Props {
  onArchivoParsed: (data: ArchivoParseado) => void | Promise<void>;
  disabled?: boolean;
}

export function UploadArchivo({ onArchivoParsed, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const procesarArchivo = useCallback(
    async (file: File) => {
      const extensionesValidas = ['.xlsx', '.xls', '.csv'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

      if (!extensionesValidas.includes(ext)) {
        setError('Solo se aceptan archivos .xlsx, .xls o .csv');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError('El archivo no puede superar 10 MB');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await parsearArchivo(file);
        await onArchivoParsed(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onArchivoParsed]
  );

  const blocked = disabled || loading;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!blocked) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (blocked) return;
        const file = e.dataTransfer.files[0];
        if (file) void procesarArchivo(file);
      }}
      className={`relative rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
      } ${blocked ? 'pointer-events-none' : ''} ${disabled && !loading ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <div
          role="status"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-background/75 backdrop-blur-[2px]"
          aria-live="polite"
        >
          <div className="relative h-11 w-11 shrink-0">
            <div className="absolute inset-0 rounded-full bg-white shadow-md ring-1 ring-black/10" />
            <div
              className="absolute inset-0 animate-spin [animation-duration:880ms] motion-reduce:[animation:none]"
              aria-hidden
            >
              <div className="absolute left-1/2 top-1.5 h-2.5 w-2 -translate-x-1/2 rounded-[3px] bg-black" />
            </div>
          </div>
          <p className="text-sm font-medium tracking-tight text-foreground">Procesando lista…</p>
        </div>
      ) : null}
      <div className={loading ? 'invisible' : undefined} aria-hidden={loading}>
        <FileSpreadsheet className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="mb-2 text-lg font-medium">Arrastrá tu archivo acá</p>
        <p className="mb-4 text-sm text-muted-foreground">
          Formatos aceptados: .xlsx, .xls, .csv (máx. 10 MB)
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
          <Upload className="h-4 w-4" />
          Seleccionar archivo
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={blocked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void procesarArchivo(file);
            }}
          />
        </label>
      </div>
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
