'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Check,
  Clock3,
  Copy,
  FileJson,
  RefreshCcw,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type JsonValue = unknown;

type LogActorUser = {
  id?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  email?: string | null;
  rol?: string | null;
};

type LogActor = {
  id?: string | null;
  from_wa_id?: string | null;
  rol_whatsapp?: string | null;
  trust_level?: string | null;
  usuario?: LogActorUser | LogActorUser[] | null;
};

type WhatsAppLogRow = {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  usuario_id: string | null;
  inbound_message_id: string | null;
  action_log_id: string | null;
  from_wa_id: string | null;
  channel: 'live' | 'sandbox';
  source: string | null;
  input_body: string | null;
  resolved_message: string | null;
  reply_body: string | null;
  replies: JsonValue;
  intent: string | null;
  confidence: number | null;
  fallback_reason: string | null;
  status: 'success' | 'fallback' | 'error' | 'blocked';
  tool_name: string | null;
  tool_args: JsonValue;
  tool_result: JsonValue;
  tool_trace: JsonValue;
  processing_trace: JsonValue;
  duration_ms: number | null;
  error_detail: string | null;
  created_at: string;
  expires_at: string | null;
  actor?: LogActor | LogActor[] | null;
};

type ActorsResponse = {
  actors?: Array<{
    id: string;
    from_wa_id_masked?: string | null;
    from_wa_id?: string | null;
    rol_whatsapp?: string | null;
    usuario?: {
      nombre?: string | null;
      apellido?: string | null;
      email?: string | null;
    } | null;
  }>;
  error?: string;
};

type LogsResponse = {
  logs?: WhatsAppLogRow[];
  nextCursor?: string | null;
  error?: string;
};

const ALL = 'all';

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('es-AR');
}

function compactDate(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clip(value: string | null | undefined, max = 110) {
  const text = String(value ?? '').trim();
  if (!text) return '-';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function actorUserLabel(actor: LogActor | LogActor[] | null | undefined, fromWaId?: string | null) {
  const row = asOne(actor);
  const user = asOne(row?.usuario);
  const fullName = [user?.nombre, user?.apellido].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
  if (fullName) return fullName;
  if (user?.email) return String(user.email);
  if (fromWaId) return fromWaId;
  return 'Sin actor';
}

function actorMetaLabel(actor: LogActor | LogActor[] | null | undefined, fromWaId?: string | null) {
  const row = asOne(actor);
  const parts = [row?.rol_whatsapp, row?.trust_level].map((part) => String(part ?? '').trim()).filter(Boolean);
  const wa = row?.from_wa_id ?? fromWaId ?? '';
  return [wa, parts.join(' · ')].filter(Boolean).join(' · ');
}

function statusLabel(status: WhatsAppLogRow['status']) {
  switch (status) {
    case 'success':
      return 'OK';
    case 'fallback':
      return 'Fallback';
    case 'error':
      return 'Error';
    case 'blocked':
      return 'Bloqueado';
    default:
      return status;
  }
}

function statusClass(status: WhatsAppLogRow['status']) {
  switch (status) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'fallback':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'blocked':
      return 'border-zinc-200 bg-zinc-100 text-zinc-700';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function channelLabel(channel: WhatsAppLogRow['channel']) {
  return channel === 'sandbox' ? 'Sandbox' : 'Live';
}

function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function jsonBlock(value: JsonValue) {
  if (value == null || value === '') return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function writeClipboardText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback below for restricted clipboard contexts.
    }
  }

  if (typeof document === 'undefined') throw new Error('Clipboard no disponible.');
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) throw new Error('No se pudo copiar el detalle.');
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function buildParams(params: {
  limit: number;
  cursor?: string | null;
  actorId: string;
  channel: string;
  status: string;
  tool: string;
  intent: string;
  q: string;
  from: string;
  to: string;
}) {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.actorId !== ALL) search.set('actor_id', params.actorId);
  if (params.channel !== ALL) search.set('channel', params.channel);
  if (params.status !== ALL) search.set('status', params.status);
  if (params.tool !== ALL) search.set('tool', params.tool);
  if (params.intent !== ALL) search.set('intent', params.intent);
  if (params.q.trim()) search.set('q', params.q.trim());
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  return search;
}

