'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { Input } from '@/components/ui/input';
import type { MpQrVerificacionCheck, MpQrVerificacionResult } from '@/types/mp-qr';

type MpQrGet = {
  habilitado: boolean;
  user_id: string | null;
  external_pos_id: string | null;
  access_token_configurado: boolean;
  access_token_preview: string | null;
  webhook_secret_configurado: boolean;
};

const CHECK_KEYS = [
  { key: 'token_valido' as const, label: '1. Token de acceso' },
  { key: 'user_id_coincide' as const, label: '2. User ID' },
  { key: 'caja_existe' as const, label: '3. Caja (POS / QR)' },
  { key: 'cobro_de_prueba' as const, label: '4. Cobro de prueba ($1)' },
];

function iconoCheck(c: MpQrVerificacionCheck): string {
  if (c.mensaje.includes('No ejecutado')) return '⏳';
  return c.ok ? '✅' : '❌';
}

export function MpQrConfigSection(props?: { onDirtyChange?: (dirty: boolean) => void }) {
  const { onDirtyChange } = props ?? {};
  const { confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [server, setServer] = useState<MpQrGet | null>(null);

  const [habilitado, setHabilitado] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [userId, setUserId] = useState('');
  const [externalPosId, setExternalPosId] = useState('');

  const [msgOk, setMsgOk] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  const [verificacionResult, setVerificacionResult] = useState<MpQrVerificacionResult | null>(null);

  const resetVerificacion = useCallback(() => {
    setVerificacionResult(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMsgErr(null);
    setVerificacionResult(null);
    try {
      const res = await fetch('/api/configuracion/mp-qr');
      const j = await res.json();
      if (!res.ok) {
        setMsgErr(j.error ?? 'Error al cargar');
        setServer(null);
      } else {
        setServer(j as MpQrGet);
        setHabilitado(Boolean(j.habilitado));
        setUserId(typeof j.user_id === 'string' ? j.user_id : '');
        setExternalPosId(typeof j.external_pos_id === 'string' ? j.external_pos_id : '');
      }
    } catch {
      setMsgErr('Error de red');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!onDirtyChange) return;
    const dirty =
      !loading &&
      server != null &&
      (habilitado !== !!server.habilitado ||
        (userId || '') !== (server.user_id ?? '') ||
        (externalPosId || '') !== (server.external_pos_id ?? '') ||
        accessToken.trim() !== '' ||
        webhookSecret.trim() !== '' ||
        verificacionResult != null);
    onDirtyChange(dirty);
  }, [
    onDirtyChange,
    loading,
    server,
    habilitado,
    userId,
    externalPosId,
    accessToken,
    webhookSecret,
    verificacionResult,
  ]);

  const hayConfigPersistida = Boolean(
    server?.access_token_configurado ||
      (server?.user_id && String(server.user_id).trim()) ||
      (server?.external_pos_id && String(server.external_pos_id).trim()) ||
      server?.webhook_secret_configurado,
  );

  const guardarDeshabilitado =
    saving || eliminando || (habilitado && verificacionResult?.ok !== true);

  async function verificarConfiguracionCompleta() {
    if (!String(userId).trim() || !String(externalPosId).trim()) {
      setMsgErr('Completá User ID e ID de caja antes de verificar.');
      return;
    }
    if (!accessToken.trim() && !server?.access_token_configurado) {
      setMsgErr('Pegá el access token o guardá uno antes (no hay token en el servidor).');
      return;
    }
    setVerifying(true);
    setMsgErr(null);
    setMsgOk(null);
    setVerificacionResult(null);
    try {
      const body: Record<string, string | undefined> = {
        user_id: userId.trim(),
        external_pos_id: externalPosId.trim(),
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();

      const res = await fetch('/api/pagos/mp-qr/verificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as MpQrVerificacionResult & { error?: string };
      if (!res.ok) {
        setMsgErr(typeof j.error === 'string' ? j.error : 'No se pudo verificar');
        setVerifying(false);
        return;
      }
      if ('checks' in j && j.checks) {
        setVerificacionResult(j as MpQrVerificacionResult);
        if (j.ok) {
          setMsgOk('Configuración verificada: podés guardar con el cobro QR activado.');
        } else {
          setMsgOk(null);
        }
      } else {
        setMsgErr('Respuesta inválida del servidor');
      }
    } catch {
      setMsgErr('Error de red');
    }
    setVerifying(false);
  }

  async function guardar() {
    setSaving(true);
    setMsgErr(null);
    setMsgOk(null);
    if (habilitado && (!String(userId).trim() || !String(externalPosId).trim())) {
      setMsgErr('Con el cobro QR activado necesitás User ID e ID de caja (external_pos_id).');
      setSaving(false);
      return;
    }
    if (habilitado && verificacionResult?.ok !== true) {
      setMsgErr('Verificá la configuración completa antes de guardar con el módulo activado.');
      setSaving(false);
      return;
    }
    try {
      const body: Record<string, unknown> = {
        habilitado,
        user_id: userId.trim() || null,
        external_pos_id: externalPosId.trim() || null,
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();
      if (webhookSecret.trim()) body.webhook_secret = webhookSecret.trim();

      const res = await fetch('/api/configuracion/mp-qr', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsgErr(j.error ?? 'Error al guardar');
      } else {
        setMsgOk('Configuración guardada');
        setAccessToken('');
        setWebhookSecret('');
        setVerificacionResult(null);
        await load();
      }
    } catch {
      setMsgErr('Error de red');
    }
    setSaving(false);
  }

  async function eliminarConfiguracion() {
    const ok = await confirm({
      title: 'Eliminar configuración QR',
      description:
        '¿Eliminar por completo la configuración de Mercado Pago QR para esta sucursal? Se borran token, User ID, ID de caja y secret del webhook en Nexus. Vas a tener que cargarlos de nuevo para cobrar con QR.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    setEliminando(true);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const res = await fetch('/api/configuracion/mp-qr', { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) {
        setMsgErr(typeof j.error === 'string' ? j.error : 'No se pudo eliminar');
      } else {
        setMsgOk('Configuración de QR eliminada');
        setAccessToken('');
        setWebhookSecret('');
        setVerificacionResult(null);
        await load();
      }
    } catch {
      setMsgErr('Error de red');
    }
    setEliminando(false);
  }

  if (loading) {
    return (
      <>
        {ConfirmDialog}
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Cargando Mercado Pago QR…</p>
        </section>
      </>
    );
  }

  return (
    <>
      {ConfirmDialog}
      <section className="rounded-xl border bg-card p-5 shadow-sm mt-6">
      <h2 className="font-medium mb-1">Mercado Pago QR</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Cobrá con el QR estático del mostrador (misma cuenta que Checkout/Point si querés). Token y ayuda en{' '}
        <a
          href="https://www.mercadopago.com.ar/developers/es/docs/getting-started"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Mercado Pago Developers
        </a>
        . Podés registrar en MP Developers la URL base{' '}
        <code className="rounded bg-muted px-1 text-xs">/api/pagos/mp-qr/webhook</code>: al iniciar un cobro, Nexus
        envía a MP una <code className="rounded bg-muted px-1 text-xs">notification_url</code> con el{' '}
        <code className="rounded bg-muted px-1 text-xs">tenant_id</code> para validar la firma del webhook.
      </p>

      {msgOk ? (
        <p className="mb-3 text-sm text-green-600 dark:text-green-400" role="status">
          {msgOk}
        </p>
      ) : null}
      {msgErr ? (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {msgErr}
        </p>
      ) : null}

      <label className="flex items-center gap-3 text-sm mb-4">
        <input
          type="checkbox"
          checked={habilitado}
          onChange={(e) => {
            const nextChecked = e.currentTarget.checked;
            void (async () => {
              if (!nextChecked && habilitado) {
                const ok = await confirm({
                  title: 'Desactivar QR',
                  description:
                    '¿Desactivar Mercado Pago QR? Si hay una venta esperando pago, puede quedar colgada.',
                  confirmLabel: 'Desactivar',
                  cancelLabel: 'Cancelar',
                  confirmVariant: 'destructive',
                });
                if (!ok) return;
              }
              resetVerificacion();
              setHabilitado(nextChecked);
            })();
          }}
          className="size-4 rounded border-input"
        />
        Habilitar cobro con QR estático en el POS
      </label>

      <div className="grid gap-4 max-w-xl">
        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Access token (producción)</span>
          <div className="flex gap-2">
            <Input
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              value={accessToken}
              onChange={(e) => {
                resetVerificacion();
                setAccessToken(e.target.value);
              }}
              placeholder={
                server?.access_token_configurado
                  ? `Token guardado (${server.access_token_preview ?? '****'})`
                  : 'Pegá el token de la app'
              }
              className="font-mono text-sm"
            />
            <Button type="button" variant="outline" onClick={() => setShowToken((v) => !v)}>
              {showToken ? 'Ocultar' : 'Mostrar'}
            </Button>
          </div>
        </div>

        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">User ID (collector)</span>
          <Input
            value={userId}
            onChange={(e) => {
              resetVerificacion();
              setUserId(e.target.value);
            }}
            placeholder="123456789"
            className="font-mono text-sm"
          />
        </div>

        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">ID de la caja (external_pos_id)</span>
          <Input
            value={externalPosId}
            onChange={(e) => {
              resetVerificacion();
              setExternalPosId(e.target.value);
            }}
            placeholder="CAJA01"
            className="font-mono text-sm"
            title="Es el ID de la caja en tu panel de Mercado Pago. Es el mismo identificador que está codificado en el QR físico del mostrador."
          />
          <p className="text-xs text-muted-foreground">
            Tiene que coincidir con <code className="rounded bg-muted px-1">external_id</code> de la caja en MP (si la
            creaste solo desde el panel web, puede venir vacío: en ese caso creá una caja vía API con external_id, ver
            documentación del proyecto).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={verifying}
            onClick={() => void verificarConfiguracionCompleta()}
          >
            {verifying ? 'Verificando…' : 'Verificar configuración completa'}
          </Button>
        </div>

        {verifying ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Consultando Mercado Pago (token, cajas y cobro de prueba)…
          </p>
        ) : null}

        {verificacionResult ? (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <p className="text-sm font-medium">Resultados de la verificación</p>
            <ul className="space-y-3 text-sm">
              {CHECK_KEYS.map(({ key, label }) => {
                const c = verificacionResult.checks[key];
                const pendiente = c.mensaje.includes('No ejecutado');
                return (
                  <li key={key} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <div className="flex gap-2 items-start">
                      <span className="shrink-0 pt-0.5" aria-hidden>
                        {iconoCheck(c)}
                      </span>
                      <div className={`min-w-0 flex-1 ${pendiente ? 'opacity-60' : ''}`}>
                        <p className="font-medium text-foreground">{label}</p>
                        <p className="text-muted-foreground whitespace-pre-line break-words">{c.mensaje}</p>
                        {c.sugerencia ? (
                          <p className="mt-1 text-amber-800 dark:text-amber-200 text-xs whitespace-pre-line">
                            💡 {c.sugerencia}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Webhook secret (firma)</span>
          <Input
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={(e) => {
              resetVerificacion();
              setWebhookSecret(e.target.value);
            }}
            placeholder={
              server?.webhook_secret_configurado
                ? 'Secret ya guardado (pegá uno nuevo para reemplazar)'
                : 'Secret del panel de webhooks'
            }
            className="font-mono text-sm"
            title="Si ya usás el mismo secret que MP Point, podés repetirlo acá."
          />
        </div>

        <details className="rounded-lg border bg-muted/20 p-3 text-sm">
          <summary className="cursor-pointer font-medium">¿Cómo configurar mi QR estático?</summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-muted-foreground">
            <li>Crear caja en panel MP → Tu negocio → Cajas y sucursales → Crear caja.</li>
            <li>Anotar el ID de la caja (external_pos_id).</li>
            <li>Imprimir el QR de la caja (PDF desde el panel).</li>
            <li>Pegar el QR en el mostrador.</li>
            <li>Completar token, user ID y caja en esta pantalla y guardar.</li>
          </ol>
        </details>

        <div className="flex flex-wrap gap-2 items-center">
          <Button type="button" disabled={guardarDeshabilitado} onClick={() => void guardar()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          {hayConfigPersistida ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving || eliminando || verifying}
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => void eliminarConfiguracion()}
            >
              {eliminando ? 'Eliminando…' : 'Eliminar configuración'}
            </Button>
          ) : null}
        </div>
        {habilitado && verificacionResult?.ok !== true ? (
          <p className="text-xs text-muted-foreground">
            Con el cobro QR activado, primero tenés que pasar la verificación completa y ver todos los checks en
            verde para habilitar Guardar.
          </p>
        ) : null}
      </div>
    </section>
    </>
  );
}
