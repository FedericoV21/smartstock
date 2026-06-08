import { CierreCajaPanel } from '@/components/caja/cierre-caja-panel';
import { requireModulo } from '@/lib/modulos/page-guard';

export default async function FacturacionCierreCajaPage() {
  await requireModulo('facturador_simple');
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <CierreCajaPanel />
    </div>
  );
}
