import Link from 'next/link';
import { ScanBarcode, Wallet, FileBarChart } from 'lucide-react';

import { ReporteVentaCierreDialog } from '@/components/reportes/reporte-venta-cierre-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  showPos: boolean;
  showFacturacionSimple: boolean;
  showReporteCierre: boolean;
};

function ActionCard({
  href,
  icon: Icon,
  title,
  description,
  variant = 'loud',
}: {
  href: string;
  icon: typeof ScanBarcode;
  title: string;
  description: string;
  variant?: 'loud' | 'quiet';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all',
        'hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      <Icon className="h-6 w-6 text-primary" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <span
        className={cn(
          buttonVariants({ variant, size: 'sm' }),
          'mt-auto w-full pointer-events-none',
        )}
      >
        Abrir
      </span>
    </Link>
  );
}

export function DashboardQuickActions({
  showPos,
  showFacturacionSimple,
  showReporteCierre,
}: Props) {
  if (!showPos && !showFacturacionSimple) return null;

  return (
    <section aria-label="Acciones rápidas" className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight text-foreground">Acciones rápidas</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {showPos ? (
          <ActionCard
            href="/facturacion/pos"
            icon={ScanBarcode}
            title="Punto de venta"
            description="Cobrar al cliente con escáner o búsqueda rápida"
            variant="loud"
          />
        ) : null}
        {showFacturacionSimple ? (
          <ActionCard
            href="/facturacion/cierre-caja"
            icon={Wallet}
            title="Caja"
            description="Aperturas, cierres y arqueo de jornada"
            variant="quiet"
          />
        ) : null}
        {showReporteCierre ? (
          <div
            className={cn(
              'flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm',
            )}
          >
            <FileBarChart className="h-6 w-6 text-primary" aria-hidden />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Reporte de venta</p>
              <p className="text-xs text-muted-foreground">Resumen de ventas al cerrar la jornada</p>
            </div>
            <ReporteVentaCierreDialog
              variant="quiet"
              size="sm"
              className="mt-auto w-full"
              triggerLabel="Abrir"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
