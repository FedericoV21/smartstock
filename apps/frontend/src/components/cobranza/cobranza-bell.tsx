'use client';

import { Bell } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const POLL_MS = 90_000;
const NOTIFY_COOLDOWN_MS = 45 * 60 * 1000;
const NOTIFY_LS_KEY = 'smartstock-cobranza-notify-ms';
const OVERDUE_NOTIFY_DAY_LS_KEY = 'smartstock-cobranza-overdue-notify-ymd';
const CLEAR_TODAY_LS_KEY = 'smartstock-cobranza-clear-today-ymd';

function ymdArgentinaNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function tryCobranzaBrowserNotify(params: { count: number; vencidosCount: number; force?: boolean }) {
  const { count, vencidosCount, force = false } = params;
  if (typeof window === 'undefined' || count <= 0) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    if (vencidosCount > 0) {
      const ymd = ymdArgentinaNow();
      const lastYmd = localStorage.getItem(OVERDUE_NOTIFY_DAY_LS_KEY);
      if (force || lastYmd !== ymd) {
        localStorage.setItem(OVERDUE_NOTIFY_DAY_LS_KEY, ymd);
        localStorage.setItem(NOTIFY_LS_KEY, String(Date.now()));
        new Notification('Deudores vencidos', {
          body:
            vencidosCount === 1
              ? 'Hay 1 deuda vencida para gestionar hoy.'
              : `Hay ${vencidosCount} deudas vencidas para gestionar hoy.`,
          tag: 'smartstock-cobranza-vencidos',
        });
      }
      return;
    }

    const last = Number(localStorage.getItem(NOTIFY_LS_KEY) ?? '0');
    if (!force && Date.now() - last < NOTIFY_COOLDOWN_MS) return;
    localStorage.setItem(NOTIFY_LS_KEY, String(Date.now()));
    new Notification('Cobranzas pendientes', {
      body:
        count === 1
          ? 'Hay 1 factura en ventana de cobro o vencida.'
          : `Hay ${count} facturas en ventana de cobro o vencidas.`,
      tag: 'smartstock-cobranza',
    });
  } catch {
    // ignorar (permisos / políticas del navegador)
  }
}

type PendienteItem = {
  id: string;
  clienteId?: string;
  estado: 'recordatorio_dia_5' | 'vencido' | 'saldo_cobranza_diaria';
  clienteNombre: string;
  telefonoRaw: string | null;
  puedeWhatsApp: boolean;
  mensajeUrl: string | null;
  numeroComprobanteLabel: string;
  tipoComprobanteLabel: string;
  saldoPendiente: number;
  vencimientoAt: string;
  vencimientoLabel: string;
};

type PendientesResponse = {
  items?: PendienteItem[];
  error?: string;
  count?: number;
  vencidosCount?: number;
};

type FiltroEstado = 'todos' | 'vencidos' | 'proximos' | 'diaria';

