const BRANCH_REPLY_WINDOW_MINUTES = 45;

interface ResolveBranchInput {
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  providerId?: string | null;
}

type BranchRow = {
  id: string;
  nombre: string;
  codigo: string | null;
  es_principal?: boolean | null;
};

export interface BranchResolutionResult {
  type: 'resolved_auto' | 'ambiguous' | 'not_found';
  branchId: string | null;
  reason: string;
  candidates: Array<{ id: string; nombre: string; codigo: string | null }>;
}

function toBranchCandidates(branches: BranchRow[]): BranchResolutionResult['candidates'] {
  return branches.map((b) => ({ id: b.id, nombre: b.nombre, codigo: b.codigo }));
}

export async function resolveBranchByRules(
  db: any,
  input: ResolveBranchInput,
): Promise<BranchResolutionResult> {
  const { data: sucursales } = await db
    .from('sucursal')
    .select('id, nombre, codigo, es_principal')
    .eq('tenant_id', input.tenantId)
    .eq('activa', true);

  const branches = (sucursales ?? []) as BranchRow[];
  if (branches.length === 0) {
    return {
      type: 'not_found',
      branchId: null,
      reason: 'no_active_branch',
      candidates: [],
    };
  }

  const branchIds = new Set(branches.map((b) => b.id));
  const { data: reglas } = await db
    .from('whatsapp_branch_rule')
    .select('sucursal_id, prioridad')
    .eq('tenant_id', input.tenantId)
    .eq('activa', true)
    .or(`from_wa_id.eq.${input.fromWaId},from_wa_id.is.null`)
    .or(input.phoneNumberId ? `phone_number_id.eq.${input.phoneNumberId},phone_number_id.is.null` : 'phone_number_id.is.null')
    .order('prioridad', { ascending: false });

  const ranked = new Map<string, number>();
  for (const regla of (reglas ?? []) as Array<{ sucursal_id: string; prioridad: number }>) {
    if (!branchIds.has(regla.sucursal_id)) continue;
    const prev = ranked.get(regla.sucursal_id) ?? -9999;
    ranked.set(regla.sucursal_id, Math.max(prev, Number(regla.prioridad ?? 0)));
  }

  const ruleCandidates = branches
    .filter((b) => ranked.has(b.id))
    .sort((a, b) => (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0));

  if (ruleCandidates.length === 1) {
    return {
      type: 'resolved_auto',
      branchId: ruleCandidates[0].id,
      reason: 'matched_branch_rule',
      candidates: toBranchCandidates(ruleCandidates),
    };
  }
  if (ruleCandidates.length > 1) {
    return {
      type: 'ambiguous',
      branchId: null,
      reason: 'multiple_branch_rules',
      candidates: toBranchCandidates(ruleCandidates.slice(0, 5)),
    };
  }

  if (branches.length === 1) {
    return {
      type: 'resolved_auto',
      branchId: branches[0].id,
      reason: 'single_active_branch',
      candidates: toBranchCandidates(branches),
    };
  }

  const principalBranches = branches.filter((b) => b.es_principal === true);
  if (principalBranches.length === 1) {
    return {
      type: 'resolved_auto',
      branchId: principalBranches[0].id,
      reason: 'principal_branch_default',
      candidates: toBranchCandidates(principalBranches),
    };
  }

  return {
    type: 'ambiguous',
    branchId: null,
    reason: 'multiple_active_branches_without_rule',
    candidates: toBranchCandidates(branches.slice(0, 5)),
  };
}

export function buildBranchPromptMessage(candidates: Array<{ nombre: string; codigo: string | null }>) {
  const lines = candidates.map((c, i) => `${i + 1}) ${c.nombre}${c.codigo ? ` (${c.codigo})` : ''}`);
  return [
    'Recibimos tu archivo, gracias.',
    'Para cargar la factura en el depósito correcto, indicá la sucursal respondiendo con el número:',
    ...lines,
    'Después podés revisar ítems (revisar, buscar, enlazar) y confirmar con el código que te enviemos.',
  ].join('\n');
}

export function getBranchReplyDeadlineIso(baseDate = new Date()) {
  return new Date(baseDate.getTime() + BRANCH_REPLY_WINDOW_MINUTES * 60_000).toISOString();
}

export function resolveBranchFromTextReply(
  text: string,
  candidates: Array<{ id: string; nombre: string; codigo: string | null }>,
): string | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const idx = Number.parseInt(normalized, 10);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= candidates.length) {
    return candidates[idx - 1].id;
  }

  const match = candidates.find((c) => {
    const nombre = c.nombre.trim().toLowerCase();
    const codigo = (c.codigo ?? '').trim().toLowerCase();
    return normalized === nombre || (codigo.length > 0 && normalized === codigo);
  });
  return match?.id ?? null;
}
