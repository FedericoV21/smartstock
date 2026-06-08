import { buildPublicAppAbsoluteUrl } from '@/lib/supabase/env-keys';

/**
 * Dispara un endpoint de cron interno (misma app, CRON_SECRET).
 * No bloquea la respuesta al cliente si wait === false.
 */
export async function postInternalCron(
  pathWithLeadingSlash: string,
  options?: { wait?: boolean },
): Promise<void> {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret) return;

  const url = buildPublicAppAbsoluteUrl(pathWithLeadingSlash);
  if (!url) return;

  const run = async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.error('[internal-cron]', pathWithLeadingSlash, res.status, await res.text().catch(() => ''));
    }
  };

  if (options?.wait) {
    await run().catch((e) => console.error('[internal-cron]', pathWithLeadingSlash, (e as Error).message));
    return;
  }

  void run().catch((e) => console.error('[internal-cron]', pathWithLeadingSlash, (e as Error).message));
}
