import { ComprobanteDetalleView } from '@/components/facturacion/comprobante-detalle-view';

export default function PresupuestoDetallePage() {
  return (
    <ComprobanteDetalleView
      apiPath="/api/presupuestos"
      backHref="/facturacion?tab=presupuestos"
      variant="presupuesto"
    />
  );
}
