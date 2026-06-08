'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { nombrePdfReporte, descargarPdfResumen } from '@/lib/reportes/pdf-informe';
import { formatCurrency } from '@/lib/utils/formatters';

type ResumenResponse = {
  kpis: {
    facturado: number;
    monto_facturas_fiscales?: number;
    monto_tickets_pos?: number;
    monto_notas_credito?: number;
    comprobantes_factura?: number;
    comprobantes_ticket?: number;
    vendidos_comprobantes: number;
    deuda_cta_cte: number;
    gasto_proveedores: number;
  };
  error?: string;
};

const GRUPOS: {
  titulo: string;
  descripcion: string;
  links: { href: string; label: string; ayuda: string }[];
}[] = [
  {
    titulo: 'Ventas y facturación',
    descripcion: 'Montos emitidos y análisis de venta (global o por producto).',
    links: [
      {
        href: '/reportes',
        label: 'Ingresos del período',
        ayuda: 'Compará monto y cantidad con factura fiscal (A/B/C) vs. solo ticket POS; neto, deuda CC y costo proveedores.',
      },
      {
        href: '/reportes/ventas-consumidor',
        label: 'POS — tickets',
        ayuda: 'Caja y turno: tickets, montos y franjas horarias. No desglosa por SKU.',
      },
      {
        href: '/reportes/ventas-articulo',
        label: 'Por producto (SKU)',
        ayuda: 'Unidades, importe, margen, stock, vencimiento y última entrada de stock.',
      },
    ],
  },
  {
    titulo: 'Clientes y cobros',
    descripcion: 'Cuenta corriente, deuda y documentos de cobro.',
    links: [
      {
        href: '/reportes/cta-cte-resumen',
        label: 'Deuda — resumen',
        ayuda: 'Totales y ranking rápido de clientes con mayor saldo.',
      },
      {
        href: '/reportes/clientes',
        label: 'Deuda — detalle',
        ayuda: 'Listado con aging, facturas abiertas y estado de cobranza.',
      },
      {
        href: '/reportes/recibos',
        label: 'Recibos',
        ayuda: 'Recibos emitidos por período (cobranzas documentadas).',
      },
    ],
  },
  {
    titulo: 'Proveedores',
    descripcion: 'Concentración de costo / gasto asociado a proveedor.',
    links: [
      {
        href: '/reportes/proveedores',
        label: 'Gasto por proveedor',
        ayuda: 'Ranking y comparación de períodos (según reglas del reporte).',
      },
      {
        href: '/reportes/reposicion-proveedor',
        label: 'Sugerencia de compra',
        ayuda: 'Consumo del período, días de cobertura, cantidad sugerida y listas copiables por proveedor.',
      },
    ],
  },
  {
    titulo: 'Fiscal y resultado',
    descripcion: 'IVA, márgenes y cierre contable-operativo.',
    links: [
      {
        href: '/reportes/libro-iva',
        label: 'Libro IVA ventas',
        ayuda: 'Neto, IVA y totales por comprobante fiscal.',
      },
      {
        href: '/reportes/ganancias-netas',
        label: 'Ganancias / margen',
        ayuda: 'Ventas netas vs costo de mercadería en el tiempo.',
      },
    ],
  },
];

export function ReporteResumenGeneral() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResumenResponse | null>(null);

  const queryResumen = useMemo(() => {
    const qs = new URLSearchParams({ periodo: 'mes' });
    aplicarASearchParams(qs);
    return qs.toString();
  }, [aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/resumen?${queryResumen}`);
      const json = (await res.json()) as ResumenResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el resumen general');
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
  }, [queryResumen, hidrato]);
  const csvHref = `/api/reportes/resumen?${queryResumen}&export=csv`;

  function generarPdf() {
    if (!data) return;
    descargarPdfResumen({
      nombreArchivo: nombrePdfReporte('resumen-general-mes'),
      titulo: 'Resumen general — mes en curso',
      lineasMeta: ['Indicadores consolidados. Período: mes (misma base que la pantalla).'],
      secciones: [
        {
          titulo: 'KPIs',
          filas: [
            { etiqueta: 'Ingresos (neto)', valor: formatCurrency(data.kpis.facturado) },
            {
              etiqueta: 'Facturas A/B/C',
              valor: formatCurrency(data.kpis.monto_facturas_fiscales ?? 0),
            },
            { etiqueta: 'Tickets POS', valor: formatCurrency(data.kpis.monto_tickets_pos ?? 0) },
            {
              etiqueta: 'Notas de crédito',
              valor: formatCurrency(data.kpis.monto_notas_credito ?? 0),
            },
            { etiqueta: 'Comprobantes de venta', valor: String(data.kpis.vendidos_comprobantes) },
            { etiqueta: 'Deuda cuenta corriente', valor: formatCurrency(data.kpis.deuda_cta_cte) },
            { etiqueta: 'Costo / gasto proveedores', valor: formatCurrency(data.kpis.gasto_proveedores) },
          ],
        },
      ],
    });
  }

  return (
    <section className="space-y-6 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Resumen general</h2>
            <ReporteInfoDialog title="Resumen general">
              <p>
                Indicadores del mes y accesos agrupados por tema: ventas, clientes, proveedores, fiscal y caja.
              </p>
              <p>Los importes se calculan con la misma base que las secciones detalladas de reportes.</p>
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

      {data ? (
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-foreground">Ventas del mes: facturado vs. ticket</p>
              <ReporteInfoDialog title="Ventas del mes: facturado vs. ticket" buttonLabel="Ver criterio">
                <p>Con factura = comprobantes A/B/C.</p>
                <p>Sin factura = solo tickets POS, que no son factura fiscal.</p>
              </ReporteInfoDialog>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Con factura fiscal (A/B/C)</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatCurrency(data.kpis.monto_facturas_fiscales ?? 0)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {data.kpis.comprobantes_factura ?? 0} comprobante(s)
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sin factura fiscal (ticket POS)</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatCurrency(data.kpis.monto_tickets_pos ?? 0)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {data.kpis.comprobantes_ticket ?? 0} ticket(s)
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Ingresos netos</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.kpis.facturado)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Facturas + tickets
                  {(data.kpis.monto_notas_credito ?? 0) > 0
                    ? ` − NC ${formatCurrency(data.kpis.monto_notas_credito ?? 0)}`
                    : ''}
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Comprobantes de venta</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{data.kpis.vendidos_comprobantes}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Deuda cta. cte.</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.kpis.deuda_cta_cte)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Costo proveedores</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.kpis.gasto_proveedores)}</p>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
      ) : null}

      <div className="space-y-6">
        {GRUPOS.map((grupo) => (
          <div key={grupo.titulo} className="space-y-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{grupo.titulo}</h3>
                <ReporteInfoDialog title={`Sobre ${grupo.titulo}`} buttonLabel="Ver detalle">
                  <p>{grupo.descripcion}</p>
                  <ul className="space-y-2">
                    {grupo.links.map((item) => (
                      <li key={item.href}>
                        <span className="font-medium text-foreground">{item.label}:</span> {item.ayuda}
                      </li>
                    ))}
                  </ul>
                </ReporteInfoDialog>
              </div>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {grupo.links.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'flex h-auto min-h-10 w-full flex-col items-start gap-1 py-2.5 text-left whitespace-normal',
                    )}
                  >
                    <span className="font-medium">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
