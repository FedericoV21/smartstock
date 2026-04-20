import { createServiceRoleClient } from '@/lib/supabase/server';

/** Canal usado por el POS (MP-011): `comprobante-{uuid}`. */
export function canalComprobanteMpPoint(comprobanteId: string): string {
  return `comprobante-${comprobanteId}`;
}

/**
 * Emite un evento broadcast en el canal del comprobante (Realtime).
 * Requiere `SUPABASE_SERVICE_ROLE_KEY` en el servidor.
 */
export async function broadcastMpPointEvent(
  comprobanteId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[mp-point] SUPABASE_SERVICE_ROLE_KEY no configurada; no se broadcastea Realtime');
    return;
  }

  const supabase = createServiceRoleClient();
  const name = canalComprobanteMpPoint(comprobanteId);
  const channel = supabase.channel(name, {
    config: { broadcast: { self: true } },
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
            event: 'mp_point',
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
    console.error('[mp-point] broadcast:', e);
  });
}
