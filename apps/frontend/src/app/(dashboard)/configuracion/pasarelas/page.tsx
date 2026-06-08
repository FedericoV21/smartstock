'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Link2,
  Plus,
  QrCode,
  RefreshCcw,
  Save,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/hooks/use-confirm';
import { useModulos } from '@/hooks/useModulos';

type Sucursal = {
  id: string;
  nombre: string;
  codigo?: string | null;
};

type Caja = {
  id: string;
  sucursal_id: string;
  numero: number;
  nombre: string | null;
  activa: boolean;
};

type PasarelaTipo = 'mp_qr' | 'mp_point';
type PasarelaEstado = 'activa' | 'inactiva' | 'incompleta';

type Integracion = {
  id: string;
  sucursal_id: string;
  proveedor: string;
  canal: 'qr' | 'terminal';
  tipo: PasarelaTipo | string;
  nombre: string;
  estado: PasarelaEstado;
  config_publica?: Record<string, unknown> | null;
  webhook_public_id?: string | null;
  secretos_configurados?: string[];
};

type IntegracionDraft = {
  nombre: string;
  estado: PasarelaEstado;
  userId: string;
  externalPosId: string;
  externalStoreId: string;
  deviceId: string;
  transferenciaMpHabilitada: boolean;
  accessToken: string;
  webhookSecret: string;
};

type LinkDraft = {
  habilitado: boolean;
  alias: string;
  orden: number;
};

type VerificationCheck = {
  ok: boolean;
  mensaje: string;
  sugerencia?: string;
  [key: string]: unknown;
};

type VerificationResult = {
  ok: boolean;
  mensaje?: string;
  checks?: Record<string, VerificationCheck>;
  detalles?: Record<string, unknown>;
};

type MpStoreOption = {
  id: string;
  name: string;
  external_id: string | null;
  location_label?: string | null;
};

type ApiPayload = Record<string, unknown> & { error?: string };
type MpStoresPayload = ApiPayload & {
  user?: { id?: string | number; nickname?: string | null };
  stores?: MpStoreOption[];
};
type MpQrSetupPayload = ApiPayload & {
  integracion?: Integracion;
  mp?: {
    account?: { id?: string | number };
    pos?: { external_id?: string | null };
    external_store_id?: string | null;
  };
};

const ESTADOS: PasarelaEstado[] = ['activa', 'incompleta', 'inactiva'];
const MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY = 'mp_transferencia_habilitada';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function draftFromIntegracion(integracion: Integracion): IntegracionDraft {
  const cfg = integracion.config_publica ?? {};
  return {
    nombre: integracion.nombre ?? '',
    estado: integracion.estado ?? 'incompleta',
    userId: stringValue(cfg.user_id),
    externalPosId: stringValue(cfg.external_pos_id),
    externalStoreId: stringValue(cfg.external_store_id),
    deviceId: stringValue(cfg.device_id),
    transferenciaMpHabilitada: boolValue(cfg[MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]),
    accessToken: '',
    webhookSecret: '',
  };
}

function tipoLabel(tipo: string): string {
  if (tipo === 'mp_qr') return 'Mercado Pago QR';
  if (tipo === 'mp_point') return 'Mercado Pago Point';
  return tipo;
}

function canalLabel(canal: string): string {
  return canal === 'qr' ? 'QR' : 'Terminal';
}

function cajaLabel(caja: Caja): string {
  const nombre = caja.nombre?.trim();
  return nombre ? `Caja ${caja.numero} - ${nombre}` : `Caja ${caja.numero}`;
}

function mpStoreLabel(store: MpStoreOption): string {
  const external = store.external_id ? ` - ${store.external_id}` : ' - sin External Store ID';
  return `${store.name}${external}`;
}

function estadoLabel(estado: PasarelaEstado): string {
  if (estado === 'activa') return 'Activa';
  if (estado === 'incompleta') return 'Incompleta';
  return 'Inactiva';
}

function verificationCheckLabel(key: string): string {
  const labels: Record<string, string> = {
    configuracion: 'Configuracion',
    token_valido: 'Token',
    user_id_coincide: 'Usuario',
    caja_existe: 'Caja QR',
    cobro_de_prueba: 'Cobro de prueba',
    terminal_existe: 'Terminal',
    modo_pdv: 'Modo PDV',
  };
  return labels[key] ?? key.replaceAll('_', ' ');
}

function linkFromPasarela(row: Record<string, unknown>): LinkDraft {
  return {
    habilitado: Boolean(row.habilitado),
    alias: typeof row.alias === 'string' ? row.alias : '',
    orden: Number.isFinite(Number(row.orden)) ? Number(row.orden) : 0,
  };
}

