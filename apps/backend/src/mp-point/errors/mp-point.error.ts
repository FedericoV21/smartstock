/** Error tipado de la API Mercado Pago Point (paridad front `MpPointError`). */
export class MpPointError extends Error {
  readonly name = 'MpPointError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly bodySnippet?: string,
  ) {
    super(message);
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  get isStandaloneMode(): boolean {
    return (
      this.status === 422 &&
      (this.code.toLowerCase().includes('operating_mode') ||
        this.message.toLowerCase().includes('standalone') ||
        this.message.toLowerCase().includes('pdv'))
    );
  }

  get isDeviceOffline(): boolean {
    return this.status === 503 || this.code.toLowerCase().includes('device_offline');
  }
}
