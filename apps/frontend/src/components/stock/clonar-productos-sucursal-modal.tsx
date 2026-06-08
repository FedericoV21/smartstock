'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type Sucursal = { id: string; codigo: string; nombre: string; activa: boolean; es_principal: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resolverIds: () => Promise<{ ids: string[]; sucursal_id: string; truncado: boolean }>;
  onExito?: () => void;
};

type ResultItem = {
  sucursal_destino_id: string;
  error?: string;
  total_creados?: number;
};

/** Debe coincidir con MAX_PRODUCTO_IDS_POR_REQUEST en la API. */
const IDS_POR_PETICION = 300;

export function ClonarProductosSucursalModal({ open, onOpenChange, resolverIds, onExito }: Props) {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [cargandoIds, setCargandoIds] = useState(false);
  const [origenId, setOrigenId] = useState<string>('');
  const [productoIds, setProductoIds] = useState<string[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);

  const destinosElegibles = useMemo(
    () => sucursales.filter((s) => s.id && s.id !== origenId),
    [sucursales, origenId],
  );

  /**
   * `resolverIds` se recalcula al vaciar la selección en el padre tras el éxito; si el efecto
   * dependiera de él, re-ejecutaría con el modal abierto, ids = [] y pisaría el cartel de éxito
   * con "No hay productos para clonar."
   */
  const resolverIdsRef = useRef(resolverIds);
  resolverIdsRef.current = resolverIds;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setError(null);
      setExito(null);
      setElegidos(new Set());
      setCargandoIds(true);
      setProductoIds([]);
      setTruncado(false);
      setOrigenId('');
      try {
        const { ids, sucursal_id, truncado: t } = await resolverIdsRef.current();
        if (ids.length === 0) {
          setError('No hay productos para clonar.');
        } else {
          setProductoIds(ids);
        }
        setOrigenId(sucursal_id);
        setTruncado(t);
      } catch {
        setError('No se pudieron cargar los productos. Probá de nuevo.');
      } finally {
        setCargandoIds(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const res = await fetch('/api/configuracion/sucursal-activa');
      const j = (await res.json()) as { sucursales?: Sucursal[] };
      if (res.ok) {
        setSucursales((j.sucursales ?? []).filter((s) => s.activa));
      }
    })();
  }, [open]);

  const toggle = (id: string) => {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const confirmar = useCallback(async () => {
    if (!origenId || elegidos.size === 0 || productoIds.length === 0) {
      setError('Elegí al menos una sucursal de destino y asegurate de haber cargado productos.');
      return;
    }
    setEnviando(true);
    setError(null);
    setExito(null);
    setProgreso(null);
    const destArr = [...elegidos];
    const byId = (id: string) => destinosElegibles.find((d) => d.id === id)?.nombre ?? id;
    const totalLotes = Math.max(1, Math.ceil(productoIds.length / IDS_POR_PETICION));

    let acumUnDest = 0;
    const acumMulti = new Map<string, number>();

    try {
      for (let off = 0, lote = 1; off < productoIds.length; off += IDS_POR_PETICION, lote++) {
        const slice = productoIds.slice(off, off + IDS_POR_PETICION);
        setProgreso(`Enviando lote ${lote}/${totalLotes} (${slice.length} productos)…`);

        const res = await fetch('/api/productos/clonar-sucursal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sucursal_origen_id: origenId,
            sucursal_destino_ids: destArr,
            producto_ids: slice,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as
          | {
              error?: string;
              resultados?: ResultItem[];
              total_creados?: number;
            }
          | Record<string, unknown>;

        if (!res.ok) {
          if ('resultados' in j && Array.isArray((j as { resultados: ResultItem[] }).resultados)) {
            const rs = (j as { resultados: ResultItem[]; error?: string }).resultados;
            setError(
              `${(j as { error?: string }).error ?? 'Error'} (falló en el lote ${lote}/${totalLotes})`,
            );
            setExito(
              rs
                .map((r) => {
                  const n = byId(r.sucursal_destino_id);
                  if (r.error) return `${n}: ${r.error}`;
                  return `${n}: +${r.total_creados ?? 0} creado(s)`;
                })
                .join(' · '),
            );
          } else {
            setError(
              `${(j as { error?: string }).error ?? 'Error al clonar'} (lote ${lote}/${totalLotes})`,
            );
          }
          return;
        }

        if (
          'resultados' in j &&
          Array.isArray((j as { resultados: ResultItem[] }).resultados) &&
          (j as { resultados: ResultItem[] }).resultados.length > 0
        ) {
          for (const r of (j as { resultados: ResultItem[] }).resultados) {
            const prev = acumMulti.get(r.sucursal_destino_id) ?? 0;
            acumMulti.set(
              r.sucursal_destino_id,
              prev + (r.total_creados ?? 0),
            );
          }
        } else {
          acumUnDest += (j as { total_creados?: number }).total_creados ?? 0;
        }
      }

      if (destArr.length > 1) {
        const total = [...acumMulti.values()].reduce((a, b) => a + b, 0);
        setExito(
          destArr
            .map(
              (id) =>
                `${byId(id)}: +${acumMulti.get(id) ?? 0} creado(s) (stock 0)`,
            )
            .join(' · ') + ` — total ${total} nuevo(s)`,
        );
      } else {
        setExito(`+${acumUnDest} producto(s) creado(s) en destino (stock 0).`);
      }
      onExito?.();
    } catch {
      setError('Error de conexión');
    } finally {
      setEnviando(false);
      setProgreso(null);
    }
  }, [elegidos, onExito, origenId, productoIds, destinosElegibles]);

  const cierre = (openNext: boolean) => {
    if (enviando) return;
    onOpenChange(openNext);
  };

  return (
    <Dialog open={open} onOpenChange={cierre}>
      <DialogContent className="max-w-lg" showCloseButton={!enviando}>
        <DialogHeader>
          <DialogTitle>Clonar a otra(s) sucursal(es)</DialogTitle>
          <DialogDescription>
            Se copian códigos, precios, unidad; el <strong>stock en destino queda en 0</strong>. No se mueve
            mercadería.
          </DialogDescription>
        </DialogHeader>

        {cargandoIds ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando lista de productos…
          </div>
        ) : null}

        {progreso && enviando ? (
          <p className="text-sm font-medium text-foreground">{progreso}</p>
        ) : null}

        {!cargandoIds && productoIds.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {productoIds.length} producto{productoIds.length === 1 ? '' : 's'} a clonar
            {truncado ? ' (límite 20.000 por operación: filtrá más o repetí con otro lote)' : null}.
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {exito ? <p className="text-sm text-green-800">{exito}</p> : null}

        {!cargandoIds && productoIds.length > 0 && !exito && destinosElegibles.length > 0 ? (
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
            <p className="text-xs font-medium text-muted-foreground">Sucursal de destino (podés marcar varias)</p>
            {destinosElegibles.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded py-1 text-sm hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={elegidos.has(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={enviando}
                />
                <span>
                  {s.nombre}
                  {s.es_principal ? ' (principal)' : ''} — {s.codigo}
                </span>
              </label>
            ))}
          </div>
        ) : !cargandoIds && productoIds.length > 0 && !exito && destinosElegibles.length === 0 ? (
          <p className="text-sm text-amber-800">No hay otra sucursal en el tenant para clonar.</p>
        ) : null}

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
              disabled={enviando || elegidos.size === 0}
              onClick={() => void confirmar()}
            >
              {enviando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Clonando…
                </>
              ) : (
                'Confirmar'
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
