import { ReporteGananciasNetas } from '@/components/reportes/reporte-ganancias-netas';

export default function ReportesGananciasNetasPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
      </div>
      <ReporteGananciasNetas />
    </div>
  );
}
