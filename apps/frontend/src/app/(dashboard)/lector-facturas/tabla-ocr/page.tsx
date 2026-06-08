import { LectorFacturasTablaOcrClient } from '@/components/lector-facturas/lector-facturas-tabla-ocr-client';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { requireModuloAny } from '@/lib/modulos/page-guard';

export default async function LectorFacturasTablaOcrPage() {
  await requireModuloAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  return <LectorFacturasTablaOcrClient />;
}
