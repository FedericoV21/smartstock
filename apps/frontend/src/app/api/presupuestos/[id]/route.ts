import { getTenantSession } from '@/lib/api/tenant-session';
import { comprobanteDetalleJsonResponse } from '@/lib/facturacion/comprobante-detalle-response';
import { moduloGuardAny } from '@/lib/modulos/guard';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuardAny(['presupuestos', 'facturador_simple']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id } = await params;

  return comprobanteDetalleJsonResponse(session, id, {
    soloTipo: 'presupuesto',
    logTag: '[GET /api/presupuestos/[id]]',
  });
}
