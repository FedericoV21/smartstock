'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resolverIds: () => Promise<{ ids: string[]; truncado: boolean }>;
  onExito?: () => void;
};

const MAX_LOTE = 250;

export function ActualizarGananciaLoteModal({ open, onOpenChange, resolverIds, onExito }: Props) {
  const [cargandoIds, setCargandoIds] = useState(false);
  const [productoIds, setProductoIds] = useState<string[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [ganStr, setGanStr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);

  const resolverIdsRef = useRef(resolverIds);
  resolverIdsRef.current = resolverIds;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setError(null);
      setExito(null);
      setProgreso(null);
      setGanStr('');
      setProductoIds([]);
      setTruncado(false);
      setCargandoIds(true);
      try {
        const { ids, truncado: t } = await resolverIdsRef.current();
        if (ids.length === 0) {
          setError('No hay productos seleccionados.');
        } else {
          setProductoIds(ids);
        }
        setTruncado(t);
      } catch {
        setError('No se pudieron cargar los productos. Probá de nuevo.');
      } finally {
        setCargandoIds(false);
      }
    })();
  }, [open]);

  const confirmar = useCallback(async () => {
    const valor = Number(ganStr.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0 || valor > 999.99) {
      setError('Ingresá un porcentaje válido (0 a 999.99).');
      return;
    }
    if (productoIds.length === 0) return;

    setEnviando(true);
    setError(null);
    setExito(null);
    setProgreso(null);

    const totalLotes = Math.max(1, Math.ceil(productoIds.length / MAX_LOTE));
    let actualizados = 0;
    let sinCosto = 0;

    try {
      for (let off = 0, lote = 1; off < productoIds.length; off += MAX_LOTE, lote++) {
        const slice = productoIds.slice(off, off + MAX_LOTE);
        setProgreso(`Enviando lote ${lote}/${totalLotes} (${slice.length} productos)…`);

        const res = await fetch('/api/productos/bulk-ganancia', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: slice, porcentaje_ganancia: valor }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          actualizados?: number;
          sin_costo?: number;
        };

        if (!res.ok) {
          setError(`${j.error ?? 'Error al actualizar'} (lote ${lote}/${totalLotes})`);
          return;
        }
        actualizados += j.actualizados ?? 0;
        sinCosto += j.sin_costo ?? 0;
      }

      const partes = [`${actualizados} producto(s) actualizado(s) con ganancia ${valor}%.`];
      if (sinCosto > 0) {
        partes.push(`${sinCosto} guardado(s) sin recalcular venta (sin costo cargado).`);
      }
      setExito(partes.join(' '));
      onExito?.();
    } catch {
      setError('Error de conexión');
    } finally {
      setEnviando(false);
      setProgreso(null);
    }
  }, [ganStr, productoIds, onExito]);

  const cierre = (openNext: boolean) => {
    if (enviando) return;
    onOpenChange(openNext);
  };

  return (
    <Dialog open={open} onOpenChange={cierre}>
      <DialogContent className="max-w-md" showCloseButton={!enviando}>
        <DialogHeader>
          <DialogTitle>Cambiar ganancia en lote</DialogTitle>
          <DialogDescription>
            Se aplica el mismo porcentaje a todos los productos seleccionados y se recalcula el
            precio de venta usando el costo actual.
          </DialogDescription>
        </DialogHeader>

        {cargandoIds ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando lista de productos…
          </div>
        ) : null}

        {!cargandoIds && productoIds.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {productoIds.length} producto{productoIds.length === 1 ? '' : 's'} a actualizar
            {truncado ? ' (lote truncado: filtrá más o repetí con otro lote)' : null}.
          </p>
        ) : null}

        {progreso && enviando ? (
          <p className="text-sm font-medium text-foreground">{progreso}</p>
        ) : null}

        {!cargandoIds && productoIds.length > 0 && !exito ? (
          <div className="space-y-1">
            <label htmlFor="ganancia-pct" className="text-sm font-medium text-foreground">
              Ganancia (%)
            </label>
            <Input
              id="ganancia-pct"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="999.99"
              placeholder="Ej: 30"
              value={ganStr}
              onChange={(e) => setGanStr(e.target.value)}
              disabled={enviando}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Se actualiza la ganancia base del producto. Los productos sin costo guardan el % igual,
              sin recalcular el precio de venta.
            </p>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {exito ? <p className="text-sm text-green-800">{exito}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => cierre(false)}
            disabled={enviando}
          >
            {exito ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!cargandoIds && productoIds.length > 0 && !exito ? (
            <Button
              type="button"
              disabled={enviando || ganStr.trim() === ''}
              onClick={() => void confirmar()}
            >
              {enviando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aplicando…
                </>
              ) : (
                'Aplicar'
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
