import type { OutgoingHttpHeaders } from 'http';
import https from 'https';
import { URL } from 'url';

function flattenHeaders(h: globalThis.RequestInit['headers'] | undefined): OutgoingHttpHeaders {
  if (!h) return {};
  if (h instanceof globalThis.Headers) {
    const o: OutgoingHttpHeaders = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }
  if (Array.isArray(h)) {
    const o: OutgoingHttpHeaders = {};
    for (const [k, v] of h) o[k] = v;
    return o;
  }
  return { ...h };
}

export interface AfipHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

/** OpenSSL 3 con SECLEVEL=2 (p. ej. Node 24+) rechaza DH 1024 antes de que aplique `minDHSize`. */
const AFIP_TLS_CIPHERS = 'DEFAULT@SECLEVEL=1';

/**
 * POST por HTTPS a WSAA/WSFE: `https.request` nativo con opciones TLS solo para AFIP.
 * Combina SECLEVEL=1 (OpenSSL acepta DH legacy) y `minDHSize` (capa Node).
 */
export function afipHttpsPost(
  fullUrl: string,
  init: {
    method?: string;
    headers?: globalThis.RequestInit['headers'];
    body?: globalThis.RequestInit['body'] | null;
    signal?: globalThis.RequestInit['signal'];
  },
): Promise<AfipHttpResponse> {
  const u = new URL(fullUrl);
  if (u.protocol !== 'https:') {
    return Promise.reject(
      new TypeError(`afipHttpsPost: solo se admite https; recibió ${u.protocol}`),
    );
  }

  return new Promise((resolve, reject) => {
    const bodyRaw = init.body;
    let body: string | Buffer = '';
    if (bodyRaw != null) {
      if (typeof bodyRaw === 'string') {
        body = bodyRaw;
      } else if (Buffer.isBuffer(bodyRaw)) {
        body = bodyRaw;
      } else {
        reject(
          new TypeError('afipHttpsPost: el body de la petición debe ser string o Buffer'),
        );
        return;
      }
    }

    const headers = flattenHeaders(init.headers);
    // `minDHSize` + `ciphers` @SECLEVEL: lo que típicamente impide "dh key too small"
    // con OpenSSL 3 hacia servidores con DHE 1024 (AFIP) es el SECLEVEL, no solo minDHSize.
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: init.method ?? 'POST',
      headers,
      ciphers: AFIP_TLS_CIPHERS,
      minDHSize: 512,
    } as https.RequestOptions & { minDHSize: number };

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        settle(() =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            text: () => Promise.resolve(bodyStr),
          }),
        );
      });
      res.on('error', (err) => settle(() => reject(err)));
    });

    if (init.signal) {
      if (init.signal.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        settle(() => reject(err));
        return;
      }
      const onAbort = () => {
        req.destroy();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        settle(() => reject(err));
      };
      init.signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (err) => settle(() => reject(err)));
    /**
     * Sockets TLS de AFIP a veces emiten `ECONNRESET` después de que `req.destroy()`
     * por timeout/abort cierra la request. Si la promesa ya está resuelta/rechazada,
     * ese `error` rebota como `uncaughtException` y ensucia los logs. Con un noop
     * tras settled=true Node lo considera "manejado".
     */
    req.on('socket', (socket) => {
      socket.on('error', () => {
        if (!settled) return;
      });
    });
    if (body.length) {
      req.write(body);
    }
    req.end();
  });
}
