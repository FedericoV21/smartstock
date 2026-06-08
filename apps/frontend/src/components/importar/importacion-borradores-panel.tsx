'use client';

import { FileSpreadsheet, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  eliminarImportacionBorrador,
  listarImportacionBorradores,
  type ImportacionBorradorFlujo,
  type ImportacionBorradorListItem,
} from '@/lib/importar/borradores';

type Props = {
  flujo: ImportacionBorradorFlujo;
  onRetomar: (id: string) => void | Promise<void>;
};

function formatearFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function pasoLabel(paso: ImportacionBorradorListItem['paso']): string {
  return paso === 'mapeo' ? 'Mapeo' : 'Preview';
}

export function ImportacionBorradoresPanel({ flujo, onRetomar }: Props) {
  const [items, setItems] = useState<ImportacionBorradorListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listarImportacionBorradores(flujo));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [flujo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loading && items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Borradores guardados</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading ? 'Buscando borradores...' : `${items.length} pendiente(s)`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando...
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex flex-col gap-3 rounded-md border border-border/80 bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{b.archivo_nombre}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pasoLabel(b.paso)} · {b.total_filas} fila(s) · {formatearFecha(b.updated_at)}
                    {b.proveedor?.nombre ? ` · ${b.proveedor.nombre}` : ''}
                    {b.sucursal?.nombre ? ` · ${b.sucursal.nombre}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === b.id}
                  onClick={async () => {
                    setBusyId(b.id);
                    try {
                      await onRetomar(b.id);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Retomar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Eliminar borrador"
                  disabled={busyId === b.id}
                  onClick={async () => {
                    setBusyId(b.id);
                    try {
                      await eliminarImportacionBorrador(b.id);
                      setItems((prev) => prev.filter((x) => x.id !== b.id));
                      toast.success('Borrador eliminado');
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
