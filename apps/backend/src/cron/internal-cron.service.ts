import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalCronService {
  private readonly logger = new Logger(InternalCronService.name);

  constructor(private readonly config: ConfigService) {}

  private resolveBaseUrl(): string | null {
    const appUrl = (this.config.get<string>('APP_URL') ?? '').trim();
    if (appUrl) return appUrl.replace(/\/$/, '');

    const port = this.config.get<number>('PORT', 4000);
    return `http://localhost:${port}`;
  }

  async trigger(pathWithLeadingSlash: string, options?: { wait?: boolean }): Promise<void> {
    const secret = (this.config.get<string>('CRON_SECRET') ?? '').trim();
    if (!secret) return;

    const base = this.resolveBaseUrl();
    if (!base) return;

    const path = pathWithLeadingSlash.startsWith('/')
      ? pathWithLeadingSlash
      : `/${pathWithLeadingSlash}`;
    const url = `${base}/api/v1${path}`;

    const run = async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`[internal-cron] ${path} ${res.status} ${text.slice(0, 200)}`);
      }
    };

    if (options?.wait) {
      await run().catch((e) =>
        this.logger.error(`[internal-cron] ${path} ${(e as Error).message}`),
      );
      return;
    }

    void run().catch((e) =>
      this.logger.error(`[internal-cron] ${path} ${(e as Error).message}`),
    );
  }
}
