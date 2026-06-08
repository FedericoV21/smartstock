'use client';

import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';
import {
  MAX_VENTAS_EN_ESPERA,
  type VentaEnEsperaSlice,
} from '@/lib/pos/ventas-en-espera';

interface Props {
  slices: VentaEnEsperaSlice[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onRenameLabel: (id: string, label: string) => void;
  /** Si está bloqueado por modal/cobro digital, se deshabilita la barra. */
  disabled?: boolean;
}

function nombreFallback(slice: VentaEnEsperaSlice, idx: number): string {
  if (slice.label && slice.label.trim()) return slice.label.trim();
  return `Venta ${idx + 1}`;
}

function buildTabLabel(slice: VentaEnEsperaSlice, idx: number): string {
  const base = nombreFallback(slice, idx);
  if (slice.itemCount > 0) return base;
  return `${base} · vacía`;
}

export function VentasEnEsperaTabs({
  slices,
  activeId,
  onSelect,
  onCreate,
  onClose,
  onRenameLabel,
  disabled,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Si no hay ninguna pestaña en espera (solo una activa vacía), no mostramos la barra
  // para no agregar ruido visual cuando el cajero no está usando la feature.
  const hayAlMenosUnaEnEspera = slices.length > 1;
  if (!hayAlMenosUnaEnEspera) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--brand-soft)] bg-background/60 px-3 py-1.5 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 cursor-pointer gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={onCreate}
          disabled={disabled || slices.length >= MAX_VENTAS_EN_ESPERA}
          title="Nueva venta paralela (Alt+N)"
        >
          <Plus className="size-3.5" aria-hidden />
          Nueva venta en espera
        </Button>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          Atajos: <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">Alt+N</kbd> nueva ·
          <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">Alt+1..{MAX_VENTAS_EN_ESPERA}</kbd> saltar
        </span>
      </div>
    );
  }

  const canCreate = slices.length < MAX_VENTAS_EN_ESPERA && !disabled;

  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[color:var(--brand-soft)] bg-background/60 px-2 py-1.5 sm:px-3"
      role="tablist"
      aria-label="Ventas en espera"
    >
      {slices.map((slice, idx) => {
        const isActive = slice.id === activeId;
        const isEditing = editingId === slice.id;
        const tabLabel = buildTabLabel(slice, idx);
        const altHint = idx < 9 ? `Alt+${idx + 1}` : null;
        return (
          <div
            key={slice.id}
            role="tab"
            aria-selected={isActive}
            aria-label={`${tabLabel}${slice.itemCount > 0 ? `, total ${formatCurrency(slice.total)}` : ''}${altHint ? `, atajo ${altHint}` : ''}`}
            className={cn(
              'group flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2 py-1 text-xs font-medium transition-colors min-h-9',
              isActive
                ? 'border-[color:var(--brand-soft)] bg-[color:var(--brand-tint)] text-[color:var(--brand-primary)]'
                : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted',
              disabled && 'opacity-60',
            )}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value.slice(0, 24))}
                onBlur={() => {
                  onRenameLabel(slice.id, editingValue);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onRenameLabel(slice.id, editingValue);
                    setEditingId(null);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                placeholder="Etiqueta"
                className="h-6 w-32 rounded border border-input bg-background px-2 py-0 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-[color:var(--brand-accent)]"
                aria-label={`Etiqueta de ${tabLabel}`}
              />
            ) : (
              <>
                <button
                  type="button"
                  className={cn(
                    'inline-flex max-w-[10rem] items-center gap-1.5 truncate px-1 py-0.5',
                    'rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-accent)]',
                  )}
                  onClick={() => onSelect(slice.id)}
                  disabled={disabled || isActive}
                  title={altHint ? `${tabLabel} (${altHint})` : tabLabel}
                >
                  <span className="truncate">{nombreFallback(slice, idx)}</span>
                  {slice.itemCount > 0 ? (
                    <span className="tabular-nums opacity-80">· {formatCurrency(slice.total)}</span>
                  ) : (
                    <span className="text-[10px] opacity-70">· vacía</span>
                  )}
                  {slice.cobroDigitalEnCurso ? (
                    <span
                      className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-amber-500"
                      aria-label="Cobro digital en curso"
                      title="Cobro digital en curso"
                    />
                  ) : null}
                </button>

                <button
                  type="button"
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70',
                    'opacity-0 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-accent)]',
                    'group-hover:opacity-100 hover:bg-muted hover:text-foreground',
                    isActive && 'opacity-100',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(slice.id);
                    setEditingValue(slice.label ?? '');
                  }}
                  aria-label={`Renombrar ${tabLabel}`}
                  title="Renombrar pestaña"
                  disabled={disabled}
                >
                  <Pencil className="size-3" aria-hidden />
                </button>

                <button
                  type="button"
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70',
                    'opacity-0 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-accent)]',
                    'group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-600',
                    isActive && slices.length > 1 && 'opacity-100',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(slice.id);
                  }}
                  aria-label={`Cerrar ${tabLabel}`}
                  title="Cerrar pestaña (Alt+W)"
                  disabled={disabled || slice.cobroDigitalEnCurso !== null}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className={cn(
          'ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-dashed border-[color:var(--brand-soft)] px-2 text-xs font-medium text-muted-foreground',
          'hover:bg-[color:var(--brand-tint)] hover:text-[color:var(--brand-primary)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-accent)]',
          !canCreate && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
        )}
        onClick={onCreate}
        disabled={!canCreate}
        title={
          canCreate
            ? 'Nueva venta paralela (Alt+N)'
            : `Tope alcanzado (${MAX_VENTAS_EN_ESPERA} ventas en espera)`
        }
        aria-label="Nueva venta paralela"
      >
        <Plus className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Nueva</span>
      </button>

      <span className="ml-auto hidden shrink-0 pr-2 text-[11px] text-muted-foreground md:inline">
        <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">Alt+N</kbd> nueva ·
        <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">Alt+1..{MAX_VENTAS_EN_ESPERA}</kbd> saltar ·
        <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">Alt+W</kbd> cerrar
      </span>
    </div>
  );
}
