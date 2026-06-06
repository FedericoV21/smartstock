import { GeminiError } from './gemini';

export type VisionIaErrorCode = 'config' | 'api_key' | 'timeout' | 'http' | 'empty' | 'parse';

export type VisionIaAttempt = {
  provider: 'openrouter' | 'gemini';
  model: string;
  ok: boolean;
  error?: string;
};

export class VisionIAError extends Error {
  readonly httpStatus?: number;
  readonly attempts?: VisionIaAttempt[];

  constructor(
    message: string,
    readonly code: VisionIaErrorCode,
    options?: { attempts?: VisionIaAttempt[]; httpStatus?: number },
  ) {
    super(message);
    this.name = 'VisionIAError';
    this.httpStatus = options?.httpStatus;
    this.attempts = options?.attempts;
  }
}

export function esErrorExtraccionVisionIA(e: unknown): e is GeminiError | VisionIAError {
  return e instanceof GeminiError || e instanceof VisionIAError;
}
