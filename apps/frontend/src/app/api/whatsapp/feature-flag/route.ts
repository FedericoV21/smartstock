import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { getWhatsAppAgentFeatureFlag } from '@/lib/whatsapp/feature-flag';

function rejectUnlessOwnerAdmin(session: { rol: string; isSuperAdmin: boolean }) {
  if (session.isSuperAdmin || session.rol === 'admin') return null;
  return NextResponse.json({ error: 'Solo owner/admin puede modificar este flag.' }, { status: 403 });
}

export async function GET() {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  try {
    const feature = await getWhatsAppAgentFeatureFlag(session.supabase as any, session.tenantId);
    return NextResponse.json({
      enabled: feature.enabled,
      rollout_stage: feature.rolloutStage,
      notes: feature.notes,
      can_manage: session.isSuperAdmin || session.rol === 'admin',
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectUnlessOwnerAdmin(session);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const enabled = Boolean(b.enabled);
  const stageRaw = String(b.rollout_stage ?? '').trim().toLowerCase();
  const rolloutStage = stageRaw || (enabled ? 'pilot' : 'disabled');
  const notes = typeof b.notes === 'string' ? b.notes.trim() || null : null;

  const db = session.supabase as any;
  const { error } = await db.from('whatsapp_agent_feature_flag').upsert(
    {
      tenant_id: session.tenantId,
      enabled,
      rollout_stage: rolloutStage,
      notes,
    },
    { onConflict: 'tenant_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, enabled, rollout_stage: rolloutStage, notes });
}
