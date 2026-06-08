import { requireModuloAny } from '@/lib/modulos/page-guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

import { WhatsAppJobsClient } from '@/components/whatsapp/whatsapp-jobs-client';

export default async function WhatsAppInboxPage() {
  await requireModuloAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);

  return <WhatsAppJobsClient />;
}
