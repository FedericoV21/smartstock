import { redirect } from 'next/navigation';

/** Ruta histórica: el cierre de caja pasó a Facturación. */
export default function ReportesCierreZRedirectPage() {
  redirect('/facturacion/cierre-caja');
}
