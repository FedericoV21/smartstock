import { requireDespieceCarniceriaNegocio } from '@/lib/modulos/page-guard';

import { DespieceIngresosClient } from './ingresos-client';

export default async function DespieceIngresosPage() {
  await requireDespieceCarniceriaNegocio();
  return <DespieceIngresosClient />;
}

