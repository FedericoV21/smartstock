'use client';

import { FileText, Package, TrendingUp, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

type Metricas = {
  productos_activos: number;
  valor_inventario: number;
  comprobantes_mes: number;
  ventas_mes: number;
  periodo: { desde: string; hasta: string };
};

function MetricCard({
  title,
  value,
  icon: Icon,
  className,
}: {
  title: string;
  value: string;
  icon: typeof Package;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-t-[3px] border-t-[color:var(--brand-primary)] bg-card p-5 shadow-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Icon
          className="h-5 w-5 shrink-0 text-[color:var(--brand-accent)]"
          aria-hidden
        />
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

export function DashboardMetricas() {
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/dashboard/metricas');
      const json = (await res.json()) as Metricas & { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudieron cargar las métricas');
        return;
      }
      setMetricas(json);
    }
    void load();
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!metricas) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MetricCard
        title="Productos activos"
        value={String(metricas.productos_activos)}
        icon={Package}
      />
      <MetricCard
        title="Valor del inventario"
        value={formatCurrency(metricas.valor_inventario)}
        icon={Warehouse}
      />
      <MetricCard
        title="Comprobantes emitidos (mes)"
        value={String(metricas.comprobantes_mes)}
        icon={FileText}
      />
      <MetricCard
        title="Ventas del mes"
        value={formatCurrency(metricas.ventas_mes)}
        icon={TrendingUp}
      />
    </div>
  );
}
