'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ReporteClientesDeuda } from './reporte-clientes-deuda';
import { ReporteProveedoresGasto } from './reporte-proveedores-gasto';
import { ReporteVentasArticulo } from './reporte-ventas-articulo';
import { ReporteVentasConsumidor } from './reporte-ventas-consumidor';
import { ReportesResumen } from './reportes-resumen';

type SeccionKey =
  | 'cta-cte-resumen'
  | 'cta-cte-detalle'
  | 'por-proveedor'
  | 'ventas-consumidor'
  | 'ventas-articulo';

type EntradaNav =
  | { tipo: 'titulo'; label: string }
  | { tipo: 'item'; key: SeccionKey; label: string };

const NAV_REPORTES: EntradaNav[] = [
  { tipo: 'titulo', label: 'Resumen' },
  { tipo: 'item', key: 'cta-cte-resumen', label: 'KPIs del período' },
  { tipo: 'titulo', label: 'Ventas y producto' },
  { tipo: 'item', key: 'ventas-consumidor', label: 'POS — tickets' },
  { tipo: 'item', key: 'ventas-articulo', label: 'Por producto (SKU)' },
  { tipo: 'titulo', label: 'Clientes' },
  { tipo: 'item', key: 'cta-cte-detalle', label: 'Deuda y cobranza' },
  { tipo: 'titulo', label: 'Proveedores' },
  { tipo: 'item', key: 'por-proveedor', label: 'Gasto por proveedor' },
];

function keyDesdeHash(hash: string): SeccionKey | null {
  const normalized = hash.replace(/^#/, '');
  const item = NAV_REPORTES.find((e) => e.tipo === 'item' && e.key === normalized);
  if (item && item.tipo === 'item') return item.key;
  if (normalized === 'por-articulo') return 'ventas-consumidor';
  if (normalized === 'ventas-articulo') return 'ventas-articulo';
  return null;
}

export function ReportesSubmenu() {
  const [seccionActiva, setSeccionActiva] = useState<SeccionKey>('cta-cte-resumen');
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const aplicarHash = () => {
      const fromHash = keyDesdeHash(window.location.hash);
      if (fromHash) setSeccionActiva(fromHash);
    };
    aplicarHash();
    window.addEventListener('hashchange', aplicarHash);
    return () => window.removeEventListener('hashchange', aplicarHash);
  }, []);

  useEffect(() => {
    const current = keyDesdeHash(window.location.hash);
    if (current !== seccionActiva) {
      window.history.replaceState(null, '', `#${seccionActiva}`);
    }
  }, [seccionActiva]);

  const contenido = useMemo(() => {
    switch (seccionActiva) {
      case 'cta-cte-detalle':
        return <ReporteClientesDeuda />;
      case 'por-proveedor':
        return <ReporteProveedoresGasto />;
      case 'ventas-consumidor':
        return <ReporteVentasConsumidor />;
      case 'ventas-articulo':
        return <ReporteVentasArticulo />;
      case 'cta-cte-resumen':
      default:
        return <ReportesResumen />;
    }
  }, [seccionActiva]);

  return (
    <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-card p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <FileText className="h-4 w-4 shrink-0 text-[color:var(--brand-accent)]" />
          <span className="flex-1 text-left font-medium">Reportes</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 transition-transform',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
        </button>

        {open ? (
          <div className="mt-1 flex min-w-0 gap-0">
            <div className="ml-3 w-px shrink-0 bg-border" aria-hidden />
            <nav className="flex min-w-0 flex-1 flex-col gap-0.5 pl-2.5" aria-label="Secciones de reportes">
              {NAV_REPORTES.map((entrada, idx) => {
                if (entrada.tipo === 'titulo') {
                  return (
                    <p
                      key={`t-${idx}`}
                      className="mt-2 border-t border-border/80 px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0 first:border-t-0 first:pt-0"
                    >
                      {entrada.label}
                    </p>
                  );
                }
                const activo = seccionActiva === entrada.key;
                return (
                  <button
                    key={entrada.key}
                    type="button"
                    onClick={() => setSeccionActiva(entrada.key)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      activo
                        ? 'bg-[color:var(--brand-tint)] font-medium text-[color:var(--brand-primary)]'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--brand-accent)]" aria-hidden />
                    {entrada.label}
                  </button>
                );
              })}
            </nav>
          </div>
        ) : null}
      </aside>
      <div className="min-w-0">{contenido}</div>
    </section>
  );
}
