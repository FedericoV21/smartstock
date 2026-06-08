import { GeminiError, llamarGemini } from '@/lib/ia/gemini';
import { llamarOpenRouterModel, resolverOpenRouterApiKey } from '@/lib/ia/openrouter';
import { VisionIAError, type VisionIaAttempt } from '@/lib/ia/vision-ia-error';

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-pro';

export type VisionExtraccionMeta = {
  provider: 'openrouter' | 'gemini';
  model: string;
  attempts: VisionIaAttempt[];
};

export type VisionProviderConfig = {
  primary?: string | null;
  openRouterApiKey?: string | null;
  openRouterModels?: string | string[] | null;
  openRouterPdfEngine?: string | null;
  openRouterHttpReferer?: string | null;
  openRouterAppTitle?: string | null;
  geminiApiKey?: string | null;
  geminiModel?: string | null;
};

function parseOpenRouterModelsList(rawConfig?: string | string[] | null): string[] {
  if (Array.isArray(rawConfig)) {
    return rawConfig.map((s) => s.trim()).filter(Boolean);
  }
  const raw = rawConfig ?? process.env.OPEN_ROUTER_MODELS ?? '';
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function recoverableHttp(status: number | undefined, message: string): boolean {
  if (status === 429) return true;
  if (status != null && status >= 500) return true;
  if (status === 404) return true;
  if (status === 400) {
    return /model|overload|capacity|context|too long|unavailable|rate|busy|quota|token|length|invalid/i.test(
      message,
    ) || /provider returned error/i.test(message);
  }
  return status == null;
}

function recoverableVisionIAError(e: VisionIAError): boolean {
  if (e.code === 'api_key' || e.code === 'config') return false;
  if (e.code === 'timeout' || e.code === 'empty' || e.code === 'parse') return true;
  if (e.code === 'http') return recoverableHttp(e.httpStatus, e.message);
  return false;
}

function toVisionIAFromGemini(e: GeminiError, attempts: VisionIaAttempt[]): VisionIAError {
  return new VisionIAError(e.message, e.code, { attempts });
}

/**
 * Extracción JSON desde PDF/imagen: cadena de modelos Open Router y red final con Gemini.
 * Variables: `OPEN_ROUTER_API_KEY`, `OPEN_ROUTER_MODELS`, `GEMINI_API_KEY`, `IA_VISION_PRIMARY` (openrouter | gemini | auto).
 */
export async function llamarVisionExtraccionJson(
  prompt: string,
  archivo: { base64: string; mimeType: string },
  opts?: { fileName?: string; config?: VisionProviderConfig },
): Promise<{ text: string; meta: VisionExtraccionMeta }> {
  const attempts: VisionIaAttempt[] = [];
  const config = opts?.config;
  const primary = (config?.primary ?? process.env.IA_VISION_PRIMARY)?.trim().toLowerCase();
  const models = parseOpenRouterModelsList(config?.openRouterModels);
  const orKey = resolverOpenRouterApiKey(config?.openRouterApiKey);
  const geminiKey = config?.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  const geminiModel = config?.geminiModel?.trim() || GEMINI_DEFAULT_MODEL;
  const geminiLabel = `google-${geminiModel}`;

  const runOpenRouterChain = async (): Promise<{ text: string; model: string } | null> => {
    if (!orKey || models.length === 0) return null;
    for (const model of models) {
      try {
        const text = await llamarOpenRouterModel(prompt, archivo, model, {
          fileName: opts?.fileName,
          apiKey: orKey,
          pdfEngine: config?.openRouterPdfEngine,
          httpReferer: config?.openRouterHttpReferer,
          appTitle: config?.openRouterAppTitle,
        });
        attempts.push({ provider: 'openrouter', model, ok: true });
        return { text, model };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof VisionIAError && (e.code === 'api_key' || e.code === 'config')) {
          attempts.push({ provider: 'openrouter', model, ok: false, error: msg });
          throw new VisionIAError(e.message, e.code, { attempts, httpStatus: e.httpStatus });
        }
        attempts.push({ provider: 'openrouter', model, ok: false, error: msg });
        if (e instanceof VisionIAError && recoverableVisionIAError(e)) {
          continue;
        }
        if (e instanceof VisionIAError) {
          throw new VisionIAError(e.message, e.code, { attempts, httpStatus: e.httpStatus });
        }
        throw new VisionIAError(msg, 'http', { attempts });
      }
    }
    return null;
  };

  const runGemini = async (): Promise<{ text: string; model: string }> => {
    if (!geminiKey) {
      throw new VisionIAError('GEMINI_API_KEY no configurada', 'config', { attempts });
    }
    try {
      const text = await llamarGemini(prompt, archivo, { apiKey: geminiKey, model: geminiModel });
      attempts.push({ provider: 'gemini', model: geminiLabel, ok: true });
      return { text, model: geminiLabel };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ provider: 'gemini', model: geminiLabel, ok: false, error: msg });
      if (e instanceof GeminiError) throw e;
      throw new VisionIAError(msg, 'http', { attempts });
    }
  };

  if (primary === 'gemini') {
    try {
      const r = await runGemini();
      return { text: r.text, meta: { provider: 'gemini', model: r.model, attempts } };
    } catch (e) {
      if (e instanceof GeminiError) throw toVisionIAFromGemini(e, attempts);
      throw e;
    }
  }

  const orFirst =
    primary === 'openrouter' ||
    ((primary === '' || primary === 'auto' || primary == null) && Boolean(orKey && models.length > 0));

  if (primary === 'openrouter') {
    if (!orKey) {
      throw new VisionIAError('OPEN_ROUTER_API_KEY no configurada', 'config', { attempts });
    }
    if (models.length === 0) {
      throw new VisionIAError('OPEN_ROUTER_MODELS está vacía', 'config', { attempts });
    }
  }

  if (orFirst) {
    const orResult = await runOpenRouterChain();
    if (orResult) {
      return {
        text: orResult.text,
        meta: { provider: 'openrouter', model: orResult.model, attempts },
      };
    }
    if (geminiKey) {
      try {
        const r = await runGemini();
        return { text: r.text, meta: { provider: 'gemini', model: r.model, attempts } };
      } catch (e) {
        if (e instanceof GeminiError) throw toVisionIAFromGemini(e, attempts);
        throw e;
      }
    }
    throw new VisionIAError(
      'No hay proveedor de IA disponible: configurá OPEN_ROUTER_MODELS y GEMINI_API_KEY, o al menos uno con modelos.',
      'config',
      { attempts },
    );
  }

  try {
    const r = await runGemini();
    return { text: r.text, meta: { provider: 'gemini', model: r.model, attempts } };
  } catch (e) {
    if (e instanceof GeminiError) throw toVisionIAFromGemini(e, attempts);
    if (e instanceof VisionIAError) throw e;
    throw new VisionIAError((e as Error).message, 'http', { attempts });
  }
}
