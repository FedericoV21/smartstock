import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export function canalComprobanteMpQr(comprobanteId: string): string {
  return `comprobante-${comprobanteId}`;
}

export async function broadcastMpQrEvent(
  comprobanteId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!getSupabaseServiceRoleKey()) {
    console.error('[mp-qr] SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY no configurada; no se broadcastea Realtime');
    return;
  }

  const supabase = createServiceRoleClient();
  const name = canalComprobanteMpQr(comprobanteId);
  const channel = supabase.channel(name, {
    config: { private: true, broadcast: { self: true } },
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      void supabase.removeChannel(channel);
      reject(new Error('Realtime subscribe timeout'));
    }, 8000);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        void Promise.resolve(
          channel.send({
            type: 'broadcast',
            event: 'mp_qr',
            payload,
          }),
        )
          .then(() => {
            void supabase.removeChannel(channel);
            resolve();
          })
          .catch((e) => {
            void supabase.removeChannel(channel);
            reject(e instanceof Error ? e : new Error(String(e)));
          });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(t);
        void supabase.removeChannel(channel);
        reject(new Error(`Realtime ${status}`));
      }
    });
  }).catch((e) => {
    console.error('[mp-qr] broadcast:', e);
  });
}
