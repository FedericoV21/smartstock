import { normalizarCaja } from '@/lib/caja/cierre-z-calculo';
import { usuarioPuedeOperarCaja } from '@/lib/caja/permiso-operar-caja';
import { normalizarCajaIdParam, obtenerAperturaVigente } from '@/lib/caja/sesion-caja';
import { cajaUuidComoCajaIdText } from '@/lib/caja/turno-caja';

export type CajaGastosContexto = {
  cajaIdText: string;
  sucursalId: string;
  aperturaId: string;
};

export async function resolverContextoCajaGastos(
  db: any,
  tenantId: string,
  userId: string,
  cajaIdRaw: string | null | undefined,
): Promise<
  | { ok: true; ctx: CajaGastosContexto }
  | { ok: false; status: number; error: string }
> {
  const cajaUuid = String(cajaIdRaw ?? '').trim();
  if (!cajaUuid) {
    return { ok: false, status: 400, error: 'caja_id es obligatorio.' };
  }

  const { data: caja, error: cajaErr } = await db
    .from('caja')
    .select('id, tenant_id, sucursal_id, activa, usuario_default_id')
    .eq('id', cajaUuid)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (cajaErr) return { ok: false, status: 500, error: cajaErr.message };
  if (!caja || !caja.activa) {
    return { ok: false, status: 404, error: 'Caja no encontrada o inactiva.' };
  }

  const puedeCaja = await usuarioPuedeOperarCaja(db, userId, caja);
  if (!puedeCaja) {
    return { ok: false, status: 403, error: 'No tenés permiso para operar esta caja.' };
  }

  const cajaIdText = normalizarCaja(cajaUuidComoCajaIdText(String(caja.id)));
  const sucursalId = String(caja.sucursal_id ?? '').trim();
  if (!sucursalId) {
    return { ok: false, status: 400, error: 'La caja no tiene sucursal asignada.' };
  }

  let ap;
  try {
    ap = await obtenerAperturaVigente(db, cajaIdText, sucursalId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al resolver sesión';
    return { ok: false, status: 500, error: msg };
  }
  if (!ap) {
    return {
      ok: false,
      status: 400,
      error: 'No hay sesión de caja abierta. Abrí la caja antes de registrar gastos.',
    };
  }

  return {
    ok: true,
    ctx: {
      cajaIdText: normalizarCajaIdParam(cajaIdText),
      sucursalId,
      aperturaId: ap.id,
    },
  };
}
