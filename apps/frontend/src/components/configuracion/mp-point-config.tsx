'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type DeviceOpt = {
  id: string;
  name: string;
  operating_mode: 'PDV' | 'STANDALONE';
  external_pos_id: string;
};

type MpPointGet = {
  habilitado: boolean;
  device_id: string | null;
  access_token_configurado: boolean;
  access_token_preview: string | null;
  webhook_secret_configurado: boolean;
};

export function MpPointConfigSection(props?: { onDirtyChange?: (dirty: boolean) => void }) {
  const { onDirtyChange } = props ?? {};
  const { confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [server, setServer] = useState<MpPointGet | null>(null);

  const [habilitado, setHabilitado] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [devices, setDevices] = useState<DeviceOpt[]>([]);
  /** Hubo al menos una respuesta OK del listado de terminales (vacía o no). */
  const [listaTerminalConsultada, setListaTerminalConsultada] = useState(false);

  const [msgOk, setMsgOk] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsgErr(null);
    try {
      const res = await fetch('/api/configuracion/mp-point');
      const j = await res.json();
      if (!res.ok) {
        setMsgErr(j.error ?? 'Error al cargar');
        setServer(null);
      } else {
        setServer(j as MpPointGet);
        setHabilitado(Boolean(j.habilitado));
        setDeviceId(j.device_id ?? '');
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
        (deviceId || '') !== (server.device_id ?? '') ||
        accessToken.trim() !== '' ||
        webhookSecret.trim() !== '');
    onDirtyChange(dirty);
  }, [
    onDirtyChange,
    loading,
    server,
    habilitado,
    deviceId,
    accessToken,
    webhookSecret,
  ]);

  const hayConfigPersistida = Boolean(
    server?.access_token_configurado ||
      (server?.device_id && String(server.device_id).trim()) ||
      server?.webhook_secret_configurado,
  );

  /** Si ya hay token y MP activo, carga la lista de terminales para mostrar el selector con la guardada en DB. */
  useEffect(() => {
    if (!server?.access_token_configurado || !server.habilitado) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/pagos/mp-point/devices');
      if (!res.ok || cancelled) return;
      const j = await res.json();
      if (cancelled) return;
      const list = (j.devices as DeviceOpt[]) ?? [];
      setDevices(list);
      setListaTerminalConsultada(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [server?.access_token_configurado, server?.habilitado]);

  async function verificarTerminales() {
    setVerifying(true);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const res = await fetch('/api/pagos/mp-point/devices');
      const j = await res.json();
      if (!res.ok) {
        setMsgErr(
          res.status === 400 && j.error?.includes('Token')
            ? 'Token inválido o sin permisos de Point'
            : (j.error ?? 'No se pudieron cargar las terminales'),
        );
        setDevices([]);
      } else {
        const list = (j.devices as DeviceOpt[]) ?? [];
        setDevices(list);
        setListaTerminalConsultada(true);
        if (list.length === 0) {
          setMsgOk(null);
        } else {
          setMsgOk(`Encontramos ${list.length} terminal(es). Elegí una abajo y tocá Guardar.`);
        }
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
    if (habilitado && !String(deviceId).trim()) {
      setMsgErr(
        'Tenés el cobro con terminal activado pero no hay terminal elegida. Tocá «Verificar y cargar terminales», seleccioná una en la lista y volvé a guardar (o desactivá el interruptor arriba).',
      );
      setSaving(false);
      return;
    }
    try {
      const body: Record<string, unknown> = {
        habilitado,
        device_id: deviceId || null,
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();
      if (webhookSecret.trim()) body.webhook_secret = webhookSecret.trim();

      const res = await fetch('/api/configuracion/mp-point', {
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
        await load();
      }
    } catch {
      setMsgErr('Error de red');
    }
    setSaving(false);
  }

  async function eliminarConfiguracion() {
    const ok = await confirm({
      title: 'Eliminar configuración Point',
      description:
        '¿Eliminar por completo la configuración de Mercado Pago Point para esta sucursal? Se borran el access token, la terminal seleccionada y el secret del webhook en Nexus. Vas a tener que cargarlos de nuevo para usar Point.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    setEliminando(true);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const res = await fetch('/api/configuracion/mp-point', { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) {
        setMsgErr(typeof j.error === 'string' ? j.error : 'No se pudo eliminar');
      } else {
        setMsgOk('Configuración de Point eliminada');
        setAccessToken('');
        setWebhookSecret('');
        setDevices([]);
        setListaTerminalConsultada(false);
        await load();
      }
    } catch {
      setMsgErr('Error de red');
    }
    setEliminando(false);
  }

  const selectedDevice = devices.find((d) => d.id === deviceId);
  const standaloneWarn = selectedDevice?.operating_mode === 'STANDALONE';

  if (loading) {
    return (
      <>
        {ConfirmDialog}
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Cargando Mercado Pago Point…</p>
        </section>
      </>
    );
  }

  return (
    <>
      {ConfirmDialog}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="font-medium mb-1">Mercado Pago Point</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Cobrá con la terminal física (Smart, Plus, Pro, Mini). Usá el mismo token de producción de tu app en{' '}
        <a
          href="https://www.mercadopago.com.ar/developers/es/docs/getting-started"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Mercado Pago Developers
        </a>
        .
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

      {server?.habilitado && !String(deviceId).trim() ? (
        <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          <strong>Falta la terminal.</strong> Tocá «Verificar y cargar terminales», elegí una en el listado y <strong>Guardar</strong>. Hasta entonces el botón Posnet en el POS no va a funcionar.
        </div>
      ) : null}

      {String(deviceId).trim() && devices.length === 0 && !verifying ? (
        <p className="mb-3 text-xs text-muted-foreground font-mono break-all">
          Terminal guardada: {deviceId}
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
                  title: 'Desactivar Point',
                  description:
                    '¿Desactivar Mercado Pago Point? Si hay una venta cobrando en la terminal, puede quedar pendiente.',
                  confirmLabel: 'Desactivar',
                  cancelLabel: 'Cancelar',
                  confirmVariant: 'destructive',
                });
                if (!ok) return;
              }
              setHabilitado(nextChecked);
            })();
          }}
          className="size-4 rounded border-input"
        />
        Habilitar cobro con terminal Point en el POS
      </label>

      <div className="grid gap-4 max-w-xl">
        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Access token (producción)</span>
          <div className="flex gap-2">
            <Input
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
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

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={verifying} onClick={() => void verificarTerminales()}>
            {verifying ? 'Verificando…' : 'Verificar y cargar terminales'}
          </Button>
        </div>

        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
          <span className="text-sm font-medium text-foreground">Terminal activa</span>
          <p className="text-xs text-muted-foreground -mt-1">
            Elegís acá la terminal física que va a cobrar en el POS (aparece después de verificar, si Mercado Pago devuelve terminales).
          </p>
          {devices.length > 0 ? (
            <label className="grid gap-1 text-sm">
              <Select value={deviceId} onValueChange={(v) => setDeviceId(v ?? '')}>
                <SelectTrigger className="h-11 w-full bg-background">
                  <SelectValue placeholder="Tocá para elegir una terminal" />
                </SelectTrigger>
                <SelectContent className="max-h-[min(60vh,320px)]">
                  {devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} · {d.operating_mode} · {d.external_pos_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : listaTerminalConsultada ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              <strong>No hay terminales en esta cuenta de Mercado Pago.</strong> El listado vino vacío: no se puede
              elegir ninguna hasta que en Mercado Pago tengas un <strong>Point</strong> asociado al mismo usuario del{' '}
              <strong>access token</strong> (app de cobros del comercio). Revisá en la app MP que el aparato esté
              dado de alta y probá de nuevo «Verificar y cargar terminales».
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tocá <strong>Verificar y cargar terminales</strong> arriba: si tu cuenta tiene Point, el desplegable se
              completa acá.
            </p>
          )}
        </div>

        {standaloneWarn ? (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
            Esta terminal está en modo <strong>STANDALONE</strong>. Cambiala a modo <strong>PDV</strong> desde la app de
            Mercado Pago en el teléfono del comercio (Cobrar → Punto de venta → modo integrado).
          </div>
        ) : null}

        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Webhook secret (firma de notificaciones)</span>
          <Input
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={
              server?.webhook_secret_configurado ? 'Secret ya guardado (pegá uno nuevo para reemplazar)' : 'Secret del panel de webhooks'
            }
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Registrá la URL <code className="rounded bg-muted px-1">/api/pagos/mp-point/webhook</code> en tu app de
            Mercado Pago y copiá el secret que te indique el panel.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button type="button" disabled={saving || eliminando} onClick={() => void guardar()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          {hayConfigPersistida ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving || eliminando}
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => void eliminarConfiguracion()}
            >
              {eliminando ? 'Eliminando…' : 'Eliminar configuración'}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
    </>
  );
}
