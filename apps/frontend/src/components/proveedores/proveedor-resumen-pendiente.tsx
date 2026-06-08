'use client';

import { describirSaldoCuentaCorriente, type DescripcionSaldoCuentaCorriente } from '@/lib/cuenta-corriente/saldo';
import { cn } from '@/lib/utils';

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

function etiquetaPendiente(info: DescripcionSaldoCuentaCorriente): string {
  if (info.estado === 'deuda') return 'Pendiente de pago al proveedor';
  if (info.estado === 'saldo_a_favor') return 'Saldo a favor (crédito con el proveedor)';
  return 'Sin saldo pendiente';
}

export function ProveedorResumenPendiente({
  saldo,
  className,
}: {
  saldo: number;
  className?: string;
}) {
  const info = describirSaldoCuentaCorriente(saldo, 'proveedor');

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        info.estado === 'deuda'
          ? 'border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/25'
          : info.estado === 'saldo_a_favor'
            ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/50 dark:bg-emerald-950/25'
            : 'border-border bg-muted/40',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resumen</p>
          <p className="mt-0.5 font-semibold text-foreground">{etiquetaPendiente(info)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{info.descripcion}</p>
        </div>
        <p
          className={cn(
            'text-2xl font-bold tabular-nums',
            info.estado === 'deuda'
              ? 'text-red-600 dark:text-red-400'
              : info.estado === 'saldo_a_favor'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-foreground',
          )}
        >
          {money(info.monto)}
        </p>
      </div>
    </div>
  );
}
