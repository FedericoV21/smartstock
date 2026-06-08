'use client';

import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import { fetchBusinessPrefsFromApi } from '@/lib/business-prefs/fetch';
import { normalizeBusinessPrefs } from '@/lib/business-prefs/prefs';
import type { MovimientosDiaPayload } from '@/lib/cuenta-corriente/movimientos-dia';

export function CuentaCorrienteMovimientosDiaPanel({
  clienteId,
  refreshKey = 0,
  onDatosActualizados,
}: {
  clienteId: string;
  refreshKey?: number;
  onDatosActualizados?: () => void;
}) {
  const { canEdit } = useDashboardRole();
  const [habilitado, setHabilitado] = useState<boolean | null>(null);
  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const [data, setData] = useState<MovimientosDiaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preciosEdit, setPreciosEdit] = useState<Record<string, number | null>>({});
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resolveSucursal = useCallback(async (): Promise<string | null> => {
    const res = await fetch('/api/configuracion/sucursal-activa', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      sucursal_default_id?: string | null;
      sucursales?: { id: string; es_principal?: boolean | null }[];
    };
    const def = json.sucursal_default_id?.trim();
    if (def) return def;
    const list = json.sucursales ?? [];
    const principal = list.find((s) => s.es_principal);
    return principal?.id ?? list[0]?.id ?? null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveError(null);
    try {
      const sid = await resolveSucursal();
      setSucursalId(sid);
      if (!sid) {
        setHabilitado(false);
        setError('No hay sucursal operativa. Elegí una sucursal en el encabezado del panel.');
        setData(null);
        setLoading(false);
        return;
      }

      const prefsRow = await fetchBusinessPrefsFromApi({ sucursalId: sid });
      const prefs = normalizeBusinessPrefs(prefsRow?.effective_business_prefs ?? {});
      const panelOn = prefs.cuentaCorrienteDistribuidora.panelMovimientosDia;
      setHabilitado(panelOn);
      if (!panelOn) {
        setData(null);
        setLoading(false);
        return;
      }

      const url = `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/movimientos-dia?sucursal_id=${encodeURIComponent(sid)}`;
      const res = await fetch(url, { cache: 'no-store' });
      const json = (await res.json()) as MovimientosDiaPayload & { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudieron cargar los movimientos del día.');
        setData(null);
      } else {
        setData(json);
        const inicial: Record<string, number | null> = {};
        for (const c of json.comprobantes) {
          for (const it of c.items) {
            inicial[it.id] = it.precioUnitario;
          }
        }
        setPreciosEdit(inicial);
      }
    } catch {
      setError('Error de red al cargar movimientos del día.');
      setData(null);
    }
    setLoading(false);
  }, [clienteId, resolveSucursal]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function guardarLiquidacion(comprobanteId: string) {
    if (!sucursalId || !data) return;
    const comp = data.comprobantes.find((c) => c.id === comprobanteId);
    if (!comp) return;

    setGuardandoId(comprobanteId);
    setSaveError(null);

    const items = comp.items.map((it) => {
      const pu = preciosEdit[it.id] ?? it.precioUnitario;
      return { id: it.id, precio_unitario: pu };
    });
    if (items.some((i) => !Number.isFinite(i.precio_unitario) || i.precio_unitario < 0)) {
      setSaveError('Indicá un precio unitario válido en cada ítem.');
      setGuardandoId(null);
      return;
    }

    const res = await fetch(
      `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/liquidar-items`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: sucursalId,
          comprobante_id: comprobanteId,
          items,
        }),
      },
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setSaveError(json.error ?? 'No se pudo guardar la liquidación.');
      setGuardandoId(null);
      return;
    }

    setGuardandoId(null);
    onDatosActualizados?.();
    await load();
  }

  if (habilitado === false) return null;
  if (habilitado === null && loading) return null;

  const fechaLabel = data?.fecha
    ? new Date(`${data.fecha}T12:00:00`).toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const puedeLiquidar = canEdit && data?.liquidacion_habilitada === true;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" id="movimientos-dia-cc">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Movimientos del día (cuenta corriente)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cargos emitidos hoy{fechaLabel ? ` · ${fechaLabel}` : ''}
            {data?.sucursal_nombre ? ` · ${data.sucursal_nombre}` : null}
          </p>
          {puedeLiquidar ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Podés cargar precios en tickets del día; se actualizan cuenta corriente y saldo de cobranza.
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Actualizar
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Cargando movimientos…</p>
      ) : null}

      {data && !loading ? (
        <>
          <dl className="mb-5 grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Saldo cuenta corriente</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.saldo_cuenta_label}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total cargado hoy</dt>
              <dd className="text-lg font-semibold tabular-nums text-red-600">
                {data.total_cargos_dia_label}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Saldo sin cargos de hoy</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.saldo_sin_cargos_hoy_label}</dd>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Aproximado; no descuenta cobros registrados hoy.
              </p>
            </div>
          </dl>

          {data.comprobantes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay ventas a cuenta corriente hoy en esta sucursal.
            </p>
          ) : (
            <div className="space-y-6">
              {data.comprobantes.map((c) => (
                <article key={c.id} className="rounded-lg border">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2 text-sm">
                    <span className="font-medium">
                      {c.tipoLabel} {c.numeroLabel}
                      <span className="ml-2 font-normal text-muted-foreground">{c.horaLabel}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{c.totalLabel}</span>
                  </header>
                  <ul className="divide-y text-sm">
                    {c.items.map((it) => (
                      <li
                        key={it.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          {it.codigo ? (
                            <span className="mr-1 font-mono text-xs text-muted-foreground">
                              {it.codigo}
                            </span>
                          ) : null}
                          {it.nombre}
                          <span className="ml-2 text-muted-foreground">× {it.cantidadLabel}</span>
                        </span>
                        {puedeLiquidar && c.editable ? (
                          <label className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground whitespace-nowrap">PU $</span>
                            <MontoInput
                              className="h-8 w-28 tabular-nums"
                              value={preciosEdit[it.id] ?? it.precioUnitario}
                              onValueChange={(v) =>
                                setPreciosEdit((prev) => ({ ...prev, [it.id]: v }))
                              }
                              min={0}
                              decimals={2}
                            />
                          </label>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">
                            {it.precioUnitarioLabel} → {it.subtotalLabel}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {puedeLiquidar && c.editable ? (
                    <footer className="border-t bg-muted/10 px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        disabled={guardandoId === c.id}
                        onClick={() => void guardarLiquidacion(c.id)}
                      >
                        {guardandoId === c.id ? 'Guardando…' : 'Guardar precios'}
                      </Button>
                    </footer>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
