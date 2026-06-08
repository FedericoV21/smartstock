import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const llamarOpenRouterModel = vi.fn();
const llamarGemini = vi.fn();

vi.mock('@/lib/ia/openrouter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ia/openrouter')>('@/lib/ia/openrouter');
  return {
    ...actual,
    llamarOpenRouterModel: (
      prompt: string,
      archivo: { base64: string; mimeType: string },
      model: string,
      opts?: { fileName?: string },
    ) => llamarOpenRouterModel(prompt, archivo, model, opts),
  };
});

vi.mock('@/lib/ia/gemini', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ia/gemini')>('@/lib/ia/gemini');
  return {
    ...actual,
    llamarGemini: (
      prompt: string,
      archivo: { base64: string; mimeType: string },
      options?: { apiKey?: string | null; model?: string | null },
    ) => llamarGemini(prompt, archivo, options),
  };
});

import { GeminiError } from '@/lib/ia/gemini';
import { VisionIAError } from '@/lib/ia/vision-ia-error';
import { llamarVisionExtraccionJson } from '@/lib/ia/vision-extraccion';

describe('llamarVisionExtraccionJson', () => {
  const archivo = { base64: 'AAA', mimeType: 'image/png' as const };

  beforeEach(() => {
    llamarOpenRouterModel.mockReset();
    llamarGemini.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prueba el segundo modelo Open Router si el primero falla de forma recuperable', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'openrouter');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k');
    vi.stubEnv('OPEN_ROUTER_MODELS', 'model/a,model/b');
    vi.stubEnv('GEMINI_API_KEY', 'g');

    llamarOpenRouterModel
      .mockRejectedValueOnce(new VisionIAError('empty', 'empty'))
      .mockResolvedValueOnce('{"ok":true}');

    const r = await llamarVisionExtraccionJson('prompt', archivo);
    expect(r.text).toBe('{"ok":true}');
    expect(r.meta.provider).toBe('openrouter');
    expect(r.meta.model).toBe('model/b');
    expect(llamarOpenRouterModel).toHaveBeenCalledTimes(2);
    expect(llamarGemini).not.toHaveBeenCalled();
    expect(r.meta.attempts.filter((a) => a.provider === 'openrouter' && !a.ok)).toHaveLength(1);
  });

  it('cae a Gemini si la cadena Open Router se agota', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'openrouter');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k');
    vi.stubEnv('OPEN_ROUTER_MODELS', 'model/a');
    vi.stubEnv('GEMINI_API_KEY', 'g');

    llamarOpenRouterModel.mockRejectedValue(new VisionIAError('empty', 'empty'));
    llamarGemini.mockResolvedValue('{"gemini":1}');

    const r = await llamarVisionExtraccionJson('p', archivo);
    expect(r.text).toBe('{"gemini":1}');
    expect(r.meta.provider).toBe('gemini');
    expect(llamarGemini).toHaveBeenCalledTimes(1);
  });

  it('trata Provider returned error de Open Router como recuperable y cae a Gemini', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'openrouter');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k');
    vi.stubEnv('OPEN_ROUTER_MODELS', 'model/a');
    vi.stubEnv('GEMINI_API_KEY', 'g');

    llamarOpenRouterModel.mockRejectedValue(
      new VisionIAError('Open Router (400): Provider returned error', 'http', { httpStatus: 400 }),
    );
    llamarGemini.mockResolvedValue('{"gemini":true}');

    const r = await llamarVisionExtraccionJson('p', archivo);
    expect(r.text).toBe('{"gemini":true}');
    expect(r.meta.provider).toBe('gemini');
    expect(r.meta.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'openrouter', ok: false }),
        expect.objectContaining({ provider: 'gemini', ok: true }),
      ]),
    );
  });

  it('no prueba otro modelo si Open Router devuelve api_key', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'openrouter');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k');
    vi.stubEnv('OPEN_ROUTER_MODELS', 'model/a,model/b');
    vi.stubEnv('GEMINI_API_KEY', 'g');

    llamarOpenRouterModel.mockRejectedValue(new VisionIAError('no auth', 'api_key'));

    await expect(llamarVisionExtraccionJson('p', archivo)).rejects.toMatchObject({ code: 'api_key' });
    expect(llamarOpenRouterModel).toHaveBeenCalledTimes(1);
    expect(llamarGemini).not.toHaveBeenCalled();
  });

  it('con IA_VISION_PRIMARY=gemini solo usa Gemini', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'gemini');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k');
    vi.stubEnv('OPEN_ROUTER_MODELS', 'model/a');
    vi.stubEnv('GEMINI_API_KEY', 'g');
    llamarGemini.mockResolvedValue('{}');

    await llamarVisionExtraccionJson('p', archivo);
    expect(llamarGemini).toHaveBeenCalledTimes(1);
    expect(llamarOpenRouterModel).not.toHaveBeenCalled();
  });

  it('permite config dedicada por llamada sin cambiar env global', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'openrouter');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k-global');
    vi.stubEnv('OPEN_ROUTER_MODELS', 'model/global');
    vi.stubEnv('GEMINI_API_KEY', 'g-global');
    llamarGemini.mockResolvedValue('{}');

    const r = await llamarVisionExtraccionJson('p', archivo, {
      config: {
        primary: 'gemini',
        geminiApiKey: 'g-extractor',
        geminiModel: 'gemini-2.5-flash',
      },
    });

    expect(r.meta.provider).toBe('gemini');
    expect(r.meta.model).toBe('google-gemini-2.5-flash');
    expect(llamarGemini).toHaveBeenCalledWith(
      'p',
      archivo,
      expect.objectContaining({ apiKey: 'g-extractor', model: 'gemini-2.5-flash' }),
    );
    expect(llamarOpenRouterModel).not.toHaveBeenCalled();
  });

  it('sin modelos OR (auto) usa solo Gemini aunque exista API key', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'g');
    vi.stubEnv('OPEN_ROUTER_API_KEY', 'k');
    vi.stubEnv('OPEN_ROUTER_MODELS', '');
    llamarGemini.mockResolvedValue('{}');

    const r = await llamarVisionExtraccionJson('p', archivo);
    expect(r.meta.provider).toBe('gemini');
    expect(llamarOpenRouterModel).not.toHaveBeenCalled();
  });

  it('propaga error de Gemini como VisionIAError con intentos', async () => {
    vi.stubEnv('IA_VISION_PRIMARY', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'g');
    llamarGemini.mockRejectedValue(new GeminiError('fallo', 'http'));

    await expect(llamarVisionExtraccionJson('p', archivo)).rejects.toMatchObject({
      code: 'http',
      attempts: expect.arrayContaining([expect.objectContaining({ provider: 'gemini', ok: false })]),
    });
  });
});
