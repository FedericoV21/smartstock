import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

export const dynamic = 'force-dynamic';

const ALLOWED_CHANNELS = new Set(['live', 'sandbox']);
const ALLOWED_STATUSES = new Set(['success', 'fallback', 'error', 'blocked']);

function cleanText(value: string | null, max = 120): string | null {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

function cleanSearch(value: string | null): string | null {
  return cleanText(value, 80)?.replace(/[%_,]/g, ' ').replace(/\s+/g, ' ') ?? null;
}

function parseLimit(value: string | null): number {
  const n = Number.parseInt(value ?? '50', 10);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(100, n));
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function rejectUnlessAdminOrSuper(session: { rol: string; isSuperAdmin: boolean }) {
  if (session.isSuperAdmin || session.rol === 'admin') return null;
  return NextResponse.json({ error: 'Solo admin/superadmin puede ver logs tecnicos de WhatsApp.' }, { status: 403 });
}

export async function GET(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectUnlessAdminOrSuper(session);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = parseDate(url.searchParams.get('cursor'));
  const from = parseDate(url.searchParams.get('from'));
  const to = parseDate(url.searchParams.get('to'));
  const actorId = cleanText(url.searchParams.get('actor_id'), 80);
  const channel = cleanText(url.searchParams.get('channel'), 20);
  const status = cleanText(url.searchParams.get('status'), 20);
  const tool = cleanText(url.searchParams.get('tool'), 120);
  const intent = cleanText(url.searchParams.get('intent'), 120);
  const q = cleanSearch(url.searchParams.get('q'));

  let query = session.supabase
    .from('whatsapp_agent_turn_log' as any)
    .select(
      `
      id,
      tenant_id,
      actor_id,
      usuario_id,
      inbound_message_id,
      action_log_id,
      from_wa_id,
      channel,
      source,
      input_body,
      resolved_message,
      reply_body,
      replies,
      intent,
      confidence,
      fallback_reason,
      status,
      tool_name,
      tool_args,
      tool_result,
      tool_trace,
      processing_trace,
      duration_ms,
      error_detail,
      created_at,
      expires_at,
      actor:actor_id(id, from_wa_id, rol_whatsapp, trust_level, usuario:usuario_id(id, nombre, apellido, email, rol))
      `,
    )
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (cursor) query = query.lt('created_at', cursor);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (actorId) query = query.eq('actor_id', actorId);
  if (channel && ALLOWED_CHANNELS.has(channel)) query = query.eq('channel', channel);
  if (status && ALLOWED_STATUSES.has(status)) query = query.eq('status', status);
  if (tool) query = query.eq('tool_name', tool);
  if (intent) query = query.eq('intent', intent);
  if (q) {
    query = query.or(
      [
        `input_body.ilike.%${q}%`,
        `reply_body.ilike.%${q}%`,
        `from_wa_id.ilike.%${q}%`,
        `intent.ilike.%${q}%`,
        `tool_name.ilike.%${q}%`,
        `fallback_reason.ilike.%${q}%`,
      ].join(','),
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (Array.isArray(data) ? data : []) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const logs = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? String(logs.at(-1)?.created_at ?? '') || null : null;

  return NextResponse.json({ logs, nextCursor });
}
