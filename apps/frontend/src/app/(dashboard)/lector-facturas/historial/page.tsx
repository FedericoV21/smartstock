import Link from 'next/link';

import { LectorHistorialClient } from '@/components/lector-facturas/lector-historial-client';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { requireModuloAny } from '@/lib/modulos/page-guard';

export default async function LectorFacturasHistorialPage() {
  await requireModuloAny(MODULOS_ACCESO_LECTOR_FACTURAS);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <p className="text-muted-foreground text-sm">
        <Link href="/lector-facturas" className="underline underline-offset-4">
          ← Volver al lector de facturas
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Historial de extracciones</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Registros de facturas analizadas con IA (confirmadas, pendientes o con error).
        </p>
      </div>
      <LectorHistorialClient />
    </div>
  );
}
