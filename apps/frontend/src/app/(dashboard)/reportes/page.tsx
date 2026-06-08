import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReportesResumen } from '@/components/reportes/reportes-resumen';

export default function ReportesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
          <ReporteInfoDialog title="Reportes">
            <p>Vista operativa para facturación, ventas, deuda de clientes y proveedores en tres clics.</p>
            <p>
              Para ver ventas por producto entrá a Reportes → Ventas por artículo (SKU).
            </p>
          </ReporteInfoDialog>
        </div>
      </div>
      <ReportesResumen />
    </div>
  );
}