async function readJson<T extends ApiPayload = ApiPayload>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

export default function ConfiguracionPasarelasPage() {
  const { isAdmin, isSuperAdmin } = useDashboardRole();
  const { confirm, ConfirmDialog } = useConfirm();
  const supportMode = isSuperAdmin;
  const { modulos } = useModulos();

  const [loading, setLoading] = useState(true);
  const [savingCajaId, setSavingCajaId] = useState<string | null>(null);
  const [savingIntegrationId, setSavingIntegrationId] = useState<string | null>(null);
  const [verifyingIntegrationId, setVerifyingIntegrationId] = useState<string | null>(null);
  const [bulkIntegrationId, setBulkIntegrationId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingMpStores, setLoadingMpStores] = useState(false);
  const [msgOk, setMsgOk] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [integraciones, setIntegraciones] = useState<Integracion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, IntegracionDraft>>({});
  const [linksByCaja, setLinksByCaja] = useState<Record<string, Record<string, LinkDraft>>>({});
  const [verificationById, setVerificationById] = useState<Partial<Record<string, VerificationResult>>>({});

  const [nuevoTipo, setNuevoTipo] = useState<PasarelaTipo>('mp_qr');
  const [nuevoNombre, setNuevoNombre] = useState('Mercado Pago QR');
  const [nuevoEstado, setNuevoEstado] = useState<PasarelaEstado>('activa');
  const [nuevoUserId, setNuevoUserId] = useState('');
  const [nuevoExternalPosId, setNuevoExternalPosId] = useState('');
  const [nuevoExternalStoreId, setNuevoExternalStoreId] = useState('');
  const [nuevoDeviceId, setNuevoDeviceId] = useState('');
  const [nuevoTransferenciaMpHabilitada, setNuevoTransferenciaMpHabilitada] = useState(false);
  const [nuevoAccessToken, setNuevoAccessToken] = useState('');
  const [nuevoWebhookSecret, setNuevoWebhookSecret] = useState('');
  const [nuevoEnTodas, setNuevoEnTodas] = useState(false);
  const [mpQrStores, setMpQrStores] = useState<MpStoreOption[]>([]);
  const [mpQrSelectedStoreId, setMpQrSelectedStoreId] = useState('');
  const [mpQrSetupHint, setMpQrSetupHint] = useState<string | null>(null);

  const cajasActivas = useMemo(() => cajas.filter((c) => c.activa), [cajas]);
  const mpQrSelectedStore = useMemo(
    () => mpQrStores.find((store) => store.id === mpQrSelectedStoreId) ?? null,
    [mpQrSelectedStoreId, mpQrStores],
  );

  const loadAll = useCallback(async (targetSucursalId?: string) => {
    setLoading(true);
    setMsgErr(null);
    try {
      const query = targetSucursalId ? `?sucursal_id=${encodeURIComponent(targetSucursalId)}` : '';
      const cajasRes = await fetch(`/api/configuracion/cajas${query}`, { cache: 'no-store' });
      const cajasPayload = await readJson(cajasRes);
      if (!cajasRes.ok) throw new Error(cajasPayload.error ?? 'No se pudieron cargar las cajas');

      const resolvedSucursalId = String(cajasPayload.sucursal_id ?? targetSucursalId ?? '');
      setSucursales((cajasPayload.sucursales ?? []) as Sucursal[]);
      setSucursalId((prev) => (prev === resolvedSucursalId ? prev : resolvedSucursalId));
      const cajasRows = ((cajasPayload.cajas ?? []) as Caja[]).sort((a, b) => a.numero - b.numero);
      setCajas(cajasRows);

      if (!resolvedSucursalId) {
        setIntegraciones([]);
        setDrafts({});
        setLinksByCaja({});
        return;
      }

      const intRes = await fetch(
        `/api/pasarelas/integraciones?sucursal_id=${encodeURIComponent(resolvedSucursalId)}`,
        { cache: 'no-store' },
      );
      const intPayload = await readJson(intRes);
      if (!intRes.ok) throw new Error(intPayload.error ?? 'No se pudieron cargar las pasarelas');

      const intRows = ((intPayload.integraciones ?? []) as Integracion[]).sort((a, b) =>
        a.nombre.localeCompare(b.nombre),
      );
      setIntegraciones(intRows);
      setDrafts(Object.fromEntries(intRows.map((row) => [row.id, draftFromIntegracion(row)])));
      setVerificationById((prev) =>
        Object.fromEntries(intRows.filter((row) => prev[row.id]).map((row) => [row.id, prev[row.id]])),
      );

      const linkEntries = await Promise.all(
        cajasRows.map(async (caja) => {
          const linkRes = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}/pasarelas`, {
            cache: 'no-store',
          });
          const linkPayload = await readJson<
            ApiPayload & { pasarelas?: Array<Record<string, unknown> & { id?: string }> }
          >(linkRes);
          if (!linkRes.ok) throw new Error(linkPayload.error ?? 'No se pudieron cargar enlaces de caja');
          const byIntegracion: Record<string, LinkDraft> = {};
          for (const row of linkPayload.pasarelas ?? []) {
            if (typeof row.id === 'string') byIntegracion[row.id] = linkFromPasarela(row);
          }
          return [caja.id, byIntegracion] as const;
        }),
      );
      setLinksByCaja(Object.fromEntries(linkEntries));
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al cargar pasarelas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(sucursalId || undefined);
  }, [loadAll, sucursalId]);

  function updateDraft(id: string, patch: Partial<IntegracionDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? draftFromIntegracion(integraciones.find((i) => i.id === id)!)), ...patch },
    }));
    setVerificationById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateLink(cajaId: string, integracionId: string, patch: Partial<LinkDraft>) {
    const idx = integraciones.findIndex((i) => i.id === integracionId);
    const base: LinkDraft = { habilitado: false, alias: '', orden: (idx >= 0 ? idx : 0) * 10 };
    setLinksByCaja((prev) => ({
      ...prev,
      [cajaId]: {
        ...(prev[cajaId] ?? {}),
        [integracionId]: {
          ...base,
          ...(prev[cajaId]?.[integracionId] ?? {}),
          ...patch,
        },
      },
    }));
  }

  function rowsParaCaja(cajaId: string, lista = integraciones) {
    const current = linksByCaja[cajaId] ?? {};
    return lista.map((integracion, idx) => {
      const link = current[integracion.id];
      return {
        integracion_id: integracion.id,
        habilitado: Boolean(link?.habilitado),
        alias: link?.alias?.trim() || null,
        orden: Number.isFinite(Number(link?.orden)) ? Number(link?.orden) : idx * 10,
      };
    });
  }

  async function guardarCaja(cajaId: string) {
    if (integraciones.length === 0) return;
    setSavingCajaId(cajaId);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const res = await fetch(`/api/configuracion/cajas/${encodeURIComponent(cajaId)}/pasarelas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pasarelas: rowsParaCaja(cajaId) }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? 'No se pudieron guardar los enlaces');
      setMsgOk('Enlaces de caja guardados');
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al guardar enlaces');
    } finally {
      setSavingCajaId(null);
    }
  }

  async function guardarIntegracion(integracion: Integracion) {
    const draft = drafts[integracion.id];
    if (!draft) return;
    setSavingIntegrationId(integracion.id);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const configPublica =
        integracion.tipo === 'mp_qr'
          ? {
              user_id: draft.userId.trim(),
              external_pos_id: draft.externalPosId.trim(),
              external_store_id: draft.externalStoreId.trim(),
              [MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]: draft.transferenciaMpHabilitada,
            }
          : {
              device_id: draft.deviceId.trim(),
            };
      const secretos: Record<string, string> = {};
      if (draft.accessToken.trim()) secretos.access_token = draft.accessToken.trim();
      if (draft.webhookSecret.trim()) secretos.webhook_secret = draft.webhookSecret.trim();
      const res = await fetch(`/api/pasarelas/integraciones/${encodeURIComponent(integracion.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: draft.nombre.trim(),
          estado: draft.estado,
          config_publica: configPublica,
          ...(Object.keys(secretos).length > 0 ? { secretos } : {}),
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? 'No se pudo guardar la integracion');
      setMsgOk('Integracion guardada');
      await loadAll(sucursalId || undefined);
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al guardar integracion');
    } finally {
      setSavingIntegrationId(null);
    }
  }

  async function borrarIntegracion(integracion: Integracion) {
    const ok = await confirm({
      title: 'Borrar integración',
      description: `Borrar "${integracion.nombre}"? No se puede borrar si tiene cobros activos.`,
      confirmLabel: 'Borrar',
      confirmVariant: 'destructive',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setSavingIntegrationId(integracion.id);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const res = await fetch(`/api/pasarelas/integraciones/${encodeURIComponent(integracion.id)}`, {
        method: 'DELETE',
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? 'No se pudo borrar la integracion');
      setMsgOk('Integracion borrada');
      await loadAll(sucursalId || undefined);
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al borrar integracion');
    } finally {
      setSavingIntegrationId(null);
    }
  }

  async function verificarIntegracion(integracion: Integracion) {
    const draft = drafts[integracion.id];
    if (!draft) return;
    setVerifyingIntegrationId(integracion.id);
    setMsgErr(null);
    setMsgOk(null);
    try {
      const configPublica =
        integracion.tipo === 'mp_qr'
          ? {
              user_id: draft.userId.trim(),
              external_pos_id: draft.externalPosId.trim(),
              external_store_id: draft.externalStoreId.trim(),
              [MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]: draft.transferenciaMpHabilitada,
            }
          : {
              device_id: draft.deviceId.trim(),
            };
      const secretos: Record<string, string> = {};
      if (draft.accessToken.trim()) secretos.access_token = draft.accessToken.trim();
      if (draft.webhookSecret.trim()) secretos.webhook_secret = draft.webhookSecret.trim();
      const res = await fetch(`/api/pasarelas/integraciones/${encodeURIComponent(integracion.id)}/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_publica: configPublica,
          ...(Object.keys(secretos).length > 0 ? { secretos } : {}),
        }),
      });
      const payload = (await readJson(res)) as VerificationResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? 'No se pudo verificar la integracion');
      setVerificationById((prev) => ({ ...prev, [integracion.id]: payload }));
      if (payload.ok) {
        setMsgOk(`${payload.mensaje ?? 'Conexion verificada'} Guarda los cambios si modificaste algun campo.`);
      } else {
        setMsgErr(payload.mensaje ?? 'La conexion no pudo verificarse');
      }
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al verificar integracion');
    } finally {
      setVerifyingIntegrationId(null);
    }
  }

  async function enlazarTodasActivas(integracion: Integracion) {
    if (integraciones.length === 0 || cajasActivas.length === 0) return;
    setBulkIntegrationId(integracion.id);
    setMsgErr(null);
    setMsgOk(null);
    try {
      for (const caja of cajasActivas) {
        const rows = rowsParaCaja(caja.id).map((row) =>
          row.integracion_id === integracion.id ? { ...row, habilitado: true } : row,
        );
        const res = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}/pasarelas`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pasarelas: rows }),
        });
        const payload = await readJson(res);
        if (!res.ok) throw new Error(payload.error ?? 'No se pudieron enlazar todas las cajas');
      }
      setMsgOk('Integracion habilitada en todas las cajas activas');
      await loadAll(sucursalId || undefined);
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al enlazar cajas');
    } finally {
      setBulkIntegrationId(null);
    }
  }

  function resetNuevoMpQrSetup() {
    setMpQrStores([]);
    setMpQrSelectedStoreId('');
    setMpQrSetupHint(null);
  }

  async function buscarLocalesMpQr() {
    const accessToken = nuevoAccessToken.trim();
    if (!accessToken) {
      setMsgErr('Carga el access token de Mercado Pago para buscar locales');
      return;
    }

    setLoadingMpStores(true);
    setMsgErr(null);
    setMsgOk(null);
    setMpQrSetupHint(null);
    try {
      const res = await fetch('/api/pasarelas/mp-qr/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const payload = await readJson<MpStoresPayload>(res);
      if (!res.ok) throw new Error(payload.error ?? 'No se pudieron cargar los locales de Mercado Pago');
      const stores = (payload.stores ?? []) as MpStoreOption[];
      setNuevoUserId(String(payload.user?.id ?? ''));
      setMpQrStores(stores);
      setMpQrSelectedStoreId((prev) => (stores.some((store) => store.id === prev) ? prev : stores[0]?.id ?? ''));
      setMpQrSetupHint(
        stores.length > 0
          ? `Cuenta MP ${payload.user?.nickname ?? payload.user?.id ?? ''}: ${stores.length} local(es)`
          : 'La cuenta no tiene locales habilitados en Mercado Pago',
      );
      if (stores.length === 0) {
        setMsgErr('La cuenta no tiene locales habilitados en Mercado Pago');
      }
    } catch (e) {
      resetNuevoMpQrSetup();
      setMsgErr(e instanceof Error ? e.message : 'Error al buscar locales de Mercado Pago');
    } finally {
      setLoadingMpStores(false);
    }
  }

  async function crearIntegracionMpQrAutomatica(): Promise<Integracion> {
    const res = await fetch('/api/pasarelas/mp-qr/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sucursal_id: sucursalId,
        access_token: nuevoAccessToken.trim(),
        webhook_secret: nuevoWebhookSecret.trim(),
        store_id: mpQrSelectedStoreId,
        nombre: nuevoNombre.trim(),
        estado: nuevoEstado,
        [MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]: nuevoTransferenciaMpHabilitada,
      }),
    });
    const payload = await readJson<MpQrSetupPayload>(res);
    if (!res.ok) throw new Error(payload.error ?? 'No se pudo crear la integracion MP QR');

    const mp = payload.mp;
    setNuevoUserId(String(mp?.account?.id ?? ''));
    setNuevoExternalPosId(String(mp?.pos?.external_id ?? ''));
    setNuevoExternalStoreId(String(mp?.external_store_id ?? ''));
    if (!payload.integracion) throw new Error('Mercado Pago QR se preparo, pero no volvio la integracion');
    return payload.integracion;
  }

  async function crearIntegracion() {
    if (!sucursalId) return;
    setCreating(true);
    setMsgErr(null);
    setMsgOk(null);
    try {
      if (nuevoTipo === 'mp_qr' && mpQrSelectedStoreId) {
        const nueva = await crearIntegracionMpQrAutomatica();

        if (nuevoEnTodas && nueva?.id) {
          const listaConNueva = [...integraciones, nueva];
          for (const caja of cajasActivas) {
            const rows = rowsParaCaja(caja.id, listaConNueva).map((row) =>
              row.integracion_id === nueva.id ? { ...row, habilitado: true } : row,
            );
            const linkRes = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}/pasarelas`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pasarelas: rows }),
            });
            const linkPayload = await readJson(linkRes);
            if (!linkRes.ok) throw new Error(linkPayload.error ?? 'La integracion se creo, pero no se pudo enlazar');
          }
        }

        setMsgOk('Integracion creada con QR NEXUS en Mercado Pago');
        setNuevoNombre('Mercado Pago QR');
        setNuevoAccessToken('');
        setNuevoWebhookSecret('');
        setNuevoUserId('');
        setNuevoExternalPosId('');
        setNuevoExternalStoreId('');
        setNuevoTransferenciaMpHabilitada(false);
        resetNuevoMpQrSetup();
        await loadAll(sucursalId || undefined);
        return;
      }

      const canal = nuevoTipo === 'mp_qr' ? 'qr' : 'terminal';
      const configPublica =
        nuevoTipo === 'mp_qr'
          ? {
              user_id: nuevoUserId.trim(),
              external_pos_id: nuevoExternalPosId.trim(),
              external_store_id: nuevoExternalStoreId.trim(),
              [MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]: nuevoTransferenciaMpHabilitada,
            }
          : {
              device_id: nuevoDeviceId.trim(),
            };
      const secretos: Record<string, string> = {};
      if (nuevoAccessToken.trim()) secretos.access_token = nuevoAccessToken.trim();
      if (nuevoWebhookSecret.trim()) secretos.webhook_secret = nuevoWebhookSecret.trim();
      const res = await fetch('/api/pasarelas/integraciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: sucursalId,
          proveedor: 'mercado_pago',
          tipo: nuevoTipo,
          canal,
          nombre: nuevoNombre.trim(),
          estado: nuevoEstado,
          config_publica: configPublica,
          secretos,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? 'No se pudo crear la integracion');
      const nueva = payload.integracion as Integracion;

      if (nuevoEnTodas && nueva?.id) {
        const listaConNueva = [...integraciones, nueva];
        for (const caja of cajasActivas) {
          const rows = rowsParaCaja(caja.id, listaConNueva).map((row) =>
            row.integracion_id === nueva.id ? { ...row, habilitado: true } : row,
          );
          const linkRes = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}/pasarelas`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pasarelas: rows }),
          });
          const linkPayload = await readJson(linkRes);
          if (!linkRes.ok) throw new Error(linkPayload.error ?? 'La integracion se creo, pero no se pudo enlazar');
        }
      }

      setMsgOk('Integracion creada');
      setNuevoNombre(nuevoTipo === 'mp_qr' ? 'Mercado Pago QR' : 'Mercado Pago Point');
      setNuevoAccessToken('');
      setNuevoWebhookSecret('');
      setNuevoUserId('');
      setNuevoExternalPosId('');
      setNuevoExternalStoreId('');
      setNuevoDeviceId('');
      setNuevoTransferenciaMpHabilitada(false);
      resetNuevoMpQrSetup();
      await loadAll(sucursalId || undefined);
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Error al crear integracion');
    } finally {
      setCreating(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-muted-foreground">
        Solo el administrador del negocio puede configurar pasarelas.
      </div>
    );
  }

  if (!modulos.facturador_pos) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Link href="/configuracion" className="text-sm text-muted-foreground hover:text-foreground">
          Volver a Configuracion
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Pasarelas externas</h1>
        <p className="text-sm text-muted-foreground">
          El modulo de terminal POS no esta activo en tu plan.
        </p>
      </div>
    );
  }

  return (
    <>
      {ConfirmDialog}
      <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/configuracion" className="text-sm text-muted-foreground hover:text-foreground">
            Volver a Configuracion
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Pasarelas externas</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Administra conexiones QR y terminal por sucursal. Una conexion puede quedar disponible en varias cajas, y
            cada caja puede tener varias conexiones para elegir en el POS.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadAll(sucursalId || undefined)}>
          <RefreshCcw />
          Actualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Sucursal</span>
          <Select value={sucursalId} onValueChange={(v) => v && setSucursalId(v)}>
            <SelectTrigger className="w-[18rem] max-w-full">
              <SelectValue placeholder="Elegir sucursal" />
            </SelectTrigger>
            <SelectContent>
              {sucursales.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="text-sm text-muted-foreground">
          {cajasActivas.length} cajas activas, {integraciones.length} integraciones configuradas.
        </div>
      </div>

      {msgOk ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">
          {msgOk}
        </p>
      ) : null}
      {msgErr ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {msgErr}
        </p>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Nueva integracion</h2>
            <p className="text-sm text-muted-foreground">
              Para sumar otro QR de Mercado Pago, crea una conexion MP QR con otro external_pos_id.
            </p>
          </div>
          <Plus className="mt-1 size-5 text-muted-foreground" />
        </div>

        <div className="grid gap-3 lg:grid-cols-[12rem_1fr_11rem]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Tipo</span>
            <Select
              value={nuevoTipo}
              onValueChange={(v) => {
                const next = v as PasarelaTipo;
                setNuevoTipo(next);
                setNuevoNombre(next === 'mp_qr' ? 'Mercado Pago QR' : 'Mercado Pago Point');
                if (next !== 'mp_qr') setNuevoTransferenciaMpHabilitada(false);
                resetNuevoMpQrSetup();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp_qr">MP QR</SelectItem>
                <SelectItem value="mp_point">MP Point</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nombre visible</span>
            <Input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="QR mostrador" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Estado</span>
            <Select value={nuevoEstado} onValueChange={(v) => setNuevoEstado(v as PasarelaEstado)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADOS.map((estado) => (
                  <SelectItem key={estado} value={estado}>
                    {estadoLabel(estado)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {nuevoTipo === 'mp_qr' ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Access token</span>
                <Input
                  value={nuevoAccessToken}
                  onChange={(e) => {
                    setNuevoAccessToken(e.target.value);
                    resetNuevoMpQrSetup();
                  }}
                  type="password"
                  placeholder="APP_USR-..."
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Webhook secret</span>
                <Input
                  value={nuevoWebhookSecret}
                  onChange={(e) => setNuevoWebhookSecret(e.target.value)}
                  type="password"
                  placeholder="Opcional para QR"
                />
              </label>
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-muted-foreground">
                  {mpQrSetupHint ?? 'Carga el token para traer los locales de Mercado Pago.'}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void buscarLocalesMpQr()}
                  disabled={loadingMpStores || !nuevoAccessToken.trim()}
                >
                  <RefreshCcw />
                  {loadingMpStores ? 'Buscando...' : 'Buscar locales'}
                </Button>
              </div>
              {mpQrStores.length > 0 ? (
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium">Local de Mercado Pago</span>
                  <Select value={mpQrSelectedStoreId} onValueChange={(value) => setMpQrSelectedStoreId(value ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Elegir local" />
                    </SelectTrigger>
                    <SelectContent>
                      {mpQrStores.map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {mpStoreLabel(store)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mpQrSelectedStore ? (
                    <span className="text-xs text-muted-foreground">
                      {mpQrSelectedStore.external_id
                        ? `External Store ID: ${mpQrSelectedStore.external_id}`
                        : 'Sin External Store ID: al crear se asigna SUC01 si esta disponible.'}
                    </span>
                  ) : null}
                </label>
              ) : null}
              <details className="rounded-lg border p-3 md:col-span-2">
                <summary className="cursor-pointer text-sm font-medium">Carga manual</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">MP user_id</span>
                    <Input value={nuevoUserId} onChange={(e) => setNuevoUserId(e.target.value)} placeholder="123456789" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">External POS ID</span>
                    <Input
                      value={nuevoExternalPosId}
                      onChange={(e) => setNuevoExternalPosId(e.target.value)}
                      placeholder="CAJA_1_QR"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">External Store ID</span>
                    <Input
                      value={nuevoExternalStoreId}
                      onChange={(e) => setNuevoExternalStoreId(e.target.value)}
                      placeholder="Opcional, ej: SUC01"
                    />
                  </label>
                </div>
              </details>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm md:col-span-2">
                <div className="min-w-0">
                  <p className="font-medium">Verificador de transferencias MP</p>
                  <p className="text-xs text-muted-foreground">
                    Muestra Transferencia MP en las cajas donde este QR este habilitado.
                  </p>
                </div>
                <Switch
                  checked={nuevoTransferenciaMpHabilitada}
                  onCheckedChange={setNuevoTransferenciaMpHabilitada}
                  title="Habilitar verificador de transferencias MP"
                />
              </div>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="font-medium">Device ID</span>
                <Input value={nuevoDeviceId} onChange={(e) => setNuevoDeviceId(e.target.value)} placeholder="PAX_A910..." />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Access token</span>
                <Input
                  value={nuevoAccessToken}
                  onChange={(e) => setNuevoAccessToken(e.target.value)}
                  type="password"
                  placeholder="APP_USR-..."
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Webhook secret</span>
                <Input
                  value={nuevoWebhookSecret}
                  onChange={(e) => setNuevoWebhookSecret(e.target.value)}
                  type="password"
                  placeholder="Requerido para Point"
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={nuevoEnTodas}
              onChange={(e) => setNuevoEnTodas(e.target.checked)}
            />
            Habilitar al crear en todas las cajas activas
          </label>
          <Button type="button" onClick={() => void crearIntegracion()} disabled={creating || !sucursalId}>
            <Plus />
            {creating ? 'Creando...' : nuevoTipo === 'mp_qr' && mpQrSelectedStoreId ? 'Crear QR NEXUS' : 'Crear integracion'}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Integraciones</h2>
            <p className="text-sm text-muted-foreground">
              Los secretos se reemplazan solo cuando cargas un valor nuevo.
            </p>
          </div>
          <CheckCircle2 className="mt-1 size-5 text-muted-foreground" />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando integraciones...</p>
        ) : integraciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavia no hay integraciones en esta sucursal.</p>
        ) : (
          <div className="space-y-4">
            {integraciones.map((integracion) => {
              const draft = drafts[integracion.id] ?? draftFromIntegracion(integracion);
              const icon = integracion.canal === 'qr' ? <QrCode /> : <Terminal />;
              const hasToken = integracion.secretos_configurados?.includes('access_token');
              const hasSecret = integracion.secretos_configurados?.includes('webhook_secret');
              const verification = verificationById[integracion.id];
              return (
                <div key={integracion.id} className="rounded-lg border bg-background p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {icon}
                      </span>
                      <div>
                        <div className="font-medium">{tipoLabel(integracion.tipo)}</div>
                        <div className="text-xs text-muted-foreground">
                          {canalLabel(integracion.canal)}
                          {supportMode && integracion.webhook_public_id
                            ? ` · Webhook ${integracion.webhook_public_id}`
                            : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void verificarIntegracion(integracion)}
                        disabled={verifyingIntegrationId === integracion.id || savingIntegrationId === integracion.id}
                        title="Verificar conexion"
                      >
                        <ShieldCheck />
                        {verifyingIntegrationId === integracion.id ? 'Verificando...' : 'Verificar'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void enlazarTodasActivas(integracion)}
                        disabled={bulkIntegrationId === integracion.id || cajasActivas.length === 0}
                        title="Habilitar esta integracion en todas las cajas activas"
                      >
                        <Link2 />
                        Todas las cajas
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void borrarIntegracion(integracion)}
                        disabled={savingIntegrationId === integracion.id}
                        title="Borrar integracion"
                      >
                        <Trash2 />
                        Borrar
                      </Button>
                    </div>
                  </div>

                  {verification ? (
                    <div
                      className={
                        verification.ok
                          ? 'mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800'
                          : 'mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
                      }
                      role="status"
                    >
                      <div className="font-medium">
                        {verification.mensaje ?? (verification.ok ? 'Conexion verificada' : 'Conexion no verificada')}
                      </div>
                      {verification.checks ? (
                        <div className="mt-2 space-y-1">
                          {Object.entries(verification.checks).map(([key, check]) => (
                            <div key={key} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                              <span className="font-medium">
                                {check.ok ? 'OK' : 'Fallo'} - {verificationCheckLabel(key)}
                              </span>
                              <span className="whitespace-pre-wrap break-words">
                                {check.mensaje}
                                {check.sugerencia ? ` ${check.sugerencia}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid gap-3 lg:grid-cols-[1fr_11rem]">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Nombre</span>
                      <Input value={draft.nombre} onChange={(e) => updateDraft(integracion.id, { nombre: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Estado</span>
                      <Select value={draft.estado} onValueChange={(v) => updateDraft(integracion.id, { estado: v as PasarelaEstado })}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTADOS.map((estado) => (
                            <SelectItem key={estado} value={estado}>
                              {estadoLabel(estado)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {integracion.tipo === 'mp_qr' ? (
                      <>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium">MP user_id</span>
                          <Input value={draft.userId} onChange={(e) => updateDraft(integracion.id, { userId: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium">External POS ID</span>
                          <Input
                            value={draft.externalPosId}
                            onChange={(e) => updateDraft(integracion.id, { externalPosId: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="font-medium">External Store ID</span>
                          <Input
                            value={draft.externalStoreId}
                            onChange={(e) => updateDraft(integracion.id, { externalStoreId: e.target.value })}
                            placeholder="Opcional, ej: SUC01"
                          />
                        </label>
                        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm md:col-span-2">
                          <div className="min-w-0">
                            <p className="font-medium">Verificador de transferencias MP</p>
                            <p className="text-xs text-muted-foreground">
                              Muestra Transferencia MP en las cajas donde este QR este habilitado.
                            </p>
                          </div>
                          <Switch
                            checked={draft.transferenciaMpHabilitada}
                            onCheckedChange={(checked) =>
                              updateDraft(integracion.id, { transferenciaMpHabilitada: checked })
                            }
                            title="Habilitar verificador de transferencias MP"
                          />
                        </div>
                      </>
                    ) : (
                      <label className="flex flex-col gap-1 text-sm md:col-span-2">
                        <span className="font-medium">Device ID</span>
                        <Input value={draft.deviceId} onChange={(e) => updateDraft(integracion.id, { deviceId: e.target.value })} />
                      </label>
                    )}
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Access token {hasToken ? '(configurado)' : ''}</span>
                      <Input
                        value={draft.accessToken}
                        onChange={(e) => updateDraft(integracion.id, { accessToken: e.target.value })}
                        type="password"
                        placeholder={hasToken ? 'Dejar vacio para conservar' : 'APP_USR-...'}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Webhook secret {hasSecret ? '(configurado)' : ''}</span>
                      <Input
                        value={draft.webhookSecret}
                        onChange={(e) => updateDraft(integracion.id, { webhookSecret: e.target.value })}
                        type="password"
                        placeholder={hasSecret ? 'Dejar vacio para conservar' : 'Secret del proveedor'}
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void guardarIntegracion(integracion)}
                      disabled={savingIntegrationId === integracion.id}
                    >
                      <Save />
                      {savingIntegrationId === integracion.id ? 'Guardando...' : 'Guardar'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-4">
          <h2 className="font-medium">Cajas e integraciones disponibles</h2>
          <p className="text-sm text-muted-foreground">
            Activa las conexiones que cada caja puede elegir en el POS. El cobro sigue usando ARCA solo despues del
            pago aprobado.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando cajas...</p>
        ) : cajas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cajas para esta sucursal.</p>
        ) : integraciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Crea al menos una integracion para enlazar cajas.</p>
        ) : (
          <div className="space-y-3">
            {cajas.map((caja) => (
              <div key={caja.id} className="rounded-lg border bg-background p-3">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">{cajaLabel(caja)}</div>
                    <div className="text-xs text-muted-foreground">{caja.activa ? 'Activa' : 'Inactiva'}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void guardarCaja(caja.id)}
                    disabled={savingCajaId === caja.id}
                  >
                    <Save />
                    {savingCajaId === caja.id ? 'Guardando...' : 'Guardar enlaces'}
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {integraciones.map((integracion, idx) => {
                    const link = linksByCaja[caja.id]?.[integracion.id] ?? {
                      habilitado: false,
                      alias: '',
                      orden: idx * 10,
                    };
                    return (
                      <div key={integracion.id} className="flex flex-col gap-2 rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{integracion.nombre}</div>
                            <div className="text-xs text-muted-foreground">
                              {canalLabel(integracion.canal)} - {estadoLabel(integracion.estado)}
                            </div>
                          </div>
                          <Switch
                            checked={link.habilitado}
                            onCheckedChange={(checked) => updateLink(caja.id, integracion.id, { habilitado: checked })}
                            title="Habilitar en esta caja"
                          />
                        </div>
                        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                          Alias en esta caja
                          <Input
                            value={link.alias}
                            onChange={(e) => updateLink(caja.id, integracion.id, { alias: e.target.value })}
                            disabled={!link.habilitado}
                            placeholder={integracion.nombre}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>
    </>
  );
}
