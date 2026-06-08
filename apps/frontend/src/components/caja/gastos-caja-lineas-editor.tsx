'use client';

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import { compactarGastosDesdeBorrador, nuevaLineaGasto, type GastoLineaBorrador } from '@/lib/caja/gastos-cierre';
import { formatCurrency } from '@/lib/utils/formatters';

export type { GastoLineaBorrador };

type Props = {
  lineas: GastoLineaBorrador[];
  onChange: (next: GastoLineaBorrador[]) => void;
  titulo?: string;
  descripcion?: string;
};

export function GastosCajaLineasEditor({
  lineas,
  onChange,
  titulo = 'Gastos sacados de caja (opcional)',
  descripcion = 'Agregá una fila por cada egreso: monto y en qué se gastó.',
}: Props) {
  function actualizar(id: string, patch: Partial<GastoLineaBorrador>) {
    onChange(lineas.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function quitar(id: string) {
    onChange(lineas.filter((r) => r.id !== id));
  }

  const compact = compactarGastosDesdeBorrador(lineas);
  const totalOk = compact.ok ? compact.total : 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p className="text-xs text-muted-foreground">{descripcion}</p>
      </div>

      <ul className="space-y-2" aria-label="Listado de gastos">
        {lineas.map((row) => (
          <li key={row.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/20 p-2">
            <label className="grid min-w-[6rem] flex-1 gap-1 text-xs">
              <span className="text-muted-foreground">Monto</span>
              <MontoInput
                placeholder="0"
                className="h-9"
                value={row.monto}
                onValueChange={(m) => actualizar(row.id, { monto: m })}
                min={0}
                decimals={2}
              />
            </label>
            <label className="grid min-w-0 flex-[2] gap-1 text-xs">
              <span className="text-muted-foreground">Concepto</span>
              <Input
                placeholder="Ej.: delivery, cambio, etc."
                value={row.concepto}
                onChange={(e) => actualizar(row.id, { concepto: e.target.value })}
                maxLength={200}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
              onClick={() => quitar(row.id)}
              aria-label="Quitar gasto"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="cursor-pointer gap-1.5"
        onClick={() => onChange([...lineas, nuevaLineaGasto()])}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Agregar gasto
      </Button>

      {compact.ok && totalOk > 0 ? (
        <p className="text-sm tabular-nums text-muted-foreground">
          Total gastos: <span className="font-semibold text-foreground">{formatCurrency(totalOk)}</span>
        </p>
      ) : null}
      {!compact.ok ? <p className="text-xs text-destructive">{compact.error}</p> : null}
    </div>
  );
}
