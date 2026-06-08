import { LectorFacturasClient } from '@/components/lector-facturas/lector-facturas-client';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { requireModuloAny } from '@/lib/modulos/page-guard';

export default async function LectorFacturasPage() {
  await requireModuloAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  return <LectorFacturasClient />;
}
