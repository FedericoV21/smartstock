import { intentarParseObjetoJsonModelo } from '@/lib/ia/json-respuesta-ia';
import { llamarGeminiTexto } from '@/lib/ia/gemini';
import { llamarOpenRouterTexto, parseOpenRouterModelsList, tieneOpenRouterTextoConfigurado } from '@/lib/ia/openrouter';

/** Respuestas cortas del asistente / catálogo; no reportes largos con cifras. */
export type ReplyPolishKind =
  | 'assistant_greeting'
  | 'assistant_help'
  | 'assistant_examples'
  | 'unknown_catalog';

const POLISH_MAX_CHARS = 2_000;
const POLISH_MAX_LINES = 40;
const POLISH_TIMEOUT_MS = 6_000;
const POLISH_MAX_OUTPUT_TOKENS = 450;

const ALLOWED_KINDS = new Set<ReplyPolishKind>([
  'assistant_greeting',
  'assistant_help',
  'assistant_examples',
  'unknown_catalog',
]);

function normalizeCompare(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldUseWhatsAppReplyPolish(): boolean {
  const raw = (process.env.WHATSAPP_AGENT_REPLY_POLISH ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** Montos y números que el LLM debe conservar tal cual. */
export function extractFrozenTokens(templateReply: string): string[] {
  const tokens = new Set<string>();
  for (const match of templateReply.matchAll(/\$\s?[\d][\d.,\s]*/g)) {
    const clean = match[0]
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!\s]+$/g, '')
      .trim();
    if (clean.length > 1) tokens.add(clean);
  }
  for (const match of templateReply.matchAll(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g)) {
    tokens.add(match[0]);
  }
  return [...tokens];
}

export function isPolishableTemplateReply(templateReply: string): boolean {
  const text = templateReply.trim();
  if (!text) return false;
  if (text.length > POLISH_MAX_CHARS) return false;
  if (text.split('\n').length > POLISH_MAX_LINES) return false;
  const currencyLines = text.split('\n').filter((line) => /\$\s?[\d]/.test(line)).length;
  if (currencyLines >= 2) return false;
  return true;
}

function extractNumericTokens(text: string): string[] {
  return extractFrozenTokens(text);
}

export function validatePolishedReply(templateReply: string, polishedReply: string): boolean {
  const polished = polishedReply.trim();
  if (!polished || polished.length < 12) return false;
  if (polished.length > Math.max(POLISH_MAX_CHARS, Math.ceil(templateReply.length * 1.4))) return false;

  const frozen = extractFrozenTokens(templateReply);
  const polishedNorm = normalizeCompare(polished);
  for (const token of frozen) {
    if (!polishedNorm.includes(normalizeCompare(token))) return false;
  }

  const templateNums = new Set(extractNumericTokens(templateReply));
  const polishedNums = extractNumericTokens(polished);
  for (const num of polishedNums) {
    if (!templateNums.has(num)) return false;
  }

  if (templateNums.size === 0 && polishedNums.length > 0) return false;

  return true;
}

function polishKindLabel(kind: ReplyPolishKind): string {
  switch (kind) {
    case 'assistant_greeting':
      return 'saludo de bienvenida';
    case 'assistant_help':
      return 'menú de ayuda y capacidades';
    case 'assistant_examples':
      return 'lista de ejemplos de consultas';
    case 'unknown_catalog':
      return 'orientación cuando la consulta no está en catálogo';
    default:
      return 'mensaje del asistente';
  }
}

function buildPolishPrompt(params: {
  kind: ReplyPolishKind;
  templateReply: string;
  userMessage?: string;
}): string {
  const frozen = extractFrozenTokens(params.templateReply);
  const frozenBlock =
    frozen.length > 0
      ? `Fragmentos que deben aparecer EXACTAMENTE (mismo texto): ${frozen.map((t) => `"${t}"`).join(', ')}.`
      : 'El texto base no tiene montos: NO agregues cifras, montos ni porcentajes.';

  const userCtx = params.userMessage?.trim()
    ? `Mensaje del usuario: """${params.userMessage.trim()}"""`
    : '';

  return [
    `Reformulá este mensaje de WhatsApp para SmartStock (${polishKindLabel(params.kind)}).`,
    'Reglas estrictas:',
    '- Tono cordial, claro y breve; español rioplatense informal (vos).',
    '- NO inventes capacidades, comandos, ejemplos ni datos que no estén en el texto base.',
    '- Podés acortar frases introductorias, pero conservá todas las viñetas/ejemplos del menú.',
    frozenBlock,
    '- Respondé solo el mensaje final (texto plano), sin JSON ni markdown.',
    userCtx,
    'Texto base:',
    `"""${params.templateReply.trim()}"""`,
  ]
    .filter(Boolean)
    .join('\n');
}

function unwrapPolishLlmText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = intentarParseObjetoJsonModelo(trimmed);
  if (parsed?.data && typeof parsed.data === 'object' && parsed.data != null) {
    const obj = parsed.data as Record<string, unknown>;
    if (typeof obj.reply === 'string' && obj.reply.trim()) return obj.reply.trim();
    if (typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim();
  }

  return trimmed.replace(/^```[\w-]*\n?|\n?```$/g, '').trim() || null;
}

function resolvePolishModels(): string[] | null {
  const single = process.env.WHATSAPP_AGENT_REPLY_POLISH_MODEL?.trim();
  if (single) return [single];
  const fromIntent = process.env.WHATSAPP_AGENT_INTENT_LLM_MODEL?.trim();
  if (fromIntent) return [fromIntent];
  const chain = parseOpenRouterModelsList();
  return chain.length > 0 ? chain : null;
}

async function callReplyPolishLlm(prompt: string): Promise<string | null> {
  if (tieneOpenRouterTextoConfigurado()) {
    const raw = await llamarOpenRouterTexto({
      messages: [
        {
          role: 'system',
          content:
            'Reformulás mensajes de un chatbot de gestión comercial. Solo reescribís tono; no agregás datos ni cifras nuevas.',
        },
        { role: 'user', content: prompt },
      ],
      modelsOverride: resolvePolishModels(),
      maxTokens: POLISH_MAX_OUTPUT_TOKENS,
      timeoutMs: POLISH_TIMEOUT_MS,
      jsonObject: false,
    });
    return raw?.trim() ? unwrapPolishLlmText(raw) : null;
  }

  if (!process.env.GEMINI_API_KEY?.trim()) return null;

  try {
    const raw = await llamarGeminiTexto(
      `${prompt}\n\nRespondé solo JSON válido: {"reply":"mensaje reformulado"}`,
    );
    return unwrapPolishLlmText(raw);
  } catch {
    return null;
  }
}

export type ComposeReplyWithLlmPolishParams = {
  kind: ReplyPolishKind;
  templateReply: string;
  userMessage?: string;
  /** Solo para tests: inyecta el llamado al LLM. */
  callLlm?: (prompt: string) => Promise<string | null>;
};

/**
 * Reformula tono de plantillas cortas (saludo, ayuda, catálogo). Off por default (`WHATSAPP_AGENT_REPLY_POLISH`).
 * Ante fallo o validación inválida devuelve la plantilla original.
 */
export async function composeReplyWithLlmPolish(
  params: ComposeReplyWithLlmPolishParams,
): Promise<string> {
  const { kind, templateReply, userMessage } = params;
  if (!shouldUseWhatsAppReplyPolish()) return templateReply;
  if (!ALLOWED_KINDS.has(kind)) return templateReply;
  if (!isPolishableTemplateReply(templateReply)) return templateReply;

  const prompt = buildPolishPrompt({ kind, templateReply, userMessage });
  const callLlm = params.callLlm ?? callReplyPolishLlm;
  const polished = await callLlm(prompt);
  if (!polished || !validatePolishedReply(templateReply, polished)) return templateReply;
  return polished;
}
