import { ReporteRecibos } from '@/components/reportes/reporte-recibos';

export default function ReportesRecibosPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
      </div>
      <ReporteRecibos />
    </div>
  );
}
