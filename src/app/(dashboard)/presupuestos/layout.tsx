import { redirect } from 'next/navigation';

import { PRESUPUESTOS_ACCESO_BLOQUEADO } from '@/lib/features/presupuestos-acceso';
import { requireModulo } from '@/lib/modulos/page-guard';

export default async function PresupuestosLayout({ children }: { children: React.ReactNode }) {
  if (PRESUPUESTOS_ACCESO_BLOQUEADO) {
    redirect('/');
  }
  await requireModulo('presupuestos');
  return <>{children}</>;
}
