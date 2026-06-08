const BRANCH_REPLY_WINDOW_MINUTES = 45;

export type BranchCandidate = { id: string; nombre: string; codigo: string | null };

export interface BranchResolutionResult {
  type: 'resolved_auto' | 'ambiguous' | 'not_found';
  branchId: string | null;
  reason: string;
  candidates: BranchCandidate[];
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

export function getBranchReplyDeadlineIso(baseDate = new Date()): string {
  return new Date(baseDate.getTime() + BRANCH_REPLY_WINDOW_MINUTES * 60_000).toISOString();
}

export function resolveBranchFromTextReply(
  text: string,
  candidates: BranchCandidate[],
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

export function branchSelectionReplyMatches(text: string, candidates: BranchCandidate[]): string | null {
  if (candidates.length < 2) return null;
  return resolveBranchFromTextReply(text, candidates);
}

export const BRANCH_REPLY_LOOKBACK_MINUTES = 15;
