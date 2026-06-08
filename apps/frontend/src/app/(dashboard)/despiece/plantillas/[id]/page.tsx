import { requireDespieceCarniceriaNegocio } from '@/lib/modulos/page-guard';

import { DespieceEditorClient } from '../plantillas-client';

export default async function DespiecePlantillaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDespieceCarniceriaNegocio();
  const { id } = await params;
  return <DespieceEditorClient plantillaId={id} />;
}

