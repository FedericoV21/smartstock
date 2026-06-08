'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  celdasCalendarioMes,
  DIAS_CORTOS_ES,
  displayFechaToIso,
  isoDesdePartes,
  isoFechaToDisplay,
  MESES_ES,
  parseIsoFecha,
} from '@/lib/ui/fecha-argentina';
import { hoyEnAR } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';

export type FechaInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'type' | 'value' | 'onChange' | 'defaultValue'
> & {
  /** Fecha calendario ISO `YYYY-MM-DD` o vacío. */
  value: string;
  onValueChange: (iso: string) => void;
};

export function FechaInput({
  value,
  onValueChange,
  className,
  disabled,
  placeholder = 'dd/mm/aaaa',
  ...rest
}: FechaInputProps) {
  const [text, setText] = useState(() => (value ? isoFechaToDisplay(value) : ''));
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  const hoy = hoyEnAR();
  const parsedValue = parseIsoFecha(value);
  const [viewYear, setViewYear] = useState(parsedValue?.y ?? Number(hoy.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(parsedValue?.m ?? Number(hoy.slice(5, 7)));

  useEffect(() => {
    if (focused) return;
    setText(value ? isoFechaToDisplay(value) : '');
  }, [value, focused]);

  useEffect(() => {
    if (!open) return;
    const p = parseIsoFecha(value);
    if (p) {
      setViewYear(p.y);
      setViewMonth(p.m);
    } else {
      setViewYear(Number(hoy.slice(0, 4)));
      setViewMonth(Number(hoy.slice(5, 7)));
    }
  }, [open, value, hoy]);

  const cells = useMemo(() => celdasCalendarioMes(viewYear, viewMonth), [viewYear, viewMonth]);

  function commitText(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      onValueChange('');
      setText('');
      return;
    }
    const iso = displayFechaToIso(trimmed);
    if (!iso) return;
    onValueChange(iso);
    setText(isoFechaToDisplay(iso));
  }

  function selectDay(day: number) {
    const iso = isoDesdePartes(viewYear, viewMonth, day);
    onValueChange(iso);
    setText(isoFechaToDisplay(iso));
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const selectedParts = parsedValue;

  return (
    <div className="relative flex gap-1">
      <Input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        className={cn('pr-9', className)}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          commitText(e.target.value);
          rest.onBlur?.(e);
        }}
        onChange={(e) => setText(e.target.value)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label="Abrir calendario"
        >
          <CalendarDays className="h-4 w-4" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverPositioner align="end">
            <PopoverPopup className="w-[17rem] p-2">
              <div className="mb-2 flex items-center justify-between gap-1">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
                  onClick={prevMonth}
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium capitalize">
                  {MESES_ES[viewMonth - 1]} {viewYear}
                </span>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
                  onClick={nextMonth}
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[0.65rem] font-medium text-muted-foreground">
                {DIAS_CORTOS_ES.map((d) => (
                  <span key={d} className="py-0.5">
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((day, idx) =>
                  day == null ? (
                    <span key={`empty-${idx}`} />
                  ) : (
                    <button
                      key={`${viewYear}-${viewMonth}-${day}`}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={cn(
                        'h-8 rounded-md text-sm tabular-nums hover:bg-muted',
                        selectedParts?.y === viewYear &&
                          selectedParts?.m === viewMonth &&
                          selectedParts?.d === day &&
                          'bg-primary text-primary-foreground hover:bg-primary/90',
                      )}
                    >
                      {day}
                    </button>
                  ),
                )}
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </div>
  );
}
