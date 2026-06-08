import { requireModulo } from '@/lib/modulos/page-guard';

import { TurnosClient } from './turnos-client';

export default async function TurnosPage() {
  await requireModulo('turnos');
  return <TurnosClient />;
}
