const WSFE_RETRY_STATUS = new Set([502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backoffBeforeRetry(attemptIndex: number): Promise<void> {
  const baseMs = 1000 * 2 ** (attemptIndex - 1);
  const jitterMs = Math.floor(Math.random() * 400);
  await sleep(Math.min(baseMs + jitterMs, 10_000));
}

/** Errores de red / TLS / DNS que suelen ser transitorios ante AFIP u operadores. */
function isRetryableNetworkError(err: unknown): boolean {
  let current: unknown = err;
  let depth = 0;
  while (current && depth < 12) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      if (
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNREFUSED' ||
        code === 'EPIPE' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN'
      ) {
        return true;
      }
      if (current.name === 'AbortError') {
        return true;
      }
    }
    const next =
      current instanceof Error && current.cause !== undefined ? current.cause : null;
    if (next === undefined || next === null) break;
    current = next;
    depth++;
  }
  return false;
}

/**
 * POST a WSFE con reintentos ante:
 * - Respuestas 502/503/504 (gateway AFIP)
 * - Fallos de red transitorios (ECONNRESET, timeout, etc.) antes de recibir respuesta HTTP
 */
export async function fetchWsfePost(
  url: string,
  init: RequestInit,
  options?: { maxAttempts?: number },
): Promise<Response> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  let lastResponse: Response | null = null;
  let lastNetworkError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      lastResponse = response;

      if (response.ok) {
        return response;
      }

      const retryableHttp = WSFE_RETRY_STATUS.has(response.status);
      if (retryableHttp && attempt < maxAttempts) {
        await response.text().catch(() => {});
        await backoffBeforeRetry(attempt);
        continue;
      }

      return response;
    } catch (err) {
      lastNetworkError = err;
      if (isRetryableNetworkError(err) && attempt < maxAttempts) {
        await backoffBeforeRetry(attempt);
        continue;
      }
      throw err;
    }
  }

  if (lastNetworkError) {
    throw lastNetworkError;
  }
  return lastResponse!;
}
