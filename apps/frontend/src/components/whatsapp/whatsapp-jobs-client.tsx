'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileClock, Link2, Paperclip, RefreshCcw, Search, Send, Trash2, Unlink, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfirm } from '@/hooks/use-confirm';
import { WhatsAppBranchRulesPanel } from '@/components/whatsapp/whatsapp-branch-rules-panel';

type Row = {
  id: string;
  status: string;
  document_type: string | null;
  branch_resolution_status: string | null;
  branch_resolution_reason: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  retry_count: number | null;
  target_entity_type: string | null;
  target_entity_id: string | null;
  whatsapp_inbound_message:
    | {
        from_wa_id: string | null;
        received_at: string | null;
      }
    | { from_wa_id: string | null; received_at: string | null }[]
    | null;
  whatsapp_inbound_attachment:
    | {
        mime_type: string | null;
        filename: string | null;
      }
    | { mime_type: string | null; filename: string | null }[]
    | null;
};

type BindUser = {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: string;
};

type BindActor = {
  id: string;
  usuario_id: string;
  from_wa_id: string;
  from_wa_id_masked: string;
  rol_whatsapp: string;
  trust_level: string;
  activo: boolean;
  verified_at: string | null;
  created_at: string | null;
  latest_challenge:
    | {
        status: string;
        expires_at: string | null;
        blocked_until: string | null;
        attempt_count: number | null;
        max_attempts: number | null;
        created_at: string | null;
      }
    | null;
  usuario:
    | {
        nombre: string;
        apellido: string;
        email: string;
        rol: string;
      }
    | null;
};

type AgentFeatureFlag = {
  enabled: boolean;
  rollout_stage: string;
  notes: string | null;
  can_manage: boolean;
};

type WhatsAppChannelConfig = {
  mode: 'platform';
  channel_id: string | null;
  phone_number_id: string | null;
  activa: boolean;
  has_channel: boolean;
  configured_via_env: boolean;
  can_manage_platform: boolean;
  linked_verified_actors: number;
};

type SandboxMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type SandboxInvoiceTicketStatus = 'needs_review' | 'ready' | 'closed' | 'applied' | 'error';

type SandboxInvoicePendingItem = {
  indice: number;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  precio_unitario: number | null;
  subtotal: number | null;
  producto_id: string | null;
  producto_nombre: string | null;
  confidence: number | null;
  motivo: 'sin_producto' | 'requires_review';
};

type SandboxInvoiceTicketSummary = {
  proveedor_nombre: string | null;
  proveedor_cuit: string | null;
  tipo_comprobante: string | null;
  letra: string | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  subtotal: number | null;
  iva_21: number | null;
  iva_10_5: number | null;
  iva_27: number | null;
  percepcion_iibb: number | null;
  percepcion_iva: number | null;
  impuesto_interno: number | null;
  otros_impuestos: number | null;
  total: number | null;
  items_count: number;
  productos_vinculados: number;
  productos_pendientes: number;
  productos_nuevos: number;
  productos_para_revisar: number;
  afecta_stock: boolean;
  afecta_cuenta_corriente: boolean;
  actualizar_costos: boolean;
  cambios_costos: Array<{
    producto_id?: string;
    codigo?: string | null;
    nombre?: string | null;
    precio_costo_anterior?: number | null;
    precio_costo_nuevo?: number | null;
    precio_venta_anterior?: number | null;
  }>;
  advertencias: string[];
  conflictos: string[];
  bloqueantes: string[];
  impact_hash: string | null;
  can_apply: boolean;
};

type SandboxInvoiceTicket = {
  id: string;
  status: SandboxInvoiceTicketStatus;
  summary: SandboxInvoiceTicketSummary;
  pending_items: SandboxInvoicePendingItem[];
  impact_hash: string | null;
  action_log_id: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  applied_at: string | null;
};

type ProductOption = {
  id: string;
  codigo: string | null;
  nombre: string;
  precio_costo?: number | null;
  stock_actual?: number | null;
  unidad?: string | null;
};

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formatDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR');
}

