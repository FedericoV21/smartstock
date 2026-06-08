/**
 * Reintento ARCA: delega en el endpoint de la app (`/api/cron/reintentar-arca`) para reutilizar
 * `solicitarCaeYAsignarNumero` (WSFE + lock) en un solo lugar.
 *
 * Requiere secretos: CRON_APP_BASE_URL (URL pública de la app), CRON_SECRET (mismo que en Vercel).
 * Si no está CRON_APP_BASE_URL, responde 503 (configurar o usar cron de Vercel u otro scheduler).
 */
Deno.serve(async (req) => {
  const base = Deno.env.get('CRON_APP_BASE_URL')?.replace(/\/$/, '');
  const secret = Deno.env.get('CRON_SECRET');
  if (!base || !secret) {
    return new Response(
      JSON.stringify({
        error:
          'Configurá CRON_APP_BASE_URL y CRON_SECRET en Supabase Edge Functions, o usá un cron que llame a /api/cron/reintentar-arca en la app.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const r = await fetch(`${base}/api/cron/reintentar-arca`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
