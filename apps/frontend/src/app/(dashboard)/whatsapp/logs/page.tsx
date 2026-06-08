import { getTenantSession } from '@/lib/api/tenant-session';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { requireModuloAny } from '@/lib/modulos/page-guard';

import { WhatsAppLogsClient } from '@/components/whatsapp/whatsapp-logs-client';

export default async function WhatsAppLogsPage() {
  await requireModuloAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);

  const session = await getTenantSession();
  if ('error' in session) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No se pudo validar la sesion.
      </div>
    );
  }

  if (!session.isSuperAdmin && session.rol !== 'admin') {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold tracking-tight">403</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Solo admin o super admin puede ver logs tecnicos de WhatsApp.
        </p>
      </div>
    );
  }

  return <WhatsAppLogsClient />;
}
