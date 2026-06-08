import { Suspense } from 'react';

import { ReporteExtractoCuentaCorriente } from '@/components/reportes/reporte-extracto-cuenta-corriente';

export default function ReporteExtractoCuentaCorrientePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Extracto cuenta corriente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Movimientos de deuda y pagos por cliente, con saldo corrido.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
        <ReporteExtractoCuentaCorriente />
      </Suspense>
    </div>
  );
}
