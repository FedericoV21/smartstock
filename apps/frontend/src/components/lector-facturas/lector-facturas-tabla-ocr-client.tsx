'use client';

import { AlertTriangle, CheckCircle2, Code2, FileScan, Loader2, Upload } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';

type TablaOcrItem = {
  indice: number;
  codigo: string | null;
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  subtotal: number | null;
  confianza: number;
  fuente: string;
  advertencias: string[];
};

type TablaOcrResultado = {
  metodo: 'ocr_tabla';
  items: TablaOcrItem[];
  raw_text: string;
  lineas: string[];
  advertencias: string[];
  validacion: {
    suma_items: number;
    items_con_diferencia: number;
    items_cuadran: boolean;
  };
  meta: {
    archivo_nombre: string;
    mime_type: string;
    confianza_ocr: number;
    filas_detectadas: number;
  };
};

function formatNumero(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'Sin dato';
  return v.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

function formatMonto(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'Sin dato';
  return formatCurrency(v);
}

export function LectorFacturasTablaOcrClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [resultado, setResultado] = useState<TablaOcrResultado | null>(null);
  const [mostrarJson, setMostrarJson] = useState(false);
  const [mostrarTexto, setMostrarTexto] = useState(false);

  const previewUrl = useMemo(() => (archivo ? URL.createObjectURL(archivo) : null), [archivo]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const procesarArchivo = useCallback(async (file: File) => {
    setArchivo(file);
    setResultado(null);
    setError(null);
    setLoading(true);

    const formData = new FormData();
    formData.append('archivo', file);

    try {
      const res = await fetch('/api/lector-facturas/tabla-ocr', {
        method: 'POST',
        body: formData,
      });
      const json = (await res.json()) as ({ error?: string } & Partial<TablaOcrResultado>);
      if (!res.ok) {
        setError(json.error || 'No se pudo leer la tabla con OCR');
        return;
      }
      setResultado(json as TablaOcrResultado);
    } catch {
      setError('Error de conexion. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/lector-facturas" className="hover:text-foreground">
              Lector facturas
            </Link>
            <span>/</span>
            <span>Tabla OCR</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Lector de tabla sin IA</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Prueba separada para convertir la zona de items de una imagen en filas JSON usando OCR local y reglas de columnas.
          </p>
        </div>
        <Link href="/lector-facturas" className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}>
            <FileScan className="h-4 w-4" />
            Lector con IA
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <FileScan className="h-6 w-6 text-[color:var(--brand-primary)]" />
              <div>
                <h2 className="font-semibold">Imagen de factura</h2>
                <p className="text-sm text-muted-foreground">JPG, PNG o WebP. Maximo 12 MB.</p>
              </div>
            </div>

            <div
              className={[
                'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
                loading ? 'pointer-events-none border-primary/30 bg-primary/5 opacity-70' : 'border-muted-foreground/25',
              ].join(' ')}
            >
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-9 w-9 animate-spin text-[color:var(--brand-primary)]" />
                  <p className="text-sm font-medium">Leyendo tabla con OCR...</p>
                  <p className="text-xs text-muted-foreground">{archivo?.name}</p>
                </div>
              ) : (
                <>
                  <Upload className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-[color:var(--brand-primary-hover)]">
                    <Upload className="h-4 w-4" />
                    Seleccionar imagen
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void procesarArchivo(file);
                      }}
                    />
                  </label>
                </>
              )}
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-100">
                {error}
              </div>
            ) : null}
          </div>

          {previewUrl ? (
            <div className="relative h-[min(520px,70vh)] w-full overflow-hidden rounded-lg border bg-card p-3 shadow-sm">
              <Image
                src={previewUrl}
                alt="Vista previa de factura"
                fill
                unoptimized
                className="rounded-md object-contain"
                sizes="(max-width: 768px) 100vw, 640px"
              />
            </div>
          ) : null}
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          {resultado ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase text-muted-foreground">Filas</p>
                  <p className="mt-1 text-2xl font-semibold">{resultado.meta.filas_detectadas}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase text-muted-foreground">Suma items</p>
                  <p className="mt-1 text-xl font-semibold">{formatMonto(resultado.validacion.suma_items)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase text-muted-foreground">Confianza OCR</p>
                  <p className="mt-1 text-2xl font-semibold">{resultado.meta.confianza_ocr}%</p>
                </div>
              </div>

              {resultado.advertencias.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    Revision necesaria
                  </div>
                  <ul className="list-disc space-y-1 pl-5">
                    {resultado.advertencias.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/25 dark:text-green-100">
                  <CheckCircle2 className="h-4 w-4" />
                  La tabla se reconstruyo sin diferencias internas detectadas.
                </div>
              )}

              <div className="rounded-lg border bg-card shadow-sm">
                <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold">Items detectados</h2>
                    <p className="text-sm text-muted-foreground">{resultado.meta.archivo_nombre}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setMostrarTexto((v) => !v)}>
                      <FileScan className="h-4 w-4" />
                      Texto OCR
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setMostrarJson((v) => !v)}>
                      <Code2 className="h-4 w-4" />
                      JSON
                    </Button>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Cant.</TableHead>
                      <TableHead>Descripcion</TableHead>
                      <TableHead className="w-28">Codigo</TableHead>
                      <TableHead className="w-32 text-right">Unitario</TableHead>
                      <TableHead className="w-32 text-right">Importe</TableHead>
                      <TableHead className="w-24 text-right">Conf.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.items.map((item) => (
                      <TableRow key={`${item.indice}-${item.codigo ?? item.descripcion}`}>
                        <TableCell>{formatNumero(item.cantidad)}</TableCell>
                        <TableCell className="min-w-[260px] whitespace-normal">
                          <div className="font-medium">{item.descripcion}</div>
                          {item.advertencias.length > 0 ? (
                            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                              {item.advertencias.join(' ')}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>{item.codigo ?? 'Sin dato'}</TableCell>
                        <TableCell className="text-right">{formatMonto(item.precio_unitario)}</TableCell>
                        <TableCell className="text-right">{formatMonto(item.subtotal)}</TableCell>
                        <TableCell className="text-right">{item.confianza}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {mostrarTexto ? (
                <pre className="max-h-[360px] overflow-auto rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed">
                  {resultado.raw_text}
                </pre>
              ) : null}

              {mostrarJson ? (
                <pre className="max-h-[480px] overflow-auto rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed">
                  {JSON.stringify(resultado, null, 2)}
                </pre>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
              <div className="max-w-sm">
                <FileScan className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <h2 className="font-semibold">Subi una factura para probar</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  El resultado queda separado del lector con IA y no confirma comprobantes.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