export function CobranzaBell({ onDarkBackground = false }: { onDarkBackground?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PendienteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>('todos');
  const [silenciadoHoy, setSilenciadoHoy] = useState(false);

  useEffect(() => {
    try {
      setSilenciadoHoy(localStorage.getItem(CLEAR_TODAY_LS_KEY) === ymdArgentinaNow());
    } catch {
      setSilenciadoHoy(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cobranza/pendientes');
      const json = (await res.json()) as PendientesResponse;
      if (!res.ok) {
        setItems([]);
        setError(json.error ?? 'Error al cargar');
        return;
      }
      const next = json.items ?? [];
      setItems(next);
      if (!silenciadoHoy) {
        tryCobranzaBrowserNotify({
          count: next.length,
          vencidosCount: json.vencidosCount ?? next.filter((it) => it.estado === 'vencido').length,
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [silenciadoHoy]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  async function requestNotifyPermission() {
    if (typeof Notification === 'undefined') {
      setError('Tu navegador no soporta notificaciones de escritorio.');
      return;
    }
    const r = await Notification.requestPermission();
    if (r !== 'granted') {
      setError('Sin permiso no podemos mostrar avisos fuera de la pestaña.');
      return;
    }
    setError(null);
    try {
      const res = await fetch('/api/cobranza/pendientes');
      const json = (await res.json()) as PendientesResponse;
      if (res.ok) {
        const next = json.items ?? [];
        setItems(next);
        tryCobranzaBrowserNotify({
          count: next.length,
          vencidosCount: json.vencidosCount ?? next.filter((it) => it.estado === 'vencido').length,
          force: true,
        });
      }
    } catch {
      // ignorar
    }
  }

  async function snooze(id: string) {
    setSnoozingId(id);
    try {
      const res = await fetch(`/api/cobranza/${id}/snooze`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? 'Error');
        return;
      }
      await load();
    } finally {
      setSnoozingId(null);
    }
  }

  const itemsVisibles = silenciadoHoy ? [] : items;
  const count = itemsVisibles.length;
  const vencidosCount = itemsVisibles.filter((it) => it.estado === 'vencido').length;
  const proximosCount = itemsVisibles.filter((it) => it.estado === 'recordatorio_dia_5').length;
  const diariaCount = itemsVisibles.filter((it) => it.estado === 'saldo_cobranza_diaria').length;
  const itemsFiltrados = itemsVisibles.filter((it) => {
    if (filtro === 'vencidos') return it.estado === 'vencido';
    if (filtro === 'proximos') return it.estado === 'recordatorio_dia_5';
    if (filtro === 'diaria') return it.estado === 'saldo_cobranza_diaria';
    return true;
  });
  const itemsOrdenados = useMemo(() => {
    const rank: Record<PendienteItem['estado'], number> = {
      vencido: 0,
      recordatorio_dia_5: 1,
      saldo_cobranza_diaria: 2,
    };
    const toMs = (value: string) => {
      const t = new Date(value).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    return [...itemsFiltrados].sort((a, b) => {
      if (a.estado === b.estado) {
        const da = toMs(a.vencimientoAt);
        const db = toMs(b.vencimientoAt);
        if (a.estado === 'vencido') {
          return da - db;
        }
        return da - db;
      }
      return rank[a.estado] - rank[b.estado];
    });
  }, [itemsFiltrados]);

  function limpiarPorHoy() {
    try {
      localStorage.setItem(CLEAR_TODAY_LS_KEY, ymdArgentinaNow());
    } catch {
      // ignorar
    }
    setSilenciadoHoy(true);
  }

  function restaurarNotificaciones() {
    try {
      localStorage.removeItem(CLEAR_TODAY_LS_KEY);
    } catch {
      // ignorar
    }
    setSilenciadoHoy(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'relative shrink-0',
          onDarkBackground && 'text-zinc-100 hover:bg-zinc-700 hover:text-zinc-100',
        )}
        aria-label={`Cobranzas pendientes${count ? `: ${count}` : ''}`}
        onClick={() => setOpen(true)}
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium',
              vencidosCount > 0
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-amber-500 text-amber-950',
            )}
          >
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void load();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Recordatorios de cobro</DialogTitle>
            <DialogDescription>
              Alertas según condición de pago y vencidos diarios. Podés limpiar por hoy; mañana
              reaparecen si siguen pendientes.
            </DialogDescription>
          </DialogHeader>

          {typeof Notification !== 'undefined' && Notification.permission !== 'granted' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Avisos del navegador al detectar pendientes</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => void requestNotifyPermission()}>
                Activar
              </Button>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : null}

          {!loading && items.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {!silenciadoHoy ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={limpiarPorHoy}
                    className="min-h-9 cursor-pointer"
                  >
                    Limpiar por hoy
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={restaurarNotificaciones}
                    className="min-h-9 cursor-pointer"
                  >
                    Restaurar avisos
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive">
                  Vencidos: <span className="font-semibold">{vencidosCount}</span>
                </div>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-900 dark:text-amber-200">
                  Próx.: <span className="font-semibold">{proximosCount}</span>
                </div>
                <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-sky-900 dark:text-sky-200">
                  Diaria: <span className="font-semibold">{diariaCount}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={filtro === 'todos' ? 'default' : 'outline'}
                  onClick={() => setFiltro('todos')}
                  className="min-h-9 cursor-pointer"
                >
                  Todos ({count})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={filtro === 'vencidos' ? 'default' : 'outline'}
                  onClick={() => setFiltro('vencidos')}
                  className="min-h-9 cursor-pointer"
                >
                  Vencidos ({vencidosCount})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={filtro === 'proximos' ? 'default' : 'outline'}
                  onClick={() => setFiltro('proximos')}
                  className="min-h-9 cursor-pointer"
                >
                  Próximos ({proximosCount})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={filtro === 'diaria' ? 'default' : 'outline'}
                  onClick={() => setFiltro('diaria')}
                  className="min-h-9 cursor-pointer"
                >
                  Diaria ({diariaCount})
                </Button>
              </div>
            </div>
          ) : null}

          <ul className="flex flex-col gap-3">
            {itemsOrdenados.map((it) => (
              <li
                key={it.id}
                className={cn(
                  'rounded-lg border bg-card p-3 shadow-sm',
                  it.estado === 'vencido' && 'border-destructive/35 bg-destructive/[0.05]',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{it.clienteNombre}</span>
                  <span
                    className={
                      it.estado === 'vencido'
                        ? 'rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive'
                        : 'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200'
                    }
                  >
                    {it.estado === 'vencido'
                      ? 'Vencido'
                      : it.estado === 'saldo_cobranza_diaria'
                        ? 'Cobranza diaria'
                        : 'Próximo a vencer'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {it.tipoComprobanteLabel} {it.numeroComprobanteLabel} · Vence {it.vencimientoLabel}
                </p>
                <p className="mt-1 text-sm">
                  Saldo:{' '}
                  <span className="font-medium">
                    {it.saldoPendiente.toLocaleString('es-AR', {
                      style: 'currency',
                      currency: 'ARS',
                    })}
                  </span>
                </p>
                {!it.puedeWhatsApp ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Sin teléfono válido en la ficha del cliente.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={it.mensajeUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!it.mensajeUrl}
                      tabIndex={!it.mensajeUrl ? -1 : undefined}
                      className={`${buttonVariants({ size: 'sm' })} ${
                        !it.mensajeUrl ? 'pointer-events-none opacity-50' : ''
                      }`}
                    >
                      Abrir WhatsApp
                    </a>
                    {!it.id.startsWith('legacy-') ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={snoozingId === it.id}
                        onClick={() => void snooze(it.id)}
                      >
                        {snoozingId === it.id ? '…' : 'Recordar mañana'}
                      </Button>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!loading && silenciadoHoy && items.length > 0 && !error ? (
            <p className="text-sm text-muted-foreground">
              Avisos limpiados por hoy. Si siguen pendientes, volverán a mostrarse mañana.
            </p>
          ) : null}

          {!loading && count > 0 && itemsFiltrados.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">No hay cobranzas en este filtro.</p>
          ) : null}

          {!loading && items.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">No hay cobranzas para mostrar ahora.</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
