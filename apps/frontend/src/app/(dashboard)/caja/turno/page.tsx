import { redirect } from 'next/navigation';

import { requireModulo } from '@/lib/modulos/page-guard';

export default async function CajaTurnoRedirectPage() {
  await requireModulo('facturador_pos');
  redirect('/facturacion/pos');
}
