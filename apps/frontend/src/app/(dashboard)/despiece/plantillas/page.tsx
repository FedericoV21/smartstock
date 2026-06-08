import { requireDespieceCarniceriaNegocio } from '@/lib/modulos/page-guard';

import { DespiecePlantillasClient } from './plantillas-client';

export default async function DespiecePlantillasPage() {
  await requireDespieceCarniceriaNegocio();
  return <DespiecePlantillasClient />;
}

