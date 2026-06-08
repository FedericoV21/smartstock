import { ReporteProveedoresGasto } from '@/components/reportes/reporte-proveedores-gasto';

export default function ReportesProveedoresPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
      </div>
      <ReporteProveedoresGasto />
    </div>
  );
}
