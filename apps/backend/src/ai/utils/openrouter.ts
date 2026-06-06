import { VisionIAError } from './vision-ia-error';
import { visionMaxOutputTokens } from './vision-token-budget';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 120_000;

type OpenRouterMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

interface OpenRouterChoice {
  message?: { content?: string | null };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: number };
}

export function resolverOpenRouterApiKey(override?: string | null): string | null {
  if (override?.trim()) return override.trim();
  const a = process.env.OPEN_ROUTER_API_KEY?.trim();
  const b = process.env.OPENROUTER_API_KEY?.trim();
  return a || b || null;
}

export function parseOpenRouterModelsList(rawConfig?: string | string[] | null): string[] {
  if (Array.isArray(rawConfig)) {
    return rawConfig.map((s) => s.trim()).filter(Boolean);
  }
  const raw = rawConfig ?? process.env.OPEN_ROUTER_MODELS ?? '';
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function openRouterHeaders(options?: {
  httpReferer?: string | null;
  appTitle?: string | null;
}): Record<string, string> {
  const referer =
    options?.httpReferer?.trim() ||
    process.env.OPEN_ROUTER_HTTP_REFERER?.trim() ||
    process.env.NEST_CORS_ORIGINS?.split(',')[0]?.trim() ||
    'http://localhost:3000';
  const title = options?.appTitle?.trim() || process.env.OPEN_ROUTER_APP_TITLE?.trim() || 'SmartStock';
  return {
    'Content-Type': 'application/json',
    'HTTP-Referer': referer,
    'X-Title': title,
  };
}

function pdfPluginPayload(engineOverride?: string | null) {
  const engine = engineOverride?.trim() || process.env.OPEN_ROUTER_PDF_ENGINE?.trim();
  if (!engine || !['cloudflare-ai', 'mistral-ocr', 'native'].includes(engine)) return undefined;
  return { plugins: [{ id: 'file-parser', pdf: { engine } }] };
}

function parseOpenRouterErrorBody(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message;
  } catch {
    /* ignore */
  }
  return null;
}

function buildUserContentParts(
  prompt: string,
  archivo: { base64: string; mimeType: string },
  fileName: string | undefined,
): OpenRouterMessageContent[] {
  const parts: OpenRouterMessageContent[] = [{ type: 'text', text: prompt }];
  if (archivo.mimeType === 'application/pdf') {
    const fn = fileName?.trim() || 'documento.pdf';
    const dataUrl = `data:application/pdf;base64,${archivo.base64}`;
    parts.push({
      type: 'file',
      file: { filename: fn.endsWith('.pdf') ? fn : `${fn}.pdf`, file_data: dataUrl },
    });
    return parts;
  }
  const dataUrl = `data:${archivo.mimeType};base64,${archivo.base64}`;
  parts.push({ type: 'image_url', image_url: { url: dataUrl } });
  return parts;
}

export async function llamarOpenRouterModel(
  prompt: string,
  archivo: { base64: string; mimeType: string },
  model: string,
  options?: {
    fileName?: string;
    apiKey?: string | null;
    pdfEngine?: string | null;
    httpReferer?: string | null;
    appTitle?: string | null;
  },
): Promise<string> {
  const apiKey = resolverOpenRouterApiKey(options?.apiKey);
  if (!apiKey) {
    throw new VisionIAError('OPEN_ROUTER_API_KEY no configurada', 'config');
  }

  const userContent = buildUserContentParts(prompt, archivo, options?.fileName);
  const pluginBlock =
    archivo.mimeType === 'application/pdf' ? pdfPluginPayload(options?.pdfEngine) : undefined;

  const baseBody = {
    model,
    temperature: 0,
    max_tokens: visionMaxOutputTokens(),
    messages: [{ role: 'user' as const, content: userContent }],
    ...pluginBlock,
  };

  const tryOnce = async (useJsonObject: boolean): Promise<string> => {
    const body = useJsonObject
      ? { ...baseBody, response_format: { type: 'json_object' as const } }
      : baseBody;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { ...openRouterHeaders(options), Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new VisionIAError(
          'Tiempo de espera agotado al procesar con IA. Intent├í con un archivo m├ís liviano.',
          'timeout',
        );
      }
      throw new VisionIAError((e as Error).message, 'http');
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();
    if (!response.ok) {
      const msg = parseOpenRouterErrorBody(rawText) ?? rawText.slice(0, 500);
      if (response.status === 401 || response.status === 403) {
        throw new VisionIAError('No autorizado ante Open Router (revis├í OPEN_ROUTER_API_KEY).', 'api_key');
      }
      if (response.status === 400 && /API key|api key|invalid/i.test(msg)) {
        throw new VisionIAError('Clave de Open Router inv├ílida o rechazada.', 'api_key');
      }
      throw new VisionIAError(`Open Router (${response.status}): ${msg}`, 'http', {
        httpStatus: response.status,
      });
    }

    let data: OpenRouterResponse;
    try {
      data = JSON.parse(rawText) as OpenRouterResponse;
    } catch {
      throw new VisionIAError('La respuesta de Open Router no es JSON v├ílido', 'parse');
    }

    if (data.error?.message) {
      throw new VisionIAError(data.error.message, 'http');
    }

    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    if (!text.trim()) {
      throw new VisionIAError('La IA no devolvi├│ contenido', 'empty');
    }
    return text;
  };

  try {
    return await tryOnce(true);
  } catch (e) {
    if (
      e instanceof VisionIAError &&
      e.code === 'http' &&
      e.httpStatus === 400 &&
      /response_format|json_object|unsupported/i.test(e.message)
    ) {
      return tryOnce(false);
    }
    throw e;
  }
}
