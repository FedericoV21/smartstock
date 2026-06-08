import { redirect } from 'next/navigation';

import { TesoreriaClient } from '@/components/tesoreria/tesoreria-client';
import { getTenantSession } from '@/lib/api/tenant-session';
import { requireModulo } from '@/lib/modulos/page-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchEffectiveBusinessPrefsForTesoreria } from '@/lib/tesoreria/resolve-caja';

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<{
    sucursal_id?: string;
    cierre_z_id?: string;
    proveedor_id?: string;
  }>;
}) {
  await requireModulo('facturador_simple');
  const session = await getTenantSession();
  if ('error' in session) redirect('/login');

  const sp = await searchParams;
  const sucursalId = sp.sucursal_id?.trim() || null;
  const db = createServiceRoleClient();
  const prefs = await fetchEffectiveBusinessPrefsForTesoreria(db, session.tenantId, sucursalId);
  if (!prefs.cajaInterna.habilitado) {
    redirect('/configuracion');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <TesoreriaClient
        sucursalIdInicial={sucursalId}
        cierreZIdInicial={sp.cierre_z_id?.trim() || null}
        proveedorIdInicial={sp.proveedor_id?.trim() || null}
      />
    </div>
  );
}
