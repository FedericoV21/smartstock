'use client';

import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  normalizarCantidadTramoForzado,
  normalizarTramos,
} from '@/lib/productos/precio-por-tramos';
import {
  precioUnitarioBaseParaCantidadPos,
  type ProductoPricingPos,
} from '@/lib/pos/precio-linea-pos';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

function etiquetaTramoCantidad(unidad?: string | null): string {
  const u = String(unidad ?? 'unidad').toLowerCase().trim();
  if (u === 'kg') return 'kg';
  if (u === 'gramo') return 'g';
  if (u === 'litro') return 'L';
  if (u === 'ml') return 'ml';
  if (u === 'metro') return 'm';
  if (u === 'caja') return 'cajas';
  if (u === 'pack') return 'packs';
  if (u === 'unidad' || u === 'base') return 'u.';
  return u.length > 0 && u.length <= 8 ? u : 'u.';
}

type PosGananciaTramosBadgeDetalleProps = {
  productoNombre: string;
  producto: ProductoPricingPos;
  ivaDefault: number;
  redondearPreciosCentenas: boolean;
  redondearMenores100ADecenas?: boolean;
  aumentoGananciaPct?: number;
  cantidadActual?: number;
  tramoForzadoCantidadDesde?: number | null;
  onSeleccionarTramo?: (cantidadDesde: number | null) => void;
  unidad?: string | null;
  disabled?: boolean;
  className?: string;
};

/** Badge clicable que abre el detalle de precios finales por cantidad (POS). */
export function PosGananciaTramosBadgeDetalle({
  productoNombre,
  producto,
  ivaDefault,
  redondearPreciosCentenas,
  redondearMenores100ADecenas,
  aumentoGananciaPct,
  cantidadActual = 1,
  tramoForzadoCantidadDesde,
  onSeleccionarTramo,
  unidad,
  disabled,
  className,
}: PosGananciaTramosBadgeDetalleProps) {
  const [open, setOpen] = useState(false);
  const tramos = normalizarTramos(producto.ganancia_tramos);
  const etiqueta = etiquetaTramoCantidad(unidad);
  const puedeSeleccionar = typeof onSeleccionarTramo === 'function' && !disabled;
  const tramoForzadoRaw = normalizarCantidadTramoForzado(tramoForzadoCantidadDesde);
  const tramoForzado =
    tramoForzadoRaw != null && tramos.some((t) => t.cantidad_desde === tramoForzadoRaw)
      ? tramoForzadoRaw
      : null;
  const precioAuto = precioUnitarioBaseParaCantidadPos(
    producto,
    cantidadActual,
    ivaDefault,
    redondearPreciosCentenas,
    undefined,
    redondearMenores100ADecenas,
    aumentoGananciaPct,
  );
  const precioBase = precioUnitarioBaseParaCantidadPos(
    { ...producto, ganancia_tramos: [] },
    1,
    ivaDefault,
    redondearPreciosCentenas,
    undefined,
    redondearMenores100ADecenas,
    aumentoGananciaPct,
  );
  const badgeText =
    tramoForzado != null ? `Precio desde ${tramoForzado} ${etiqueta}` : 'Precio por cantidad';

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className={cn(
          'cursor-pointer rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]/40 dark:bg-sky-950/50 dark:text-sky-200',
          className,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {badgeText}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Precio según cantidad</DialogTitle>
            <DialogDescription>
              Precio final por unidad para cada tramo de cantidad.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium leading-snug text-foreground">{productoNombre}</p>
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium text-foreground">Precio base</p>
            <p className="tabular-nums text-muted-foreground">{formatCurrency(precioBase)}</p>
          </div>
          {onSeleccionarTramo ? (
            <button
              type="button"
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                tramoForzado == null
                  ? 'border-[color:var(--brand-primary)]/45 bg-[color:var(--brand-tint)] text-foreground'
                  : 'hover:bg-muted/60',
                !puedeSeleccionar && 'cursor-not-allowed opacity-60',
              )}
              disabled={!puedeSeleccionar}
              onClick={() => {
                if (!onSeleccionarTramo) return;
                onSeleccionarTramo(null);
                setOpen(false);
              }}
            >
              <span>
                <span className="block font-medium">Automático</span>
                <span className="block text-xs text-muted-foreground">
                  Cantidad actual: {cantidadActual}
                </span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatCurrency(precioAuto)}
              </span>
            </button>
          ) : null}
          {tramos.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Tramos</p>
              <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-lg border text-sm">
                {tramos.map((t) => {
                  const precio = precioUnitarioBaseParaCantidadPos(
                    producto,
                    t.cantidad_desde,
                    ivaDefault,
                    redondearPreciosCentenas,
                    undefined,
                    redondearMenores100ADecenas,
                    aumentoGananciaPct,
                  );
                  const seleccionado = tramoForzado === t.cantidad_desde;
                  const content = (
                    <>
                      <span>
                        Desde{' '}
                        <span className="font-semibold tabular-nums text-foreground">
                          {t.cantidad_desde}
                        </span>{' '}
                        {etiqueta}
                        {seleccionado ? (
                          <span className="ml-2 rounded-full bg-[color:var(--brand-primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[color:var(--brand-primary)]">
                            En uso
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-foreground">
                        {formatCurrency(precio)}
                      </span>
                    </>
                  );

                  return (
                    <li key={t.cantidad_desde}>
                      {onSeleccionarTramo ? (
                        <button
                          type="button"
                          className={cn(
                            'flex w-full justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60',
                            seleccionado && 'bg-[color:var(--brand-tint)]',
                            !puedeSeleccionar && 'cursor-not-allowed opacity-60',
                          )}
                          disabled={!puedeSeleccionar}
                          onClick={() => {
                            if (!onSeleccionarTramo) return;
                            onSeleccionarTramo(t.cantidad_desde);
                            setOpen(false);
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex justify-between gap-3 px-3 py-2">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