function statusLabel(status: string) {
  switch (status) {
    case 'queued':
      return 'En cola';
    case 'processing':
      return 'Procesando';
    case 'awaiting_branch_confirmation':
      return 'Esperando sucursal';
    case 'review_required':
      return 'Revisión manual';
    case 'imported':
      return 'Importado';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0,00';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);
}

function ticketStatusLabel(status: SandboxInvoiceTicketStatus) {
  switch (status) {
    case 'ready':
      return 'Listo';
    case 'needs_review':
      return 'Revisar';
    case 'applied':
      return 'Cargado';
    case 'closed':
      return 'Cerrado';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

function ticketStatusClass(status: SandboxInvoiceTicketStatus) {
  switch (status) {
    case 'ready':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'applied':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'closed':
      return 'border-slate-200 bg-slate-50 text-slate-600';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'needs_review':
    default:
      return 'border-amber-200 bg-amber-50 text-amber-800';
  }
}

function ticketItemKey(ticketId: string, itemIndice: number) {
  return `${ticketId}:${itemIndice}`;
}

function SandboxInvoiceTicketCard({
  ticket,
  busy,
  productSearch,
  productResults,
  productSearchBusyKey,
  onContinue,
  onClose,
  onSearchChange,
  onSearchProducts,
  onLinkProduct,
}: {
  ticket: SandboxInvoiceTicket;
  busy: boolean;
  productSearch: Record<string, string>;
  productResults: Record<string, ProductOption[]>;
  productSearchBusyKey: string | null;
  onContinue: (ticketId: string) => void;
  onClose: (ticketId: string) => void;
  onSearchChange: (key: string, value: string) => void;
  onSearchProducts: (ticket: SandboxInvoiceTicket, item: SandboxInvoicePendingItem) => void;
  onLinkProduct: (ticket: SandboxInvoiceTicket, item: SandboxInvoicePendingItem, product: ProductOption) => void;
}) {
  const summary = ticket.summary;
  const numberText = [summary.punto_venta, summary.numero].filter((v) => v != null).join('-');
  const typeText = [summary.tipo_comprobante, summary.letra].filter(Boolean).join(' ');
  const canClose = ticket.status !== 'closed' && ticket.status !== 'applied';
  const canLoad = ticket.status === 'ready' && summary.can_apply;
  return (
    <div className="w-full max-w-3xl rounded-lg border bg-background p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ticketStatusClass(ticket.status)}`}>
              {ticketStatusLabel(ticket.status)}
            </span>
            <span className="text-xs text-muted-foreground">Ticket factura</span>
          </div>
          <div className="mt-2 font-medium">{summary.proveedor_nombre ?? 'Proveedor sin identificar'}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[typeText || null, numberText || null, summary.fecha || null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold">{formatMoney(summary.total)}</div>
          <div className="text-xs text-muted-foreground">
            {summary.items_count} items · {summary.productos_pendientes} pendientes
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="text-muted-foreground">Stock</div>
          <div className="font-medium">{summary.afecta_stock ? 'Actualiza' : 'No actualiza'}</div>
        </div>
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="text-muted-foreground">Proveedor/CC</div>
          <div className="font-medium">{summary.afecta_cuenta_corriente ? 'Impacta' : 'Sin impacto'}</div>
        </div>
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="text-muted-foreground">Costos</div>
          <div className="font-medium">{summary.actualizar_costos ? 'Actualiza' : 'No actualiza'}</div>
        </div>
      </div>

      {summary.bloqueantes.length > 0 ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {summary.bloqueantes.join(' ')}
        </div>
      ) : null}

      {summary.advertencias.length > 0 || summary.conflictos.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {[...summary.advertencias, ...summary.conflictos].slice(0, 5).join(' ')}
        </div>
      ) : null}

      {summary.cambios_costos.length > 0 ? (
        <div className="mt-3 rounded-md border p-2 text-xs">
          <div className="font-medium">Cambios de costo</div>
          <div className="mt-1 space-y-1">
            {summary.cambios_costos.slice(0, 4).map((cambio, index) => (
              <div key={`${cambio.producto_id ?? index}`} className="text-muted-foreground">
                {cambio.nombre ?? cambio.codigo ?? 'Producto'}: {formatMoney(cambio.precio_costo_anterior)} a{' '}
                {formatMoney(cambio.precio_costo_nuevo)}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {ticket.pending_items.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium">Productos pendientes</div>
          {ticket.pending_items.map((item) => {
            const key = ticketItemKey(ticket.id, item.indice);
            const results = productResults[key] ?? [];
            const searching = productSearchBusyKey === key;
            return (
              <div key={key} className="rounded-md border p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{item.descripcion}</div>
                    <div className="text-xs text-muted-foreground">
                      {[item.codigo ? `Cod. ${item.codigo}` : null, item.cantidad != null ? `Cant. ${item.cantidad}` : null, item.precio_unitario != null ? formatMoney(item.precio_unitario) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className="rounded-full border bg-muted px-2 py-0.5 text-[0.7rem] text-muted-foreground">
                    {item.motivo === 'requires_review' ? 'Revisar match' : 'Sin producto'}
                  </span>
                </div>
                <div className="mt-2 flex flex-col gap-2 md:flex-row">
                  <Input
                    value={productSearch[key] ?? item.descripcion}
                    onChange={(event) => onSearchChange(key, event.target.value)}
                    placeholder="Buscar producto"
                    disabled={busy}
                    className="h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSearchProducts(ticket, item)}
                    disabled={busy || searching}
                  >
                    <Search className="size-3.5" />
                    {searching ? 'Buscando...' : 'Buscar'}
                  </Button>
                </div>
                {results.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {results.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-60"
                        onClick={() => onLinkProduct(ticket, item, product)}
                        disabled={busy}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{product.nombre}</span>
                          <span className="text-muted-foreground">
                            {[product.codigo ? `Cod. ${product.codigo}` : null, product.unidad ?? null, product.precio_costo != null ? formatMoney(product.precio_costo) : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <Link2 className="size-3.5 shrink-0" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {canLoad ? (
          <Button type="button" size="sm" onClick={() => onContinue(ticket.id)} disabled={busy}>
            <CheckCircle2 className="size-3.5" />
            Cargar factura
          </Button>
        ) : null}
        {ticket.status === 'needs_review' ? (
          <Button type="button" variant="outline" size="sm" disabled>
            <Search className="size-3.5" />
            Revisar productos
          </Button>
        ) : null}
        {canClose ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onClose(ticket.id)} disabled={busy}>
            <XCircle className="size-3.5" />
            Cerrar ticket
          </Button>
        ) : null}
        {summary.impact_hash ? (
          <span className="self-center text-[0.7rem] text-muted-foreground">
            Hash {summary.impact_hash.slice(0, 12)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function WhatsAppJobsClient() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<BindUser[]>([]);
  const [actors, setActors] = useState<BindActor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingActors, setLoadingActors] = useState(true);
  const [actorsForbidden, setActorsForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorsError, setActorsError] = useState<string | null>(null);
  const [actorsInfo, setActorsInfo] = useState<string | null>(null);
  const [bindUserId, setBindUserId] = useState<string>('');
  const [bindWaId, setBindWaId] = useState('');
  const [bindRole, setBindRole] = useState<'owner' | 'admin' | 'operador' | 'readonly'>(
    'operador',
  );
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyActorId, setVerifyActorId] = useState<string>('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [removingActorId, setRemovingActorId] = useState<string | null>(null);
  const [featureFlag, setFeatureFlag] = useState<AgentFeatureFlag | null>(null);
  const [loadingFeatureFlag, setLoadingFeatureFlag] = useState(true);
  const [updatingFeatureFlag, setUpdatingFeatureFlag] = useState(false);
  const [featureFlagError, setFeatureFlagError] = useState<string | null>(null);
  const [channelConfig, setChannelConfig] = useState<WhatsAppChannelConfig | null>(null);
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelInfo, setChannelInfo] = useState<string | null>(null);
  const [channelPhoneNumberId, setChannelPhoneNumberId] = useState('');
  const [channelActiveValue, setChannelActiveValue] = useState<'active' | 'inactive'>('active');
  const [sandboxMessages, setSandboxMessages] = useState<SandboxMessage[]>([]);
  const [sandboxTickets, setSandboxTickets] = useState<SandboxInvoiceTicket[]>([]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [loadingSandbox, setLoadingSandbox] = useState(true);
  const [loadingSandboxTickets, setLoadingSandboxTickets] = useState(true);
  const [sendingSandbox, setSendingSandbox] = useState(false);
  const [clearingSandbox, setClearingSandbox] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxInvoiceFile, setSandboxInvoiceFile] = useState<File | null>(null);
  const [sandboxInvoiceInputKey, setSandboxInvoiceInputKey] = useState(0);
  const [uploadingSandboxInvoice, setUploadingSandboxInvoice] = useState(false);
  const [ticketBusyId, setTicketBusyId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState<Record<string, string>>({});
  const [productResults, setProductResults] = useState<Record<string, ProductOption[]>>({});
  const [productSearchBusyKey, setProductSearchBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/jobs?limit=100', { cache: 'no-store' });
      const json = (await res.json()) as { jobs?: Row[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la bandeja');
      setRows(json.jobs ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActors = useCallback(async () => {
    setLoadingActors(true);
    setActorsError(null);
    try {
      const res = await fetch('/api/whatsapp/actors', { cache: 'no-store' });
      const json = (await res.json()) as { users?: BindUser[]; actors?: BindActor[]; error?: string };
      if (res.status === 403) {
        setActorsForbidden(true);
        setUsers([]);
        setActors([]);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar las vinculaciones');
      setActorsForbidden(false);
      setUsers(json.users ?? []);
      setActors(json.actors ?? []);
    } catch (e) {
      setActorsError((e as Error).message);
    } finally {
      setLoadingActors(false);
    }
  }, []);

  const loadFeatureFlag = useCallback(async () => {
    setLoadingFeatureFlag(true);
    setFeatureFlagError(null);
    try {
      const res = await fetch('/api/whatsapp/feature-flag', { cache: 'no-store' });
      const json = (await res.json()) as {
        enabled?: boolean;
        rollout_stage?: string;
        notes?: string | null;
        can_manage?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el feature flag');
      setFeatureFlag({
        enabled: Boolean(json.enabled),
        rollout_stage: String(json.rollout_stage ?? 'disabled'),
        notes: json.notes ?? null,
        can_manage: Boolean(json.can_manage),
      });
    } catch (e) {
      setFeatureFlagError((e as Error).message);
    } finally {
      setLoadingFeatureFlag(false);
    }
  }, []);

  const loadChannel = useCallback(async () => {
    setLoadingChannel(true);
    setChannelError(null);
    try {
      const res = await fetch('/api/whatsapp/channel', { cache: 'no-store' });
      const json = (await res.json()) as {
        channel_id?: string | null;
        phone_number_id?: string | null;
        activa?: boolean;
        has_channel?: boolean;
        configured_via_env?: boolean;
        can_manage_platform?: boolean;
        linked_verified_actors?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el canal de WhatsApp');
      const nextConfig: WhatsAppChannelConfig = {
        mode: 'platform',
        channel_id: json.channel_id ?? null,
        phone_number_id: json.phone_number_id ?? null,
        activa: Boolean(json.activa),
        has_channel: Boolean(json.has_channel),
        configured_via_env: Boolean(json.configured_via_env),
        can_manage_platform: Boolean(json.can_manage_platform),
        linked_verified_actors: Number(json.linked_verified_actors ?? 0),
      };
      setChannelConfig(nextConfig);
      setChannelPhoneNumberId(nextConfig.phone_number_id ?? '');
      setChannelActiveValue(nextConfig.activa ? 'active' : 'inactive');
    } catch (e) {
      setChannelError((e as Error).message);
    } finally {
      setLoadingChannel(false);
    }
  }, []);

  const loadSandbox = useCallback(async () => {
    setLoadingSandbox(true);
    setSandboxError(null);
    try {
      const res = await fetch('/api/whatsapp/sandbox/chat', { cache: 'no-store' });
      const json = (await res.json()) as { messages?: SandboxMessage[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el chat de prueba');
      setSandboxMessages(json.messages ?? []);
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setLoadingSandbox(false);
    }
  }, []);

  const loadSandboxTickets = useCallback(async () => {
    setLoadingSandboxTickets(true);
    setSandboxError(null);
    try {
      const res = await fetch('/api/whatsapp/sandbox/facturas/tickets?limit=30', { cache: 'no-store' });
      const json = (await res.json()) as { tickets?: SandboxInvoiceTicket[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los tickets de factura');
      setSandboxTickets(json.tickets ?? []);
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setLoadingSandboxTickets(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadActors();
  }, [loadActors]);

  useEffect(() => {
    void loadFeatureFlag();
  }, [loadFeatureFlag]);

  useEffect(() => {
    void loadChannel();
  }, [loadChannel]);

  useEffect(() => {
    void loadSandbox();
  }, [loadSandbox]);

  useEffect(() => {
    void loadSandboxTickets();
  }, [loadSandboxTickets]);

  useEffect(() => {
    if (!users.length) {
      setBindUserId('');
      return;
    }
    const exists = users.some((u) => u.id === bindUserId);
    if (!exists) setBindUserId(users[0].id);
  }, [users, bindUserId]);

  useEffect(() => {
    if (!actors.length) {
      setVerifyActorId('');
      return;
    }
    const activeActors = actors.filter((a) => a.activo);
    const preferred = activeActors.find((a) => a.trust_level !== 'verified') ?? activeActors[0];
    if (!preferred) return;
    const exists = actors.some((a) => a.id === verifyActorId);
    if (!exists) setVerifyActorId(preferred.id);
  }, [actors, verifyActorId]);

  const counters = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === 'queued') acc.queued += 1;
        if (r.status === 'processing') acc.processing += 1;
        if (r.status === 'awaiting_branch_confirmation') acc.awaiting += 1;
        if (r.status === 'review_required') acc.review += 1;
        if (r.status === 'error') acc.error += 1;
        return acc;
      },
      { total: 0, queued: 0, processing: 0, awaiting: 0, review: 0, error: 0 },
    );
  }, [rows]);

  const activeActors = useMemo(() => actors.filter((a) => a.activo), [actors]);
  const activeSandboxTickets = useMemo(
    () => sandboxTickets.filter((ticket) => ticket.status === 'ready' || ticket.status === 'needs_review' || ticket.status === 'error'),
    [sandboxTickets],
  );

  async function reprocess(jobId: string) {
    setBusyId(jobId);
    try {
      const res = await fetch('/api/whatsapp/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reprocess', job_id: jobId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo reintentar');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function sendOtp() {
    if (!bindUserId || !bindWaId.trim()) {
      setActorsError('Seleccioná usuario y número de WhatsApp.');
      return;
    }
    setActorsInfo(null);
    setActorsError(null);
    setSendingOtp(true);
    try {
      const res = await fetch('/api/whatsapp/actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_otp',
          usuario_id: bindUserId,
          from_wa_id: bindWaId,
          rol_whatsapp: bindRole,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        actor_id?: string;
        expires_at?: string;
        to_wa_id_masked?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar el OTP');
      setActorsInfo(
        `Código enviado a ${json.to_wa_id_masked ?? 'número seleccionado'}. Vence ${formatDate(
          json.expires_at,
        )}.`,
      );
      setVerifyActorId(json.actor_id ?? '');
      setVerifyCode('');
      await loadActors();
    } catch (e) {
      setActorsError((e as Error).message);
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyOtp() {
    if (!verifyActorId || !verifyCode.trim()) {
      setActorsError('Elegí una vinculación y escribí el código OTP.');
      return;
    }
    setActorsInfo(null);
    setActorsError(null);
    setVerifyingOtp(true);
    try {
      const res = await fetch('/api/whatsapp/actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_otp',
          actor_id: verifyActorId,
          code: verifyCode.trim(),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        attempts_left?: number;
      };
      if (!res.ok) {
        const attemptsText =
          typeof json.attempts_left === 'number' ? ` Intentos restantes: ${json.attempts_left}.` : '';
        throw new Error(`${json.error ?? 'No se pudo verificar el OTP'}${attemptsText}`);
      }
      setActorsInfo('Vinculación verificada correctamente. El número quedó habilitado.');
      setVerifyCode('');
      await loadActors();
    } catch (e) {
      setActorsError((e as Error).message);
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function removeActorBinding(actor: BindActor, mode: 'unlink' | 'delete') {
    const isUnlink = mode === 'unlink';
    const accepted = await confirm({
      title: isUnlink ? 'Desvincular WhatsApp' : 'Eliminar vinculación',
      description: isUnlink
        ? `Se desactivará el acceso de ${actor.from_wa_id_masked} al canal. Podés volver a vincularlo con OTP.`
        : `Se eliminará el registro de ${actor.from_wa_id_masked} (${actor.usuario?.nombre ?? 'usuario'}). Esta acción no se puede deshacer.`,
      confirmLabel: isUnlink ? 'Desvincular' : 'Eliminar',
      cancelLabel: 'Cancelar',
      confirmVariant: isUnlink ? 'default' : 'destructive',
    });
    if (!accepted) return;

    setActorsInfo(null);
    setActorsError(null);
    setRemovingActorId(actor.id);
    try {
      const res = await fetch('/api/whatsapp/actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_actor',
          actor_id: actor.id,
          mode,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo quitar la vinculación');
      setActorsInfo(isUnlink ? 'Número desvinculado.' : 'Vinculación eliminada.');
      if (verifyActorId === actor.id) {
        setVerifyActorId('');
        setVerifyCode('');
      }
      await loadActors();
    } catch (e) {
      setActorsError((e as Error).message);
    } finally {
      setRemovingActorId(null);
    }
  }

  async function toggleFeatureFlag(nextEnabled: boolean) {
    if (!featureFlag?.can_manage) {
      setFeatureFlagError('Solo owner/admin puede cambiar este flag.');
      return;
    }
    setUpdatingFeatureFlag(true);
    setFeatureFlagError(null);
    try {
      const res = await fetch('/api/whatsapp/feature-flag', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: nextEnabled,
          rollout_stage: nextEnabled ? 'pilot' : 'disabled',
          notes: nextEnabled ? 'pilot_whatsapp_agentico' : 'disabled_by_operator',
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo actualizar el feature flag');
      await loadFeatureFlag();
    } catch (e) {
      setFeatureFlagError((e as Error).message);
    } finally {
      setUpdatingFeatureFlag(false);
    }
  }

  async function saveChannelConfig() {
    if (!channelConfig?.can_manage_platform) {
      setChannelError('Solo super admin puede configurar el canal central de WhatsApp.');
      return;
    }

    setSavingChannel(true);
    setChannelInfo(null);
    setChannelError(null);
    try {
      const res = await fetch('/api/whatsapp/channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number_id: channelPhoneNumberId,
          activa: channelActiveValue === 'active',
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar el canal');
      setChannelInfo(
        channelActiveValue === 'active'
          ? 'Canal central activo. Todos los negocios comparten este numero; cada usuario se vincula con OTP abajo.'
          : 'Canal central desactivado.',
      );
      await loadChannel();
    } catch (e) {
      setChannelError((e as Error).message);
    } finally {
      setSavingChannel(false);
    }
  }

  async function sendSandboxMessage() {
    const message = sandboxInput.trim();
    if (!message || sendingSandbox || uploadingSandboxInvoice) return;

    setSendingSandbox(true);
    setSandboxError(null);
    try {
      const res = await fetch('/api/whatsapp/sandbox/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const json = (await res.json()) as { messages?: SandboxMessage[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar el mensaje');
      setSandboxMessages(json.messages ?? []);
      await loadSandboxTickets();
      setSandboxInput('');
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setSendingSandbox(false);
    }
  }

  async function clearSandboxChat() {
    setClearingSandbox(true);
    setSandboxError(null);
    try {
      const res = await fetch('/api/whatsapp/sandbox/chat', { method: 'DELETE' });
      const json = (await res.json()) as { messages?: SandboxMessage[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo limpiar el chat');
      setSandboxMessages(json.messages ?? []);
      await loadSandboxTickets();
      setSandboxInput('');
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setClearingSandbox(false);
    }
  }

  async function uploadSandboxInvoice() {
    if (!sandboxInvoiceFile || uploadingSandboxInvoice) return;

    setUploadingSandboxInvoice(true);
    setSandboxError(null);
    try {
      const formData = new FormData();
      formData.append('archivo', sandboxInvoiceFile);
      const res = await fetch('/api/whatsapp/sandbox/facturas', {
        method: 'POST',
        body: formData,
      });
      const json = (await res.json()) as { messages?: SandboxMessage[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la factura');
      setSandboxMessages(json.messages ?? []);
      await loadSandboxTickets();
      setSandboxInvoiceFile(null);
      setSandboxInvoiceInputKey((key) => key + 1);
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setUploadingSandboxInvoice(false);
    }
  }

  async function continueSandboxTicket(ticketId: string) {
    setTicketBusyId(ticketId);
    setSandboxError(null);
    try {
      const res = await fetch(`/api/whatsapp/sandbox/facturas/tickets/${ticketId}/continuar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        ticket?: SandboxInvoiceTicket;
        messages?: SandboxMessage[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la factura');
      if (json.messages) setSandboxMessages(json.messages);
      await loadSandboxTickets();
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setTicketBusyId(null);
    }
  }

  async function closeSandboxTicket(ticketId: string) {
    setTicketBusyId(ticketId);
    setSandboxError(null);
    try {
      const res = await fetch(`/api/whatsapp/sandbox/facturas/tickets/${ticketId}/cerrar`, {
        method: 'POST',
      });
      const json = (await res.json()) as {
        ticket?: SandboxInvoiceTicket;
        messages?: SandboxMessage[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cerrar el ticket');
      if (json.messages) setSandboxMessages(json.messages);
      await loadSandboxTickets();
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setTicketBusyId(null);
    }
  }

  async function searchSandboxProducts(ticket: SandboxInvoiceTicket, item: SandboxInvoicePendingItem) {
    const key = ticketItemKey(ticket.id, item.indice);
    const query = (productSearch[key] ?? item.descripcion).trim();
    if (!query) return;
    setProductSearchBusyKey(key);
    setSandboxError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        alcance: 'tenant',
        pagina: '1',
        por_pagina: '8',
      });
      const res = await fetch(`/api/productos?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as { productos?: ProductOption[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron buscar productos');
      setProductResults((prev) => ({ ...prev, [key]: json.productos ?? [] }));
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setProductSearchBusyKey(null);
    }
  }

  async function linkSandboxProduct(
    ticket: SandboxInvoiceTicket,
    item: SandboxInvoicePendingItem,
    product: ProductOption,
  ) {
    const key = ticketItemKey(ticket.id, item.indice);
    setTicketBusyId(ticket.id);
    setSandboxError(null);
    try {
      const res = await fetch(`/api/whatsapp/sandbox/facturas/tickets/${ticket.id}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_indice: item.indice, producto_id: product.id }),
      });
      const json = (await res.json()) as {
        ticket?: SandboxInvoiceTicket;
        messages?: SandboxMessage[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enlazar el producto');
      if (json.messages) setSandboxMessages(json.messages);
      setProductResults((prev) => ({ ...prev, [key]: [] }));
      setProductSearch((prev) => ({ ...prev, [key]: product.nombre }));
      await loadSandboxTickets();
    } catch (e) {
      setSandboxError((e as Error).message);
    } finally {
      setTicketBusyId(null);
    }
  }

  function trustLabel(v: string) {
    switch (v) {
      case 'verified':
        return 'Verificado';
      case 'blocked':
        return 'Bloqueado';
      case 'unverified':
      default:
        return 'Sin verificar';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bandeja WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Monitoreo de adjuntos de proveedores, estados y reintentos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            nativeButton={false}
            variant="outline"
            render={
              <Link href="/whatsapp/logs">
                <FileClock className="size-3.5" />
                Ver logs
              </Link>
            }
          />
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Actualizar
          </Button>
        </div>
      </div>

      <section className="rounded-lg border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">Chat de prueba</h2>
            <p className="text-xs text-muted-foreground">
              Simulador interno con datos del negocio y acciones sin impacto real.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void loadSandbox();
                void loadSandboxTickets();
              }}
              disabled={
                loadingSandbox ||
                loadingSandboxTickets ||
                sendingSandbox ||
                clearingSandbox ||
                uploadingSandboxInvoice
              }
            >
              <RefreshCcw className="size-3.5" />
              Actualizar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void clearSandboxChat()}
              disabled={
                loadingSandbox ||
                sendingSandbox ||
                clearingSandbox ||
                uploadingSandboxInvoice ||
                sandboxMessages.length === 0
              }
            >
              <Trash2 className="size-3.5" />
              Limpiar
            </Button>
          </div>
        </div>

        <div className="mt-4 h-[22rem] overflow-y-auto rounded-lg border bg-background p-3">
          {loadingSandbox ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Cargando chat...
            </div>
          ) : sandboxMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Todavia no hay mensajes de prueba.
            </div>
          ) : (
            <div className="space-y-3">
              {sandboxMessages.map((message) => {
                const isUser = message.role === 'user';
                const documentLink =
                  typeof message.metadata?.document_link === 'string'
                    ? String(message.metadata.document_link)
                    : null;
                return (
                  <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[min(48rem,95%)] rounded-lg px-3 py-2 text-sm ${
                        isUser ? 'bg-primary text-primary-foreground' : 'border bg-muted/40 text-foreground'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      {documentLink ? (
                        <a
                          className="mt-2 block font-medium underline"
                          href={documentLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir documento
                        </a>
                      ) : null}
                      <div
                        className={`mt-1 text-[0.7rem] ${
                          isUser ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}
                      >
                        {formatDate(message.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <form
          className="mt-3 flex flex-col gap-2 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void sendSandboxMessage();
          }}
        >
          <textarea
            value={sandboxInput}
            onChange={(event) => setSandboxInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendSandboxMessage();
              }
            }}
            placeholder="Escribile al bot de prueba..."
            rows={3}
            className="min-h-20 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={sendingSandbox || clearingSandbox || uploadingSandboxInvoice}
          />
          <Button
            type="submit"
            className="md:self-end"
            disabled={sendingSandbox || clearingSandbox || uploadingSandboxInvoice || !sandboxInput.trim()}
          >
            <Send className="size-4" />
            {sendingSandbox ? 'Enviando...' : 'Enviar'}
          </Button>
        </form>

        <div className="mt-3 flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 md:flex-row md:items-center">
          <Input
            key={sandboxInvoiceInputKey}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => setSandboxInvoiceFile(event.target.files?.[0] ?? null)}
            disabled={loadingSandbox || sendingSandbox || clearingSandbox || uploadingSandboxInvoice}
            className="md:max-w-md"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void uploadSandboxInvoice()}
            disabled={
              loadingSandbox ||
              sendingSandbox ||
              clearingSandbox ||
              uploadingSandboxInvoice ||
              !sandboxInvoiceFile
            }
          >
            <Paperclip className="size-4" />
            {uploadingSandboxInvoice ? 'Procesando...' : 'Cargar factura real'}
          </Button>
          <span className="text-xs text-muted-foreground">
            PDF o imagen. La confirmacion por codigo impacta datos reales.
          </span>
        </div>

        {activeSandboxTickets.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Tickets activos</div>
            {activeSandboxTickets.map((ticket) => (
              <SandboxInvoiceTicketCard
                key={ticket.id}
                ticket={ticket}
                busy={ticketBusyId === ticket.id || uploadingSandboxInvoice}
                productSearch={productSearch}
                productResults={productResults}
                productSearchBusyKey={productSearchBusyKey}
                onContinue={(id) => void continueSandboxTicket(id)}
                onClose={(id) => void closeSandboxTicket(id)}
                onSearchChange={(key, value) => setProductSearch((prev) => ({ ...prev, [key]: value }))}
                onSearchProducts={(nextTicket, item) => void searchSandboxProducts(nextTicket, item)}
                onLinkProduct={(nextTicket, item, product) => void linkSandboxProduct(nextTicket, item, product)}
              />
            ))}
          </div>
        ) : null}

        {sandboxError ? (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {sandboxError}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">Rollout agente WhatsApp</h2>
            <p className="text-xs text-muted-foreground">
              Activá el piloto por tenant antes de habilitar consultas y acciones por chat.
            </p>
          </div>
          <Button
            variant={featureFlag?.enabled ? 'destructive' : 'default'}
            disabled={loadingFeatureFlag || updatingFeatureFlag || !featureFlag?.can_manage}
            onClick={() => void toggleFeatureFlag(!(featureFlag?.enabled ?? false))}
          >
            {updatingFeatureFlag
              ? 'Guardando…'
              : featureFlag?.enabled
                ? 'Desactivar piloto'
                : 'Activar piloto'}
          </Button>
        </div>

        <div className="mt-3 text-sm">
          {loadingFeatureFlag ? (
            <span className="text-muted-foreground">Cargando estado...</span>
          ) : (
            <div className="space-y-1">
              <p>
                Estado:{' '}
                <span className={featureFlag?.enabled ? 'font-semibold text-emerald-700' : 'font-semibold'}>
                  {featureFlag?.enabled ? 'Activo' : 'Inactivo'}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">Stage: {featureFlag?.rollout_stage ?? 'disabled'}</p>
              {featureFlag?.notes ? (
                <p className="text-xs text-muted-foreground">Notas: {featureFlag.notes}</p>
              ) : null}
              {!featureFlag?.can_manage ? (
                <p className="text-xs text-muted-foreground">Tu usuario no puede cambiar este flag.</p>
              ) : null}
            </div>
          )}
        </div>

        {featureFlagError ? (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {featureFlagError}
          </div>
        ) : null}
      </section>

      <WhatsAppBranchRulesPanel />

      <section className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Canal WhatsApp central SmartStock</h2>
          <span className="text-xs text-muted-foreground">
            Un solo numero para todos los negocios. El sistema identifica cada comercio por el WhatsApp del usuario vinculado.
          </span>
        </div>

        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Este negocio tiene {channelConfig?.linked_verified_actors ?? 0} numero
          {channelConfig?.linked_verified_actors === 1 ? '' : 's'} verificado
          {channelConfig?.linked_verified_actors === 1 ? '' : 's'}. Los usuarios escriben al canal central; las
          respuestas usan solo datos de su negocio.
        </div>

        {channelConfig?.can_manage_platform ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Input
              value={channelPhoneNumberId}
              onChange={(e) => setChannelPhoneNumberId(e.target.value)}
              placeholder="Phone Number ID (Meta)"
              disabled={loadingChannel || savingChannel || channelConfig?.configured_via_env}
            />

            <Select
              value={channelActiveValue}
              onValueChange={(v) => setChannelActiveValue((v as 'active' | 'inactive') ?? 'active')}
              disabled={loadingChannel || savingChannel || channelConfig?.configured_via_env}
            >
              <SelectTrigger>
                <SelectValue placeholder="Estado del canal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SelectContent>
            </Select>

            <div className="md:col-span-2">
              <Button
                onClick={() => void saveChannelConfig()}
                disabled={loadingChannel || savingChannel || channelConfig?.configured_via_env}
              >
                {savingChannel ? 'Guardando canal…' : 'Guardar canal central'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            La configuracion del numero central la gestiona un super admin de SmartStock.
          </p>
        )}

        <div className="mt-3 text-xs text-muted-foreground">
          {loadingChannel ? (
            <span>Cargando canal...</span>
          ) : (
            <span>
              Estado central: {channelConfig?.activa ? 'Activo' : 'Inactivo'} · Phone Number ID:{' '}
              {channelConfig?.phone_number_id ?? 'No configurado'}
              {channelConfig?.configured_via_env ? ' · definido por variable de entorno' : ''}
            </span>
          )}
        </div>

        {channelError ? (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {channelError}
          </div>
        ) : null}
        {channelInfo ? (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
            {channelInfo}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Vinculación WhatsApp por usuario (OTP)</h2>
          <span className="text-xs text-muted-foreground">Solo owner/admin puede gestionar esta sección.</span>
        </div>

        {actorsForbidden ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Tu rol puede ver la bandeja, pero no gestionar vinculaciones de números.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <Select
                value={bindUserId}
                onValueChange={(v) => setBindUserId(v ?? '')}
                disabled={loadingActors || sendingOtp}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Usuario del negocio" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nombre} {u.apellido} · {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={bindWaId}
                onChange={(e) => setBindWaId(e.target.value)}
                placeholder="WhatsApp del usuario (ej: 54911...)"
                disabled={loadingActors || sendingOtp}
              />

              <Select
                value={bindRole}
                onValueChange={(v) => setBindRole(v as 'owner' | 'admin' | 'operador' | 'readonly')}
                disabled={loadingActors || sendingOtp}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Rol de canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="operador">Operador</SelectItem>
                  <SelectItem value="readonly">Readonly</SelectItem>
                </SelectContent>
              </Select>

              <Button onClick={() => void sendOtp()} disabled={sendingOtp || loadingActors || !bindUserId}>
                {sendingOtp ? 'Enviando OTP…' : 'Enviar OTP'}
              </Button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Select
                value={verifyActorId}
                onValueChange={(v) => setVerifyActorId(v ?? '')}
                disabled={loadingActors || verifyingOtp || activeActors.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Vinculación a verificar" />
                </SelectTrigger>
                <SelectContent>
                  {activeActors.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {(a.usuario?.nombre ?? 'Usuario')} {(a.usuario?.apellido ?? '')} · {a.from_wa_id_masked}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="Código OTP"
                disabled={loadingActors || verifyingOtp}
              />

              <div className="md:col-span-2">
                <Button onClick={() => void verifyOtp()} disabled={verifyingOtp || !verifyActorId}>
                  {verifyingOtp ? 'Verificando…' : 'Verificar OTP'}
                </Button>
              </div>
            </div>
          </>
        )}

        {actorsError ? (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {actorsError}
          </div>
        ) : null}
        {actorsInfo ? (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
            {actorsInfo}
          </div>
        ) : null}

        {!actorsForbidden ? (
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">WhatsApp</th>
                  <th className="px-3 py-2">Rol canal</th>
                  <th className="px-3 py-2">Confianza</th>
                  <th className="px-3 py-2">Último challenge</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loadingActors ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      Cargando vinculaciones...
                    </td>
                  </tr>
                ) : actors.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      No hay números vinculados todavía.
                    </td>
                  </tr>
                ) : (
                  actors.map((a) => {
                    const canUnlink = a.activo && a.trust_level === 'verified';
                    const canDelete = !canUnlink;
                    const busy = removingActorId === a.id;

                    return (
                    <tr key={a.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        {(a.usuario?.nombre ?? '—')} {(a.usuario?.apellido ?? '')}
                        <div className="text-xs text-muted-foreground">{a.usuario?.email ?? ''}</div>
                      </td>
                      <td className="px-3 py-2">{a.from_wa_id_masked}</td>
                      <td className="px-3 py-2">{a.rol_whatsapp}</td>
                      <td className="px-3 py-2">
                        {trustLabel(a.trust_level)}
                        {!a.activo ? <div className="text-xs text-muted-foreground">Inactivo</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        {a.latest_challenge?.status ?? '—'}
                        {a.latest_challenge?.expires_at ? (
                          <div className="text-xs text-muted-foreground">
                            Vence: {formatDate(a.latest_challenge.expires_at)}
                          </div>
                        ) : null}
                        {a.latest_challenge?.blocked_until ? (
                          <div className="text-xs text-muted-foreground">
                            Bloqueado hasta: {formatDate(a.latest_challenge.blocked_until)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {canUnlink ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy || sendingOtp || verifyingOtp}
                              onClick={() => void removeActorBinding(a, 'unlink')}
                            >
                              <Unlink className="size-3.5" />
                              Desvincular
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy || sendingOtp || verifyingOtp}
                              onClick={() => void removeActorBinding(a, 'delete')}
                            >
                              <Trash2 className="size-3.5" />
                              Eliminar
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-6">
        <div className="rounded-lg border p-3 text-sm">Total: {counters.total}</div>
        <div className="rounded-lg border p-3 text-sm">En cola: {counters.queued}</div>
        <div className="rounded-lg border p-3 text-sm">Procesando: {counters.processing}</div>
        <div className="rounded-lg border p-3 text-sm">Esperando sucursal: {counters.awaiting}</div>
        <div className="rounded-lg border p-3 text-sm">Revisión: {counters.review}</div>
        <div className="rounded-lg border p-3 text-sm">Error: {counters.error}</div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Remitente</th>
              <th className="px-3 py-2">Archivo</th>
              <th className="px-3 py-2">Resolución sucursal</th>
              <th className="px-3 py-2">Destino</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando bandeja...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No hay jobs todavía.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const msg = asOne(row.whatsapp_inbound_message);
                const att = asOne(row.whatsapp_inbound_attachment);
                const isRetryable =
                  row.status === 'error' ||
                  row.status === 'review_required' ||
                  row.status === 'awaiting_branch_confirmation';
                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="px-3 py-2">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2">{statusLabel(row.status)}</td>
                    <td className="px-3 py-2">{row.document_type ?? '—'}</td>
                    <td className="px-3 py-2">{msg?.from_wa_id ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div>{att?.filename ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{att?.mime_type ?? ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.branch_resolution_status ?? '—'}
                      {row.branch_resolution_reason ? (
                        <div className="text-xs text-muted-foreground">{row.branch_resolution_reason}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.target_entity_type ?? '—'}
                      {row.target_entity_id ? (
                        <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                          {row.target_entity_id}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.error_code ?? '—'}
                      {row.error_detail ? (
                        <div className="max-w-[20rem] truncate text-xs text-muted-foreground">
                          {row.error_detail}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isRetryable || busyId === row.id}
                        onClick={() => void reprocess(row.id)}
                      >
                        Reintentar
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {ConfirmDialog}
    </div>
  );
}
