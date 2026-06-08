import { CompraProveedorManualClient } from '@/app/(dashboard)/facturacion/compra-proveedor/compra-proveedor-manual-client';
import { requireModulo } from '@/lib/modulos/page-guard';

export default async function CompraProveedorManualPage() {
  await requireModulo('facturador_simple');
  return <CompraProveedorManualClient />;
}
