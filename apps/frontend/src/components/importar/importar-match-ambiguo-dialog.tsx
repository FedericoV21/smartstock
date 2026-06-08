'use client';

import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils/formatters';

export type MatchAmbiguoProducto = {
  id: string;
  codigo: string;
  nombre: string;
  codigo_barras: string | null;
  sucursal_id?: string;
  sucursal_nombre?: string | null;
  activo: boolean;
  updated_at: string;
  stock_actual: number;
  precio_costo?: number | null;
  precio_venta?: number | null;
  unidad?: string | null;
  unidad_compra?: string | null;
  contenido_unidad_compra?: number | null;
};

export type MatchAmbiguoFila = {
  fila_original: number;
  codigo: string | null;
  nombre: string;
  matches: MatchAmbiguoProducto[];
  motivo?: 'multiples' | 'unidad_distinta';
  unidad_fila?: string | null;
};

export type ResolucionMatchFila =
  | { action: 'update'; producto_id: string; motivo?: 'unidad_distinta' }
  | { action: 'create' };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filas: MatchAmbiguoFila[];
  onConfirm: (resolucion: Record<string, ResolucionMatchFila>) => void;
};

type EstadoFila =
  | { action: 'create' }
  | { action: 'update'; producto_id: string };

function labelProducto(p: MatchAmbiguoProducto): string {
  const partes = [p.activo ? 'Activo' : 'Inactivo'];
  if (p.sucursal_nombre?.trim()) partes.push(`Sucursal: ${p.sucursal_nombre.trim()}`);
  else if (p.sucursal_id) partes.push('Sucursal: otra');
  if (p.unidad) partes.push(`Unidad: ${p.unidad}`);
  const contenido = Number(p.contenido_unidad_compra);
  if (p.unidad_compra && Number.isFinite(contenido) && contenido > 0) {
    partes.push(`Compra: 1 ${p.unidad_compra} = ${contenido} ${p.unidad ?? 'u.'}`);
  }
  if (p.precio_costo != null && Number.isFinite(Number(p.precio_costo))) {
    partes.push(`Costo: ${formatCurrency(Number(p.precio_costo))}`);
  }
  if (p.precio_venta != null && Number.isFinite(Number(p.precio_venta))) {
    partes.push(`Venta: ${formatCurrency(Number(p.precio_venta))}`);
  }
  if (Number.isFinite(p.stock_actual)) partes.push(`Stock: ${p.stock_actual}`);
  if (p.codigo_barras) partes.push(`Barras: ${p.codigo_barras}`);
  return `${p.nombre} - ${partes.join(' - ')}`;
}

function motivoFila(f: MatchAmbiguoFila): string {
  if (f.motivo === 'unidad_distinta') {
    return `Mismo codigo con otra unidad registrada. La lista trae ${f.unidad_fila ?? 'otra unidad'}.`;
  }
  return `${f.matches.length} candidatos para el mismo codigo.`;
}

export function ImportarMatchAmbiguoDialog({ open, onOpenChange, filas, onConfirm }: Props) {
  const estadoKey = useMemo(
    () =>
      filas
        .map((f) => `${f.fila_original}:${f.motivo ?? 'multiples'}:${f.matches.map((m) => m.id).join(',')}`)
        .join('|'),
    [filas],
  );
  const [estado, setEstado] = useState<{ key: string; values: Record<string, EstadoFila> }>(() => ({
    key: '',
    values: {},
  }));

  const estadoFila = useCallback(
    (f: MatchAmbiguoFila): EstadoFila | null => {
      const key = String(f.fila_original);
      if (estado.key === estadoKey && estado.values[key]) return estado.values[key]!;
      const first = f.matches[0];
      if (!first || f.motivo === 'unidad_distinta') return { action: 'create' };
      return { action: 'update', producto_id: first.id };
    },
    [estado, estadoKey],
  );

  const incompletas = useMemo(() => {
    for (const f of filas) {
      const e = estadoFila(f);
      if (!e) return true;
      if (e.action === 'update' && !e.producto_id) return true;
    }
    return false;
  }, [estadoFila, filas]);

  const setFila = useCallback((filaOriginal: number, next: EstadoFila) => {
    setEstado((prev) => ({
      key: estadoKey,
      values: {
        ...(prev.key === estadoKey ? prev.values : {}),
        [String(filaOriginal)]: next,
      },
    }));
  }, [estadoKey]);

  const handleConfirm = useCallback(() => {
    const out: Record<string, ResolucionMatchFila> = {};
    for (const f of filas) {
      const e = estadoFila(f);
      if (!e) continue;
      out[String(f.fila_original)] =
        e.action === 'create'
          ? { action: 'create' }
          : {
              action: 'update',
              producto_id: e.producto_id,
              motivo: f.motivo === 'unidad_distinta' ? 'unidad_distinta' : undefined,
            };
    }
    onConfirm(out);
    onOpenChange(false);
  }, [estadoFila, filas, onConfirm, onOpenChange]);

  if (filas.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisar productos antes de importar</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Hay filas que pueden pisar productos existentes o comparten codigo con otra presentacion.
          Elegi si queres actualizar el producto existente o crear uno nuevo.
        </p>

        <div className="space-y-6">
          {filas.map((f) => {
            const key = String(f.fila_original);
            const e = estadoFila(f);
            const displayCod = (f.codigo ?? '').trim() || '-';
            const displayNom = (f.nombre ?? '').trim() || '-';
            return (
              <div key={key} className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Fila {f.fila_original} - Codigo <span className="text-foreground">{displayCod}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Nombre: <span className="text-foreground font-medium">{displayNom}</span> - {motivoFila(f)}
                  </p>
                </div>

                <div className="space-y-2 text-sm">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      className="mt-1"
                      name={`match-${key}`}
                      checked={e?.action === 'update'}
                      onChange={() => {
                        const first = f.matches[0];
                        if (!first) return;
                        setFila(f.fila_original, { action: 'update', producto_id: first.id });
                      }}
                    />
                    <span className="text-foreground">Actualizar producto existente</span>
                  </label>

                  {e?.action === 'update' ? (
                    <div className="pl-0 sm:pl-6">
                      <select
                        className="border-input bg-background w-full max-w-xl rounded-md border px-2 py-1.5 text-sm"
                        value={e.producto_id}
                        onChange={(ev) =>
                          setFila(f.fila_original, { action: 'update', producto_id: String(ev.target.value) })
                        }
                      >
                        {f.matches.map((p) => (
                          <option key={p.id} value={p.id}>
                            {labelProducto(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      className="mt-1"
                      name={`match-${key}`}
                      checked={e?.action === 'create'}
                      onChange={() => setFila(f.fila_original, { action: 'create' })}
                    />
                    <span className="text-foreground">Crear nuevo producto</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button type="button" disabled={incompletas} onClick={handleConfirm}>
            Continuar importacion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
