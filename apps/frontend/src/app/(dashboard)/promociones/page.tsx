'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatFechaArgDesdeApi } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';
import type { PromocionTipo } from '@/types/promociones';
import { PROMOCION_TIPO_LABELS } from '@/types/promociones';

type PromoRow = {
  id: string;
  nombre: string;
  tipo: PromocionTipo;
  activa: boolean;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  productos_count: number;
  sucursales?: { id: string; codigo?: string | null; nombre?: string | null }[];
  sucursales_count?: number;
  updated_at: string;
};

const TIPOS_FILTRO: Array<PromocionTipo | 'todas'> = [
  'todas',
  'porcentaje_off',
  'n_x_m',
  'porcentaje_unidad_n',
  'descuento_volumen',
  'combo_precio_fijo',
];

export default function PromocionesPage() {
  const { puedeEditarPromociones } = useDashboardRole();
  const canEdit = puedeEditarPromociones;
  const [promociones, setPromociones] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroActiva, setFiltroActiva] = useState<'todas' | 'true' | 'false'>('todas');
  const [filtroTipo, setFiltroTipo] = useState<PromocionTipo | 'todas'>('todas');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filtroActiva !== 'todas') params.set('activa', filtroActiva);
    if (filtroTipo !== 'todas') params.set('tipo', filtroTipo);
    const res = await fetch(`/api/promociones${params.toString() ? `?${params}` : ''}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      setPromociones([]);
    } else {
      setError(null);
      setPromociones(json.promociones ?? []);
    }
    setLoading(false);
  }, [filtroActiva, filtroTipo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActiva(row: PromoRow, activa: boolean) {
    const res = await fetch(`/api/promociones/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activa }),
    });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? 'No se pudo actualizar');
      return;
    }
    setError(null);
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Promociones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Descuentos por producto en facturación y pedidos. Cada producto puede tener una sola promoción
            vigente.
          </p>
        </div>
        {canEdit ? (
          <Link href="/promociones/nueva" className={cn(buttonVariants())}>
            Nueva promoción
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Estado</span>
          <Select
            value={filtroActiva}
            onValueChange={(v) => v && setFiltroActiva(v as typeof filtroActiva)}
          >
            <SelectTrigger className="w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="true">Activas</SelectItem>
              <SelectItem value="false">Inactivas</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Tipo</span>
          <Select
            value={filtroTipo}
            onValueChange={(v) => v && setFiltroTipo(v as typeof filtroTipo)}
          >
            <SelectTrigger className="w-[12rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_FILTRO.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === 'todas' ? 'Todos' : PROMOCION_TIPO_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-xl border bg-card shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : promociones.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No hay promociones con estos filtros.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Productos</TableHead>
                <TableHead>Sucursales</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead className="w-28">Estado</TableHead>
                {canEdit ? <TableHead className="w-44 text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {promociones.map((p) => (
                <TableRow
                  key={p.id}
                  className={cn(
                    'border-l-4 transition-colors',
                    p.activa
                      ? 'border-l-emerald-500 bg-emerald-500/[0.06]'
                      : 'border-l-muted-foreground/25 bg-muted/15',
                  )}
                >
                  <TableCell className="font-medium">
                    <Link href={`/promociones/${p.id}`} className="hover:underline">
                      {p.nombre}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {PROMOCION_TIPO_LABELS[p.tipo]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.productos_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(p.sucursales_count ?? p.sucursales?.length ?? 0) === 0
                      ? 'Sin sucursales'
                      : (p.sucursales ?? [])
                          .slice(0, 2)
                          .map((s) => s.nombre ?? s.codigo ?? 'Sucursal')
                          .join(', ') +
                        ((p.sucursales_count ?? p.sucursales?.length ?? 0) > 2
                          ? ` +${(p.sucursales_count ?? p.sucursales?.length ?? 0) - 2}`
                          : '')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {p.vigente_desde == null && p.vigente_hasta == null
                      ? 'Sin tope'
                      : `${formatFechaArgDesdeApi(p.vigente_desde)} → ${formatFechaArgDesdeApi(p.vigente_hasta)}`}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        p.activa
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {p.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={`/promociones/${p.id}/editar`}
                          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                        >
                          Editar
                        </Link>
                        <label
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                            p.activa
                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
                              : 'border-border bg-background text-muted-foreground',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={p.activa}
                            onChange={(e) => void toggleActiva(p, e.target.checked)}
                            className="size-4 rounded border-input"
                            aria-label={
                              p.activa
                                ? 'Desactivar promoción en el catálogo'
                                : 'Activar promoción en el catálogo'
                            }
                          />
                          <span className="select-none">{p.activa ? 'Activa en catálogo' : 'Inactiva'}</span>
                        </label>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
