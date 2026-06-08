import { ReporteExtractoCuentaCorrienteProveedor } from '@/components/reportes/reporte-extracto-cuenta-corriente-proveedor';

export default function ReporteExtractoCuentaCorrienteProveedorPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Extracto cuenta corriente — proveedor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Movimientos de deuda y pagos por proveedor, con exportación CSV y PDF.
        </p>
      </div>
      <ReporteExtractoCuentaCorrienteProveedor />
    </div>
  );
}
