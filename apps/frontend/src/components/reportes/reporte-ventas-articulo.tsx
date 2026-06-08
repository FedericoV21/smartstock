'use client';

import Link from 'next/link';
import { Download, Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { nombrePdfReporte, descargarPdfTabla } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

type EstadoVenc = 'sin_fecha' | 'vencido' | 'critico' | 'proximo' | 'ok';

type Fila = {
  producto_id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  proveedor: string | null;
  unidades: number;
  unidades_compradas: number;
  importe_venta: number;
  costo_total: number;
  margen: number;
  margen_pct: number | null;
  participacion_pct: number;
  tickets: number;
  stock_actual: number;
  stock_minimo: number;
  quiebre: boolean;
  fecha_vencimiento: string | null;
  dias_hasta_vencimiento: number | null;
  estado_vencimiento: EstadoVenc;
  ultima_entrada: {
    fecha: string;
    cantidad: number;
    motivo: string | null;
    referencia_tipo: string | null;
  } | null;
};

type ApiResponse = {
  periodo: { key: Periodo; desde: string; hasta: string };
  filtros: {
    categoria_id: string | null;
    proveedor_id: string | null;
    producto_id: string | null;
    limit: number;
  };
  indicadores: {
    articulos_distintos: number;
    total_unidades: number;
    total_unidades_compradas?: number;
    total_importe_venta: number;
    total_costo: number;
    margen_total: number;
  };
  nota?: string;
  filas: Fila[];
  error?: string;
};

function badgeVenc(e: EstadoVenc): { label: string; className: string } {
  switch (e) {
    case 'vencido':
      return { label: 'Vencido', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' };
    case 'critico':
      return {
        label: '≤7 días',
        className: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
      };
    case 'proximo':
      return {
        label: '≤30 días',
        className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
      };
    case 'ok':
      return { label: 'OK', className: 'bg-muted text-muted-foreground' };
    default:
      return { label: '—', className: 'bg-muted text-muted-foreground' };
  }
}

export function ReporteVentasArticulo() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    async function loadOpts() {
      const [cRes, pRes] = await Promise.all([
        fetch('/api/categorias'),
        fetch('/api/proveedores?estado=todos'),
      ]);
      const cJson = (await cRes.json()) as { categorias?: { id: string; nombre: string }[] };
      const pJson = (await pRes.json()) as { proveedores?: { id: string; nombre: string }[] };
      if (cRes.ok && Array.isArray(cJson.categorias)) {
        setCategorias(cJson.categorias.map((x) => ({ id: x.id, nombre: x.nombre })));
      }
      if (pRes.ok && Array.isArray(pJson.proveedores)) {
        setProveedores(pJson.proveedores.map((x) => ({ id: x.id, nombre: x.nombre })));
      }
    }
    void loadOpts();
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ periodo, limit: String(limit) });
    if (periodo === 'rango') {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    if (categoriaId) p.set('categoria_id', categoriaId);
    if (proveedorId) p.set('proveedor_id', proveedorId);
    aplicarASearchParams(p);
    return p.toString();
  }, [periodo, desde, hasta, categoriaId, proveedorId, limit, aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/ventas-articulo?${qs}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar ventas por artículo');
        setData(null);
      } else {
        setData(json);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [qs, hidrato]);

  const csvHref = `/api/reportes/ventas-articulo?${qs}&export=csv`;

  function generarPdf() {
    if (!data) return;
    const p = data.periodo;
    const vb = (e: EstadoVenc) => badgeVenc(e).label;
    const filas = data.filas.map((r) => {
      const ue = r.ultima_entrada
        ? `${formatDateTime(r.ultima_entrada.fecha)} +${r.ultima_entrada.cantidad}`
        : '—';
      return [
        r.codigo,
        r.nombre.length > 42 ? `${r.nombre.slice(0, 40)}…` : r.nombre,
        String(r.unidades),
        String(r.unidades_compradas ?? 0),
        formatCurrency(r.importe_venta),
        formatCurrency(r.margen),
        `${r.stock_actual} / ${r.stock_minimo}${r.quiebre ? ' (!)' : ''}`,
        r.fecha_vencimiento ? `${formatDate(r.fecha_vencimiento)} (${vb(r.estado_vencimiento)})` : '—',
        ue,
      ];
    });
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte('ventas-por-articulo'),
      titulo: 'Ventas por artículo (SKU)',
      lineasMeta: [
        `Período: ${formatDate(p.desde)} → ${formatDate(p.hasta)}`,
        `Artículos: ${data.indicadores.articulos_distintos} · Vendidas: ${data.indicadores.total_unidades} · Compradas: ${data.indicadores.total_unidades_compradas ?? 0} · Venta: ${formatCurrency(data.indicadores.total_importe_venta)} · Margen: ${formatCurrency(data.indicadores.margen_total)}`,
      ],
      notaLegal: data.nota ? [data.nota] : undefined,
      encabezados: ['Código', 'Producto', 'Vend.', 'Comp.', 'Venta', 'Margen', 'Act./mín.', 'Venc.', 'Últ.entr.'],
      anchosMm: [18, 40, 11, 11, 20, 20, 17, 19, 22],
      filas,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Ventas por artículo (SKU)</h2>
            <ReporteInfoDialog title="Ventas por artículo (SKU)">
              <p>
                Muestra unidades e importe vendido por producto según lo cobrado en cada comprobante. Promos,
                descuentos y ajustes por medio de pago se prorratean al total del ticket o factura; las notas de
                crédito restan.
              </p>
              <p>
                Incluye stock actual, alerta de quiebre, vencimiento del producto y última entrada de stock.
              </p>
              <p>
                Vendidas = unidades en comprobantes de venta del período, neto de notas de crédito. Compradas = suma
                de entradas con referencia factura, pedido o importación; no incluye cargas manuales ni ajustes de
                inventario.
              </p>
              <p>
                Stock muestra unidades actuales / stock mínimo definido en el producto. Si el actual es menor o igual
                al mínimo, se marca como stock bajo.
              </p>
            </ReporteInfoDialog>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={csvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Exportar CSV
          </a>
          <BotonDescargarPdf disabled={!data || loading} onGenerar={generarPdf} />
        </div>
      </div>

      {data?.nota ? (
        <ReporteInfoDialog title="Nota del reporte" buttonLabel="Nota del reporte">
          <p>{data.nota}</p>
        </ReporteInfoDialog>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['hoy', 'Hoy'],
            ['semana', 'Semana'],
            ['mes', 'Mes'],
            ['rango', 'Rango'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={cn(
              buttonVariants({ variant: periodo === key ? 'default' : 'outline', size: 'sm' }),
            )}
            onClick={() => setPeriodo(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {periodo === 'rango' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Categoría</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Proveedor</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Todos</option>
            {proveedores.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Máx. productos</label>
          <Input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 200)))}
            className="h-9"
          />
        </div>
      </div>

      {mostrarSelector ? (
        <div className="flex flex-wrap gap-3">
          <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {data && !loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Artículos con venta</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.indicadores.articulos_distintos}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Uds. vendidas (neto)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.indicadores.total_unidades}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Uds. compradas (mismo período)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {data.indicadores.total_unidades_compradas ?? 0}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Entradas por factura, pedido o importación
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Importe venta (neto)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.indicadores.total_importe_venta)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Margen bruto (estim.)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.indicadores.margen_total)}
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artículo</TableHead>
              <TableHead className="text-right">
                <span className="block leading-tight">Vendidas</span>
                <span className="mt-0.5 block text-[10px] font-normal normal-case text-muted-foreground">
                  neto período
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="block leading-tight">Compradas</span>
                <span className="mt-0.5 block text-[10px] font-normal normal-case text-muted-foreground">
                  fact. / ped. / imp.
                </span>
              </TableHead>
              <TableHead className="text-right">Venta</TableHead>
              <TableHead className="text-right">Margen</TableHead>
              <TableHead className="text-right">% part.</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right">
                <span className="block leading-tight">Stock</span>
                <span className="mt-0.5 block text-[10px] font-normal normal-case text-muted-foreground">
                  actual / mínimo
                </span>
              </TableHead>
              <TableHead>Venc.</TableHead>
              <TableHead>Última entrada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data || loading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : data.filas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  No hay ventas en el período con los filtros elegidos.
                </TableCell>
              </TableRow>
            ) : (
              data.filas.map((row) => {
                const vb = badgeVenc(row.estado_vencimiento);
                return (
                  <TableRow key={row.producto_id}>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div>
                          <Link
                            href={`/productos/${row.producto_id}`}
                            className="font-medium hover:underline"
                          >
                            {row.nombre}
                          </Link>
                          <p className="font-mono text-xs text-muted-foreground">{row.codigo}</p>
                          {(row.categoria || row.proveedor) && (
                            <p className="text-xs text-muted-foreground">
                              {[row.categoria, row.proveedor].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title="Unidades vendidas en el período (tickets y facturas, neto de notas de crédito)"
                    >
                      {row.unidades}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title="Suma de entradas de stock por factura de compra, recepción de pedido o importación"
                    >
                      {row.unidades_compradas ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(row.importe_venta)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.margen)}
                      {row.margen_pct != null ? (
                        <span className="block text-xs text-muted-foreground">({row.margen_pct}%)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.participacion_pct}%</TableCell>
                    <TableCell className="text-right tabular-nums">{row.tickets}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn('tabular-nums', row.quiebre && 'font-semibold text-amber-700')}
                        title="Stock actual del artículo / stock mínimo configurado en la ficha del producto"
                      >
                        {row.stock_actual} / {row.stock_minimo}
                      </span>
                      {row.quiebre ? (
                        <span className="mt-0.5 block text-xs text-amber-700">Stock bajo</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.fecha_vencimiento ? (
                        <div className="space-y-1">
                          <span className="text-sm">{formatDate(row.fecha_vencimiento)}</span>
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                              vb.className,
                            )}
                          >
                            {vb.label}
                            {row.dias_hasta_vencimiento != null ? ` (${row.dias_hasta_vencimiento}d)` : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm">
                      {row.ultima_entrada ? (
                        <div>
                          <p className="tabular-nums">{formatDateTime(row.ultima_entrada.fecha)}</p>
                          <p className="text-muted-foreground">
                            +{row.ultima_entrada.cantidad}
                            {row.ultima_entrada.referencia_tipo
                              ? ` · ${row.ultima_entrada.referencia_tipo}`
                              : ''}
                          </p>
                          {row.ultima_entrada.motivo ? (
                            <p className="truncate text-xs text-muted-foreground" title={row.ultima_entrada.motivo}>
                              {row.ultima_entrada.motivo}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
