import { visionMaxOutputTokens } from './vision-token-budget';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-pro';
const GEMINI_TIMEOUT_MS = 120_000;

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string }[] };
  }[];
  error?: { code?: number; message?: string; status?: string };
}

function parseGeminiErrorPayload(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message;
  } catch {
    /* ignore */
  }
  return null;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly code: 'config' | 'api_key' | 'timeout' | 'http' | 'empty' | 'parse',
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export async function llamarGemini(
  prompt: string,
  archivo: { base64: string; mimeType: string },
  options?: { apiKey?: string | null; model?: string | null },
): Promise<string> {
  return llamarGeminiBase(
    [
      { inline_data: { mime_type: archivo.mimeType, data: archivo.base64 } },
      { text: prompt },
    ],
    options,
  );
}

export async function llamarGeminiTexto(
  prompt: string,
  options?: { apiKey?: string | null; model?: string | null },
): Promise<string> {
  return llamarGeminiBase([{ text: prompt }], options);
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

async function llamarGeminiBase(
  parts: GeminiPart[],
  options?: { apiKey?: string | null; model?: string | null },
): Promise<string> {
  const apiKey = options?.apiKey?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    throw new GeminiError('Clave de API para IA no configurada', 'config');
  }
  const model = options?.model?.trim() || GEMINI_DEFAULT_MODEL;

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: visionMaxOutputTokens(),
      responseMimeType: 'application/json',
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new GeminiError(
        'Tiempo de espera agotado al procesar con IA. Intent├í con un archivo m├ís liviano.',
        'timeout',
      );
    }
    throw new GeminiError((e as Error).message, 'http');
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  if (!response.ok) {
    const parsed = parseGeminiErrorPayload(rawText);
    const msg = parsed ?? rawText.slice(0, 500);
    if (response.status === 400 && /API key/i.test(msg)) {
      throw new GeminiError('Clave de API de IA inv├ílida o rechazada.', 'api_key');
    }
    if (response.status === 403 || response.status === 401) {
      throw new GeminiError('No autorizado ante el servicio de IA (revis├í la API key).', 'api_key');
    }
    throw new GeminiError(`Error del servicio de IA (${response.status}): ${msg}`, 'http');
  }

  let data: GeminiResponse;
  try {
    data = JSON.parse(rawText) as GeminiResponse;
  } catch {
    throw new GeminiError('La respuesta del servicio de IA no es JSON v├ílido', 'parse');
  }

  if (data.error?.message) {
    throw new GeminiError(data.error.message, 'api_key');
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) {
    throw new GeminiError('La IA no devolvi├│ contenido', 'empty');
  }
  return text;
}
