import { Logger } from '@nestjs/common';

import { MpPointError } from '../errors/mp-point.error';

export const MP_POINT_API_BASE = 'https://api.mercadopago.com/point/integration-api';

const logger = new Logger('MpPointApiClient');

export type MpFetch = typeof fetch;

export function parseMpErrorBody(status: number, text: string): { code: string; message: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { code: `http_${status}`, message: `HTTP ${status}` };
  }
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const message =
      (typeof j.message === 'string' && j.message) ||
      (typeof j.cause === 'string' && j.cause) ||
      (typeof j.error === 'string' && j.error) ||
      trimmed.slice(0, 2000);
    const code =
      (typeof j.code === 'string' && j.code) ||
      (typeof j.error === 'string' && j.error) ||
      `http_${status}`;
    return { code, message: String(message) };
  } catch {
    return { code: `http_${status}`, message: trimmed.slice(0, 2000) };
  }
}

export async function throwIfMpNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  const { code, message } = parseMpErrorBody(res.status, text);
  logger.warn(`MP Point API ${res.status} ${code}: ${message}`);
  throw new MpPointError(res.status, code, message, text.slice(0, 2000));
}

export function mpPointJsonHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}
