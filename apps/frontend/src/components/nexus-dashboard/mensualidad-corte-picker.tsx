'use client';

import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const WEEKDAYS_MON = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function diasEnMes(anio: number, mes: number) {
  return new Date(anio, mes + 1, 0).getDate();
}

/** Celdas del mes: null = vacío, número = día del mes. */
function gridMes(anio: number, mes: number): (number | null)[] {
  const first = new Date(anio, mes, 1);
  const startPad = (first.getDay() + 6) % 7;
  const dim = diasEnMes(anio, mes);
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  return cells;
}

function tituloMes(anio: number, mes: number) {
  try {
    const s = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(
      new Date(anio, mes, 1)
    );
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return `${mes + 1}/${anio}`;
  }
}

type Props = {
  value: number | null;
  busy: boolean;
  proximoCorteLabel: string | null;
  formatSoloFecha: (iso: string) => string;
  onChange: (dia: number | null) => void;
};

export function MensualidadCortePicker({
  value,
  busy,
  proximoCorteLabel,
  formatSoloFecha,
  onChange,
}: Props) {
  const now = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(now.getFullYear());
  const [viewM, setViewM] = useState(now.getMonth());

  const cells = useMemo(() => gridMes(viewY, viewM), [viewY, viewM]);

  function prevMonth() {
    setViewM((m) => {
      if (m <= 0) {
        setViewY((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }

  function nextMonth() {
    setViewM((m) => {
      if (m >= 11) {
        setViewY((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }

  function pickDay(d: number) {
    if (d < 1 || d > 28) return;
    onChange(d);
    setOpen(false);
  }

  function clearDay() {
    onChange(null);
    setOpen(false);
  }

  const triggerLabel =
    value != null ? `Día ${value} del mes` : 'Elegir día en calendario';

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          className="h-auto min-h-8 w-full max-w-[10rem] justify-start gap-1.5 border-slate-600 bg-slate-950 py-1 text-left text-slate-100 transition-colors hover:bg-slate-800/40 hover:text-slate-50"
          onClick={() => setOpen(true)}
        >
          <CalendarDays className="size-3.5 shrink-0 text-sky-400" aria-hidden />
          <span className="line-clamp-2 text-xs font-medium leading-snug">{triggerLabel}</span>
        </Button>
        {proximoCorteLabel ? (
          <span className="text-xs leading-snug text-sky-300">
            Próximo corte: {formatSoloFecha(proximoCorteLabel)}
          </span>
        ) : (
          <span className="text-xs text-slate-500">Marcador sin día</span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="max-w-[min(100%,22rem)] border-slate-700 bg-slate-900 p-4 text-slate-100 ring-slate-700"
        >
        <DialogHeader>
          <DialogTitle className="text-slate-100">Ciclo de mensualidad</DialogTitle>
          <DialogDescription className="text-slate-400">
            Elegí el día del mes en que corta el ciclo (solo hasta el 28 para todos los meses).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="border-slate-600 bg-slate-950 text-slate-100 transition-colors hover:bg-slate-800/40"
              onClick={prevMonth}
              aria-label="Mes anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-center text-sm font-medium capitalize">
              {tituloMes(viewY, viewM)}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="border-slate-600 bg-slate-950 text-slate-100 transition-colors hover:bg-slate-800/40"
              onClick={nextMonth}
              aria-label="Mes siguiente"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[0.65rem] font-medium text-slate-500">
            {WEEKDAYS_MON.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d === null) {
                return <div key={`${viewY}-${viewM}-e-${i}`} className="aspect-square" />;
              }
              const allowed = d <= 28;
              const selected = value === d;
              return (
                <button
                  key={`${viewY}-${viewM}-${d}`}
                  type="button"
                  disabled={!allowed}
                  onClick={() => allowed && pickDay(d)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-md text-xs font-medium transition-colors',
                    !allowed && 'cursor-not-allowed text-slate-600 line-through opacity-40',
                    allowed &&
                      !selected &&
                      'text-slate-200 transition-colors hover:bg-white/[0.08]',
                    selected && 'bg-sky-600 text-white shadow-sm'
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter className="border-slate-800 bg-slate-900/80 sm:justify-between">
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                className="text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
              />
            }
          >
            Cancelar
          </DialogClose>
          <Button
            type="button"
            variant="outline"
            className="border-slate-600 bg-slate-950 text-slate-100 transition-colors hover:bg-slate-800/45"
            onClick={clearDay}
          >
            Sin día fijo
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  );
}
