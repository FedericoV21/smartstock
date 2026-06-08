import { VisionIAError } from '@/lib/ia/vision-ia-error';
import { visionMaxOutputTokens } from '@/lib/ia/vision-token-budget';

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

function openRouterHeaders(options?: {
  httpReferer?: string | null;
  appTitle?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const referer =
    options?.httpReferer?.trim() ||
    process.env.OPEN_ROUTER_HTTP_REFERER?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3000';
  const title = options?.appTitle?.trim() || process.env.OPEN_ROUTER_APP_TITLE?.trim() || 'SmartStock';
  headers['HTTP-Referer'] = referer;
  headers['X-Title'] = title;
  return headers;
}

function pdfPluginPayload(engineOverride?: string | null): { plugins: { id: string; pdf: { engine: string } }[] } | undefined {
  const engine = engineOverride?.trim() || process.env.OPEN_ROUTER_PDF_ENGINE?.trim();
  if (!engine) return undefined;
  if (engine !== 'cloudflare-ai' && engine !== 'mistral-ocr' && engine !== 'native') return undefined;
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

/**
 * Una llamada chat/completions a Open Router para un modelo concreto.
 * Reintenta sin `response_format` si el modelo rechaza `json_object`.
 */
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
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === 'AbortError') {
        console.error('[OpenRouter] timeout', { model, ms: TIMEOUT_MS });
        throw new VisionIAError(
          'Tiempo de espera agotado al procesar con IA. Intentá con un archivo más liviano.',
          'timeout',
        );
      }
      console.error('[OpenRouter] fetch', (e as Error).message);
      throw new VisionIAError((e as Error).message, 'http');
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();

    if (!response.ok) {
      const msg = parseOpenRouterErrorBody(rawText) ?? rawText.slice(0, 500);
      console.error('[OpenRouter] HTTP', { model, status: response.status, preview: rawText.slice(0, 400) });

      if (response.status === 401 || response.status === 403) {
        throw new VisionIAError('No autorizado ante Open Router (revisá OPEN_ROUTER_API_KEY).', 'api_key');
      }
      if (response.status === 400 && /API key|api key|invalid/i.test(msg)) {
        throw new VisionIAError('Clave de Open Router inválida o rechazada.', 'api_key');
      }

      throw new VisionIAError(`Open Router (${response.status}): ${msg}`, 'http', {
        httpStatus: response.status,
      });
    }

    let data: OpenRouterResponse;
    try {
      data = JSON.parse(rawText) as OpenRouterResponse;
    } catch {
      throw new VisionIAError('La respuesta de Open Router no es JSON válido', 'parse');
    }

    if (data.error?.message) {
      throw new VisionIAError(data.error.message, 'http');
    }

    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    if (!text.trim()) {
      throw new VisionIAError('La IA no devolvió contenido', 'empty');
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

function recoverableOpenRouterHttp(status: number | undefined, message: string): boolean {
  if (status === 429) return true;
  if (status != null && status >= 500) return true;
  if (status === 404) return true;
  if (status === 400) {
    return /model|overload|capacity|context|too long|unavailable|rate|busy|quota|token|length|invalid/i.test(
      message,
    );
  }
  return status == null;
}

export type OpenRouterTextMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * Chat texto vía Open Router. Usa `OPEN_ROUTER_API_KEY` y la cadena `OPEN_ROUTER_MODELS`
 * (o `modelsOverride` / primer modelo en `modelSingleOverride`).
 */
export async function llamarOpenRouterTexto(params: {
  messages: OpenRouterTextMessage[];
  modelsOverride?: string[] | null;
  modelSingleOverride?: string | null;
  maxTokens?: number;
  timeoutMs?: number;
  jsonObject?: boolean;
  apiKeyOverride?: string | null;
}): Promise<string | null> {
  const apiKey = resolverOpenRouterApiKey(params.apiKeyOverride);
  if (!apiKey) return null;

  let models: string[] = [];
  if (params.modelSingleOverride?.trim()) {
    models = [params.modelSingleOverride.trim()];
  } else if (params.modelsOverride?.length) {
    models = params.modelsOverride;
  } else {
    models = parseOpenRouterModelsList();
  }
  if (models.length === 0) {
    models = ['openai/gpt-4o-mini'];
  }

  const timeoutMs = params.timeoutMs ?? 8_000;
  const maxTokens = params.maxTokens ?? 250;

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: params.messages,
      };
      if (params.jsonObject) {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          ...openRouterHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });

      const rawText = await response.text();
      if (!response.ok) {
        const msg = parseOpenRouterErrorBody(rawText) ?? rawText.slice(0, 300);
        if (recoverableOpenRouterHttp(response.status, msg)) continue;
        return null;
      }

      let data: OpenRouterResponse;
      try {
        data = JSON.parse(rawText) as OpenRouterResponse;
      } catch {
        continue;
      }
      if (data.error?.message) {
        if (recoverableOpenRouterHttp(data.error.code, data.error.message)) continue;
        return null;
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content;
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export function tieneOpenRouterTextoConfigurado(): boolean {
  return Boolean(resolverOpenRouterApiKey()) && parseOpenRouterModelsList().length > 0;
}