export function WhatsAppLogsClient() {
  const [logs, setLogs] = useState<WhatsAppLogRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WhatsAppLogRow | null>(null);
  const [actorId, setActorId] = useState(ALL);
  const [channel, setChannel] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [tool, setTool] = useState(ALL);
  const [intent, setIntent] = useState(ALL);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actors, setActors] = useState<NonNullable<ActorsResponse['actors']>>([]);
  const [copiedDetailId, setCopiedDetailId] = useState<string | null>(null);

  const actorOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const actor of actors) {
      const label = [
        [actor.usuario?.nombre, actor.usuario?.apellido]
          .map((part) => String(part ?? '').trim())
          .filter(Boolean)
          .join(' ') || actor.usuario?.email || actor.from_wa_id_masked || actor.from_wa_id || actor.id,
        actor.from_wa_id_masked ?? actor.from_wa_id,
      ]
        .map((part) => String(part ?? '').trim())
        .filter(Boolean)
        .join(' · ');
      byId.set(actor.id, label);
    }
    for (const log of logs) {
      if (!log.actor_id || byId.has(log.actor_id)) continue;
      byId.set(log.actor_id, actorUserLabel(log.actor, log.from_wa_id));
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [actors, logs]);

  const toolOptions = useMemo(() => uniqueSorted(logs.map((log) => log.tool_name)), [logs]);
  const intentOptions = useMemo(() => uniqueSorted(logs.map((log) => log.intent)), [logs]);

  const loadActors = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/actors', { cache: 'no-store' });
      const json = (await res.json()) as ActorsResponse;
      if (!res.ok) return;
      setActors(json.actors ?? []);
    } catch {
      setActors([]);
    }
  }, []);

  const loadLogs = useCallback(
    async (mode: 'reset' | 'append' = 'reset', cursor?: string | null) => {
      if (mode === 'append') setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = buildParams({
          limit: 50,
          cursor,
          actorId,
          channel,
          status,
          tool,
          intent,
          q,
          from,
          to,
        });
        const res = await fetch(`/api/whatsapp/logs?${params.toString()}`, { cache: 'no-store' });
        const json = (await res.json()) as LogsResponse;
        if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los logs.');
        setLogs((current) => (mode === 'append' ? [...current, ...(json.logs ?? [])] : json.logs ?? []));
        setNextCursor(json.nextCursor ?? null);
      } catch (e) {
        setError((e as Error).message);
        if (mode === 'reset') {
          setLogs([]);
          setNextCursor(null);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [actorId, channel, status, tool, intent, q, from, to],
  );

  useEffect(() => {
    void loadActors();
  }, [loadActors]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLogs('reset');
    }, q.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs, q]);

  useEffect(() => {
    if (loading) return;
    if (logs.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !logs.some((log) => log.id === selected.id)) {
      setSelected(logs[0]);
    }
  }, [loading, logs, selected]);

  const clearFilters = () => {
    setActorId(ALL);
    setChannel(ALL);
    setStatus(ALL);
    setTool(ALL);
    setIntent(ALL);
    setQ('');
    setFrom('');
    setTo('');
  };

  const selectedJson = selected
    ? {
        id: selected.id,
        created_at: selected.created_at,
        tenant_id: selected.tenant_id,
        actor_id: selected.actor_id,
        usuario_id: selected.usuario_id,
        inbound_message_id: selected.inbound_message_id,
        action_log_id: selected.action_log_id,
        from_wa_id: selected.from_wa_id,
        channel: selected.channel,
        source: selected.source,
        input_body: selected.input_body,
        resolved_message: selected.resolved_message,
        reply_body: selected.reply_body,
        replies: selected.replies,
        intent: selected.intent,
        confidence: selected.confidence,
        fallback_reason: selected.fallback_reason,
        status: selected.status,
        duration_ms: selected.duration_ms,
        error_detail: selected.error_detail,
        tool_name: selected.tool_name,
        tool_args: selected.tool_args,
        tool_result: selected.tool_result,
        tool_trace: selected.tool_trace,
        processing_trace: selected.processing_trace,
        expires_at: selected.expires_at,
      }
    : null;

  const copySelectedDetail = async () => {
    if (!selected || !selectedJson) return;
    try {
      await writeClipboardText(jsonBlock(selectedJson));
      setCopiedDetailId(selected.id);
      window.setTimeout(() => {
        setCopiedDetailId((current) => (current === selected.id ? null : current));
      }, 1800);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2">
            <Button
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="-ml-2"
              render={
                <Link href="/whatsapp">
                  <ArrowLeft className="size-3.5" />
                  WhatsApp
                </Link>
              }
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs agente WhatsApp</h1>
          <p className="text-sm text-muted-foreground">Trazabilidad por turno del chatbot.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void loadLogs('reset')} disabled={loading}>
            <RefreshCcw className="size-3.5" />
            Actualizar
          </Button>
          <Button variant="ghost" onClick={clearFilters} disabled={loading}>
            Limpiar
          </Button>
        </div>
      </div>

      <section className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[minmax(180px,1.4fr)_repeat(4,minmax(130px,0.8fr))] xl:grid-cols-[minmax(220px,1.6fr)_repeat(7,minmax(128px,0.7fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Buscar"
              className="pl-8"
            />
          </div>

          <Select value={actorId} onValueChange={(value) => setActorId(value ?? ALL)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Actor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los actores</SelectItem>
              {actorOptions.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={channel} onValueChange={(value) => setChannel(value ?? ALL)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los canales</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="sandbox">Sandbox</SelectItem>
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(value) => setStatus(value ?? ALL)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              <SelectItem value="success">OK</SelectItem>
              <SelectItem value="fallback">Fallback</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="blocked">Bloqueado</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tool} onValueChange={(value) => setTool(value ?? ALL)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las tools</SelectItem>
              {toolOptions.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={intent} onValueChange={(value) => setIntent(value ?? ALL)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Intent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los intents</SelectItem>
              {intentOptions.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,1fr)_minmax(0,3fr)]">
        <section className="space-y-3">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          {loading ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
              Cargando logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
              Sin logs para estos filtros.
            </div>
          ) : (
            <div className="grid gap-2">
              {logs.map((log) => {
                const isSelected = selected?.id === log.id;
                return (
                  <button
                    key={log.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelected(log)}
                    className={[
                      'w-full rounded-lg border bg-card px-3 py-3 text-left shadow-sm transition',
                      'hover:border-primary/40 hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
                      isSelected ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20' : 'border-border',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill className="h-7 border-border bg-background px-2.5 text-[0.8rem] text-foreground">
                        {channelLabel(log.channel)}
                      </Pill>
                      <Pill className={`h-7 px-2.5 text-[0.8rem] ${statusClass(log.status)}`}>
                        {statusLabel(log.status)}
                      </Pill>
                      <span className="text-xs text-muted-foreground">{compactDate(log.created_at)}</span>
                    </div>

                    <div className="mt-3 min-w-0">
                      <div className="truncate text-base font-semibold leading-tight">
                        {actorUserLabel(log.actor, log.from_wa_id)}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {actorMetaLabel(log.actor, log.from_wa_id)}
                      </div>
                    </div>

                    <div className="mt-3 min-w-0">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Input</div>
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed">{clip(log.input_body, 150)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground shadow-sm">
            <span>{logs.length} turnos</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadLogs('append', nextCursor)}
              disabled={!nextCursor || loadingMore}
            >
              {loadingMore ? 'Cargando...' : 'Cargar mas'}
            </Button>
          </div>
        </section>

        <aside className="rounded-lg border bg-card p-4 text-[13px] shadow-sm xl:sticky xl:top-4">
          {selected ? (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <Bot className="size-3.5 shrink-0" />
                    <span className="truncate">Turno WhatsApp</span>
                  </h2>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void copySelectedDetail()}
                    >
                      {copiedDetailId === selected.id ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copiedDetailId === selected.id ? 'Copiado' : 'Copiar detalle'}
                    </Button>
                    <Pill className={statusClass(selected.status)}>{statusLabel(selected.status)}</Pill>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {formatDate(selected.created_at)} · {channelLabel(selected.channel)}
                </div>
              </div>

              <section className="border-t pt-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase text-muted-foreground">
                  <Clock3 className="size-3" />
                  Mensaje
                </div>
                <dl className="space-y-2.5">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Input</dt>
                    <dd className="whitespace-pre-wrap leading-relaxed">{selected.input_body ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Resolved message</dt>
                    <dd className="whitespace-pre-wrap leading-relaxed">{selected.resolved_message ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Respuesta</dt>
                    <dd className="whitespace-pre-wrap leading-relaxed">{selected.reply_body ?? '-'}</dd>
                  </div>
                </dl>
              </section>

              <section className="border-t pt-3">
                <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Procesamiento</div>
                <dl className="grid grid-cols-2 gap-2.5">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Intent</dt>
                    <dd className="break-all">{selected.intent ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Confidence</dt>
                    <dd>{selected.confidence ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Tool</dt>
                    <dd className="break-all">{selected.tool_name ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Duracion</dt>
                    <dd>{selected.duration_ms == null ? '-' : `${selected.duration_ms} ms`}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Fallback</dt>
                    <dd className="break-all">{selected.fallback_reason ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Source</dt>
                    <dd>{selected.source ?? '-'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[11px] text-muted-foreground">Error</dt>
                    <dd className="whitespace-pre-wrap leading-relaxed text-red-700">{selected.error_detail ?? '-'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[11px] text-muted-foreground">Action log</dt>
                    <dd className="break-all">{selected.action_log_id ?? '-'}</dd>
                  </div>
                </dl>
              </section>

              <details className="group border-t pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium uppercase text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <FileJson className="size-3" />
                    Tool trace
                  </span>
                  <span className="flex items-center gap-1 normal-case">
                    <span className="group-open:hidden">Abrir</span>
                    <span className="hidden group-open:inline">Cerrar</span>
                    <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
                  {jsonBlock(
                    selected.tool_trace ?? {
                      name: selected.tool_name,
                      args: selected.tool_args,
                      result: selected.tool_result,
                    },
                  )}
                </pre>
              </details>

              <details className="group border-t pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium uppercase text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <span>Processing trace</span>
                  <span className="flex items-center gap-1 normal-case">
                    <span className="group-open:hidden">Abrir</span>
                    <span className="hidden group-open:inline">Cerrar</span>
                    <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
                  {jsonBlock(selected.processing_trace)}
                </pre>
              </details>

              <details className="group border-t pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium uppercase text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <span>JSON completo</span>
                  <span className="flex items-center gap-1 normal-case">
                    <span className="group-open:hidden">Abrir</span>
                    <span className="hidden group-open:inline">Cerrar</span>
                    <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
                  {jsonBlock(selectedJson)}
                </pre>
              </details>
            </div>
          ) : (
            <div className="flex min-h-[320px] items-center justify-center text-center text-sm text-muted-foreground">
              Selecciona un log para ver el detalle.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
