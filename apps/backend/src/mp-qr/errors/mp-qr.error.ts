export class MpQrError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'MpQrError';
  }
}
