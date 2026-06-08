'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { Input } from '@/components/ui/input';
import { fetchBusinessPrefsFromApi } from '@/lib/business-prefs/fetch';
import { normalizeBusinessPrefs } from '@/lib/business-prefs/prefs';
import { normalizeCajaPrefs, type CajaPrefs } from '@/lib/caja/prefs';

export type CajaConfigRow = {
  id: string;
  sucursal_id: string;
  numero: number;
  nombre: string;
  activa: boolean;
  usuario_default_id: string | null;
  /** Horas desde apertura del turno hasta cierre Z automático en el POS; null = desactivado. */
  auto_cierre_horas?: number | null;
  estado_turno?: 'abierta' | 'cerrada';
  turno_abierto?: {
    id: string;
    abierto_at: string;
    usuario_id: string;
    usuario_label: string;
  } | null;
  prefs?: CajaPrefs;
};

type UsuarioOpt = { id: string; label: string };
type SucursalOpt = { id: string; nombre: string; codigo: string };

type Props = {
  sucursalId: string;
  sucursales: SucursalOpt[];
  cajas: CajaConfigRow[];
  usuariosOpciones: UsuarioOpt[];
  onActualizado: () => void;
};

export function CajasGestionCierre({ sucursalId, sucursales, cajas, usuariosOpciones, onActualizado }: Props) {
  const [permitirAjustesPorCaja, setPermitirAjustesPorCaja] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchBusinessPrefsFromApi({ sucursalId });
      if (cancelled || !res) return;
      setPermitirAjustesPorCaja(
        normalizeBusinessPrefs(res.effective_business_prefs).cuentaCorrienteDistribuidora
          .permitirAjustesPorCaja,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sucursalId]);

  const [altaNumero, setAltaNumero] = useState('');
  const [altaNombre, setAltaNombre] = useState('');
  const [altaUsuario, setAltaUsuario] = useState('');
  const [altaBusy, setAltaBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cajasAbiertas = cajas.filter((c) => c.estado_turno === 'abierta').length;
  const sucursalAlta = sucursales.find((s) => s.id === sucursalId);

  async function crearCaja() {
    setError(null);
    const num = Number(altaNumero.replace(',', '.'));
    const nombre = altaNombre.trim();
    if (!Number.isInteger(num) || num < 1) {
      setError('Número de caja: entero ≥ 1.');
      return;
    }
    if (!nombre) {
      setError('Nombre obligatorio.');
      return;
    }
    setAltaBusy(true);
    const res = await fetch('/api/configuracion/cajas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sucursal_id: sucursalId,
        numero: num,
        nombre,
        usuario_default_id: altaUsuario.trim() || null,
      }),
    });
    const json = (await res.json()) as { error?: string };
    setAltaBusy(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo crear la caja');
      return;
    }
    setAltaNumero('');
    setAltaNombre('');
    setAltaUsuario('');
    onActualizado();
  }

  return (
    <section
      aria-labelledby="cajas-gestion-heading"
      className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="cajas-gestion-heading" className="text-base font-medium text-foreground">
            Cajas del negocio
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Administrá sucursal, operador, estado y auto-cierre. Si una caja ya tuvo movimientos, conviene desactivarla
            en vez de borrarla.
            {!permitirAjustesPorCaja ? (
              <>
                {' '}
                Para ticket de cuenta corriente sin importes, activá «Permitir ajustes por caja» en Configuración →
                Preferencias de negocio → Por sucursal.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-muted-foreground">
            {cajas.length} cajas
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300">
            {cajasAbiertas} abiertas
          </span>
        </div>
      </div>

      {cajas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay cajas registradas. Creá la primera abajo.</p>
      ) : (
        <div className="grid gap-3">
          {cajas.map((c) => (
            <FilaCajaEditable
              key={c.id}
              caja={c}
              sucursales={sucursales}
              usuariosOpciones={usuariosOpciones}
              permitirAjustesPorCaja={permitirAjustesPorCaja}
              onGuardado={onActualizado}
            />
          ))}
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/20 p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Nueva caja</p>
          <p className="text-xs text-muted-foreground">
            Se crea en {sucursalAlta ? `${sucursalAlta.nombre} (${sucursalAlta.codigo})` : 'la sucursal seleccionada'}.
            Podés moverla después desde la tarjeta.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="grid gap-1 text-xs sm:w-24">
            <span className="font-medium text-muted-foreground">Número</span>
            <Input
              inputMode="numeric"
              value={altaNumero}
              onChange={(e) => setAltaNumero(e.target.value)}
              placeholder="2"
              className="tabular-nums"
            />
          </label>
          <label className="grid min-w-0 flex-1 gap-1 text-xs sm:min-w-[200px]">
            <span className="font-medium text-muted-foreground">Nombre</span>
            <Input value={altaNombre} onChange={(e) => setAltaNombre(e.target.value)} placeholder="Caja mostrador" />
          </label>
          <label className="grid min-w-0 gap-1 text-xs sm:w-56">
            <span className="font-medium text-muted-foreground">Operador (opc.)</span>
            <select
              value={altaUsuario}
              onChange={(e) => setAltaUsuario(e.target.value)}
              className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Ninguno</option>
              {usuariosOpciones.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" size="sm" className="cursor-pointer shrink-0" disabled={altaBusy} onClick={() => void crearCaja()}>
            {altaBusy ? 'Guardando…' : 'Dar de alta'}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function parseAutoCierreHorasInput(raw: string): number | null | 'invalid' {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isInteger(n) || n < 1 || n > 168) return 'invalid';
  return n;
}

function FilaCajaEditable({
  caja,
  sucursales,
  usuariosOpciones,
  permitirAjustesPorCaja,
  onGuardado,
}: {
  caja: CajaConfigRow;
  sucursales: SucursalOpt[];
  usuariosOpciones: UsuarioOpt[];
  permitirAjustesPorCaja: boolean;
  onGuardado: () => void;
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [nombre, setNombre] = useState(caja.nombre);
  const [sucursalId, setSucursalId] = useState(caja.sucursal_id);
  const [activa, setActiva] = useState(caja.activa);
  const [usuarioId, setUsuarioId] = useState(caja.usuario_default_id ?? '');
  const [autoHorasStr, setAutoHorasStr] = useState(
    caja.auto_cierre_horas != null ? String(caja.auto_cierre_horas) : '',
  );
  const prefsInicial = normalizeCajaPrefs(caja.prefs);
  const [ticketOcultarImportes, setTicketOcultarImportes] = useState(
    prefsInicial.cuentaCorrienteCaja.ticketOcultarImportes,
  );
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [forzarCierreBusy, setForzarCierreBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNombre(caja.nombre);
    setSucursalId(caja.sucursal_id);
    setActiva(caja.activa);
    setUsuarioId(caja.usuario_default_id ?? '');
    setAutoHorasStr(caja.auto_cierre_horas != null ? String(caja.auto_cierre_horas) : '');
    const p = normalizeCajaPrefs(caja.prefs);
    setTicketOcultarImportes(p.cuentaCorrienteCaja.ticketOcultarImportes);
  }, [caja.id, caja.nombre, caja.sucursal_id, caja.activa, caja.usuario_default_id, caja.auto_cierre_horas, caja.prefs]);

  const ticketOcultarActual = normalizeCajaPrefs(caja.prefs).cuentaCorrienteCaja.ticketOcultarImportes;

  const autoHorasParsed = parseAutoCierreHorasInput(autoHorasStr);
  const autoHorasActual = caja.auto_cierre_horas ?? null;
  const autoHorasDirty =
    autoHorasParsed === 'invalid'
      ? autoHorasStr.trim() !== ''
      : autoHorasParsed !== autoHorasActual;

  const dirty =
    nombre.trim() !== caja.nombre ||
    sucursalId !== caja.sucursal_id ||
    activa !== caja.activa ||
    (usuarioId || null) !== (caja.usuario_default_id ?? null) ||
    autoHorasDirty ||
    ticketOcultarImportes !== ticketOcultarActual;

  async function guardar() {
    setErr(null);
    const ah = parseAutoCierreHorasInput(autoHorasStr);
    if (ah === 'invalid') {
      setErr('Auto-cierre: número entero entre 1 y 168 horas, o vacío para desactivar.');
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre.trim(),
        sucursal_id: sucursalId,
        activa,
        usuario_default_id: usuarioId.trim() || null,
        auto_cierre_horas: ah,
        ...(permitirAjustesPorCaja
          ? {
              prefs: {
                cuentaCorrienteCaja: { ticketOcultarImportes },
              },
            }
          : {}),
      }),
    });
    const json = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setErr(json.error ?? 'Error al guardar');
      return;
    }
    onGuardado();
  }

  async function forzarCierreAdministrativo() {
    setErr(null);
    const ok = await confirm({
      title: 'Forzar cierre Z',
      description: (
        <>
          <p>
            ¿Forzar cierre Z en la Caja {caja.numero} «{caja.nombre}»? Se cierra el turno abierto usando efectivo
            contado igual al total esperado por el sistema.
          </p>
          <p className="mt-2">
            Usalo ante bloqueos o ausencia del operador; no reemplaza un arqueo físico.
          </p>
        </>
      ),
      confirmLabel: 'Forzar cierre',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    setForzarCierreBusy(true);
    const res = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}/forzar-cierre`, {
      method: 'POST',
    });
    const json = (await res.json()) as { error?: string };
    setForzarCierreBusy(false);
    if (!res.ok) {
      setErr(json.error ?? 'No se pudo forzar el cierre');
      return;
    }
    onGuardado();
  }

  async function borrar() {
    setErr(null);
    const ok = await confirm({
      title: 'Borrar caja',
      description: `¿Borrar la caja Nº ${caja.numero} «${caja.nombre}»? Solo se puede borrar si no tiene historial.`,
      confirmLabel: 'Borrar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    setDeleteBusy(true);
    const res = await fetch(`/api/configuracion/cajas/${encodeURIComponent(caja.id)}`, {
      method: 'DELETE',
    });
    const json = (await res.json()) as { error?: string };
    setDeleteBusy(false);
    if (!res.ok) {
      setErr(json.error ?? 'Error al borrar');
      return;
    }
    onGuardado();
  }

  const abierta = caja.estado_turno === 'abierta' && caja.turno_abierto;
  const sucursalActual = sucursales.find((s) => s.id === sucursalId);

  return (
    <>
      {ConfirmDialog}
      <article className="rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums text-foreground">
              Caja {caja.numero}
            </span>
            <span
              className={
                abierta
                  ? 'rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300'
                  : 'rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
              }
            >
              {abierta ? 'Abierta' : 'Cerrada'}
            </span>
            {!activa ? (
              <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                Inactiva
              </span>
            ) : null}
          </div>
          <h3 className="truncate text-sm font-semibold text-foreground">{caja.nombre}</h3>
          <p className="text-xs text-muted-foreground">
            {sucursalActual ? `${sucursalActual.nombre} (${sucursalActual.codigo})` : 'Sucursal sin identificar'}
          </p>
        </div>

        {abierta ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
            <p className="font-medium text-emerald-800 dark:text-emerald-200">
              En uso por {caja.turno_abierto!.usuario_label}
            </p>
            <p className="mt-0.5 text-emerald-700/80 dark:text-emerald-200/80">
              Desde {new Date(caja.turno_abierto!.abierto_at).toLocaleString('es-AR')}
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs md:col-span-2 xl:col-span-1">
          <span className="font-medium text-muted-foreground">Nombre</span>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="h-9 text-sm" />
        </label>

        <label className="grid gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Sucursal</span>
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre} ({s.codigo})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Operador sugerido</span>
          <select
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Ninguno</option>
            {usuariosOpciones.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Auto-cierre (horas)</span>
          <Input
            inputMode="numeric"
            placeholder="Sin auto-cierre"
            title="Horas hasta cierre automático del turno en el POS (vacío = no)"
            value={autoHorasStr}
            onChange={(e) => setAutoHorasStr(e.target.value)}
            className="h-9 tabular-nums text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
            <span className="text-muted-foreground">Caja activa para operar</span>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-2 text-sm ${!permitirAjustesPorCaja ? 'opacity-50' : ''}`}
            title={
              permitirAjustesPorCaja
                ? 'Solo ventas a cuenta corriente en esta caja'
                : 'Activá ajustes por caja en preferencias de la sucursal'
            }
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ticketOcultarImportes}
              disabled={!permitirAjustesPorCaja}
              onChange={(e) => setTicketOcultarImportes(e.target.checked)}
            />
            <span className="text-muted-foreground">
              Ticket cuenta corriente <span className="font-medium text-foreground">sin importes</span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {abierta ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer border-destructive/45 text-destructive hover:bg-destructive/10"
              disabled={busy || deleteBusy || forzarCierreBusy}
              onClick={() => void forzarCierreAdministrativo()}
            >
              {forzarCierreBusy ? '…' : 'Forzar cierre Z'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="cursor-pointer"
            disabled={!dirty || busy || deleteBusy || forzarCierreBusy}
            onClick={() => void guardar()}
          >
            {busy ? '…' : 'Guardar'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="cursor-pointer"
            disabled={busy || deleteBusy || Boolean(abierta) || forzarCierreBusy}
            title={abierta ? 'Cerrá el turno antes de borrar la caja.' : 'Borrar caja sin historial'}
            onClick={() => void borrar()}
          >
            {deleteBusy ? '…' : 'Borrar'}
          </Button>
        </div>
      </div>

      {err ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {err}
        </p>
      ) : null}
    </article>
    </>
  );
}
