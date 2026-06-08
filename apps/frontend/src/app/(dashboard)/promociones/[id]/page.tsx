'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  etiquetaDiaPromocion,
  ordenDiasSemanaPromocion,
  textoDiasHabilesPromocion,
} from '@/lib/promociones/dias-semana-ui';
import { formatCurrency, formatDateTime, formatFechaArgDesdeApi } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';
import type { PromocionTipo } from '@/types/promociones';
import { PROMOCION_TIPO_LABELS } from '@/types/promociones';

type ProductoEmbed = {
  id: string;
  nombre: string;
  precio_venta: number;
  proveedor: { nombre: string } | null;
};

type Vinculo = {
  producto_id: string;
  producto: ProductoEmbed | null;
};

type VentaRow = {
  id: string;
  cantidad: number;
  descuento_promo_monto: number | null;
  promocion_descripcion: string | null;
  created_at: string;
  producto_id: string;
  comprobante: { id: string; numero: string | null; fecha: string | null; tipo: string } | null;
};

type RangoVol = { cantidad_desde: number; cantidad_hasta: number | null; porcentaje: number };

type PromoDetail = {
  id: string;
  nombre: string;
  tipo: PromocionTipo;
  activa: boolean;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
  cantidad_lleva: number | null;
  cantidad_paga: number | null;
  unidad_descuento: number | null;
  porcentaje: number | null;
  cantidad_minima: number | null;
  rangos_volumen: RangoVol[] | null;
  precio_combo: number | null;
  sucursales?: { id: string; codigo?: string | null; nombre?: string | null }[];
  producto_promocion: Vinculo[];
  promocion_combo_item?: {
    producto_id: string;
    cantidad: number;
    producto: { nombre: string; codigo: string } | null;
  }[];
  ultimas_ventas: VentaRow[];
};

function descripcionReglas(p: PromoDetail): string {
  switch (p.tipo) {
    case 'porcentaje_off':
      return `${p.porcentaje ?? 0}% de descuento`;
    case 'n_x_m':
      return `Lleva ${p.cantidad_lleva ?? '—'}, paga ${p.cantidad_paga ?? '—'}`;
    case 'porcentaje_unidad_n': {
      const u = p.unidad_descuento;
      const pct = p.porcentaje ?? 0;
      const seq =
        u === 2
          ? `2ª, 4ª, 6ª…`
          : u != null && u >= 2
            ? `${u}ª, ${2 * u}ª…`
            : '—';
      return `${pct}% en las posiciones ${seq}`;
    }
    case 'descuento_volumen':
      if (p.rangos_volumen != null && p.rangos_volumen.length > 0) {
        return `Por volumen (${p.rangos_volumen.length} tramos)`;
      }
      return `${p.porcentaje ?? 0}% desde ${p.cantidad_minima ?? '—'} unidades`;
    case 'combo_precio_fijo':
      return `${formatCurrency(Number(p.precio_combo ?? 0))} por paquete`;
    default:
      return '';
  }
}

export default function PromocionDetallePage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : '';
  const { puedeEditarPromociones } = useDashboardRole();
  const canEdit = puedeEditarPromociones;
  const [data, setData] = useState<PromoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/promociones/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error');
      setData(null);
    } else {
      setError(null);
      setData(json as PromoDetail);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActiva(activa: boolean) {
    if (!id) return;
    const res = await fetch(`/api/promociones/${id}`, {
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
    router.refresh();
  }

  if (!id) {
    return <p className="text-sm text-muted-foreground">ID inválido</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{error ?? 'No encontrada'}</p>
        <Link href="/promociones" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          ← Listado
        </Link>
      </div>
    );
  }

  const diasOrdenados = ordenDiasSemanaPromocion(data.dias_semana);
  const diasLeyenda = textoDiasHabilesPromocion(data.dias_semana);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link href="/promociones" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            ← Lista
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{data.nombre}</h1>
            <p className="text-sm text-muted-foreground">
              {PROMOCION_TIPO_LABELS[data.tipo]} · {descripcionReglas(data)}
            </p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void toggleActiva(!data.activa)}
            >
              {data.activa ? 'Desactivar' : 'Activar'}
            </Button>
            <Link href={`/promociones/${id}/editar`} className="shrink-0">
              <Button type="button" size="sm">
                Editar
              </Button>
            </Link>
          </div>
        ) : null}
      </div>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Condiciones</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Estado</dt>
            <dd className="mt-0.5">
              <span
                className={
                  data.activa
                    ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                    : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                }
              >
                {data.activa ? 'Activa' : 'Inactiva'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Vigencia</dt>
            <dd className="mt-0.5">
              {data.vigente_desde == null && data.vigente_hasta == null
                ? 'Sin tope de fechas'
                : `${formatFechaArgDesdeApi(data.vigente_desde)} → ${formatFechaArgDesdeApi(data.vigente_hasta)}`}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Sucursales donde aplica</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {(data.sucursales ?? []).length === 0 ? (
                <span>Sin sucursales asignadas</span>
              ) : (
                (data.sucursales ?? []).map((s) => (
                  <span
                    key={s.id}
                    className="rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {s.nombre ?? s.codigo ?? 'Sucursal'}
                  </span>
                ))
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Días en que aplica</dt>
            <dd className="mt-0.5 space-y-2">
              <p className="text-foreground">{diasLeyenda}</p>
              {diasOrdenados.length > 0 && diasOrdenados.length < 7 ? (
                <div className="flex flex-wrap gap-1.5" aria-label="Días habilitados">
                  {diasOrdenados.map((n) => (
                    <span
                      key={n}
                      className="rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-foreground"
                    >
                      {etiquetaDiaPromocion(n)}
                    </span>
                  ))}
                </div>
              ) : null}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 font-medium">Productos</h2>
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">P. venta</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.producto_promocion.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Sin productos vinculados
                  </TableCell>
                </TableRow>
              ) : (
                data.producto_promocion.map((row) => {
                  const pr = row.producto;
                  return (
                    <TableRow key={row.producto_id}>
                      <TableCell className="font-medium">
                        {pr ? (
                          <Link href={`/productos/${pr.id}`} className="hover:underline">
                            {pr.nombre}
                          </Link>
                        ) : (
                          row.producto_id
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {pr?.proveedor?.nombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pr ? formatCurrency(pr.precio_venta) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {pr ? (
                          <Link
                            href={`/productos/${pr.id}`}
                            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                          >
                            Ficha
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium">Últimas líneas con esta promo</h2>
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Comprobante</TableHead>
                <TableHead className="text-right">Cant.</TableHead>
                <TableHead className="text-right">Dto. promo</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ultimas_ventas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Sin ventas registradas con esta promoción
                  </TableCell>
                </TableRow>
              ) : (
                data.ultimas_ventas.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {v.created_at ? formatDateTime(v.created_at) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {v.comprobante
                        ? `${v.comprobante.tipo} ${v.comprobante.numero ?? v.comprobante.id.slice(0, 8)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{v.cantidad}</TableCell>
                    <TableCell className="text-right text-sm">
                      {v.descuento_promo_monto != null ? formatCurrency(v.descuento_promo_monto) : '—'}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">
                      {v.promocion_descripcion ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
