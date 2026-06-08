import { NextResponse } from 'next/server';

import { UUID_RE } from '@/lib/turnos/api';

export async function validateAgendaPrincipalId(opts: {
  db: any;
  tenantId: string;
  sucursalId: string;
  agendaId: string | null;
  agendaPrincipalIdRaw: unknown;
}): Promise<{ ok: true; value: string | null } | { ok: false; response: NextResponse }> {
  const raw = opts.agendaPrincipalIdRaw;
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  const value = String(raw).trim();
  if (!UUID_RE.test(value)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'agenda_principal_id invalido' }, { status: 400 }),
    };
  }
  if (opts.agendaId && value === opts.agendaId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Una agenda no puede vincularse a si misma' },
        { status: 400 },
      ),
    };
  }
  const { data: principal, error } = await opts.db
    .from('turno_agenda')
    .select('id,agenda_principal_id')
    .eq('id', value)
    .eq('tenant_id', opts.tenantId)
    .eq('sucursal_id', opts.sucursalId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  if (!principal) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'La agenda principal indicada no existe en esta sucursal' },
        { status: 400 },
      ),
    };
  }
  if (principal.agenda_principal_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No se puede vincular a una agenda que ya depende de otra' },
        { status: 400 },
      ),
    };
  }
  if (opts.agendaId) {
    const { data: dependientes, error: depErr } = await opts.db
      .from('turno_agenda')
      .select('id')
      .eq('tenant_id', opts.tenantId)
      .eq('agenda_principal_id', opts.agendaId)
      .limit(1);
    if (depErr) {
      return {
        ok: false,
        response: NextResponse.json({ error: depErr.message }, { status: 500 }),
      };
    }
    if ((dependientes ?? []).length > 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Esta agenda ya es principal de otras y no puede vincularse a otra' },
          { status: 400 },
        ),
      };
    }
  }
  return { ok: true, value };
}
