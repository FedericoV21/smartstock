import { requireDespieceCarniceriaNegocio } from '@/lib/modulos/page-guard';

import { DespieceEditorClient } from '../plantillas-client';

export default async function NuevaPlantillaDespiecePage() {
  await requireDespieceCarniceriaNegocio();
  return <DespieceEditorClient />;
}

