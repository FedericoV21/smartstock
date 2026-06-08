'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS } from '@/lib/cuenta-corriente/condiciones-patch';
import type { Database } from '@/types/database';

type CobroModalidad = Database['public']['Enums']['cobro_modalidad'];
type CobroPeriodicidad = Database['public']['Enums']['cobro_periodicidad'];

type CuentaRow = Pick<
  Database['public']['Tables']['cuenta_corriente']['Row'],
  | 'id'
  | 'tipo_cuenta'
  | 'cobro_modalidad'
  | 'cobro_dias_plazo'
  | 'cobro_periodicidad'
  | 'cobro_dia_vencimiento_mes'
  | 'cobro_monto_minimo'
>;

const MODALIDAD_LABEL: Record<string, string> = {
  por_comprobante: 'Por factura de compra (plazo en días desde el comprobante)',
  periodico: 'Periódico (día / semana / quincena / mes)',
  dia_fijo_mes: 'Día fijo del mes (vencimiento mensual)',
};

const PERIOD_LABEL: Record<string, string> = {
  diaria: 'Diaria',
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
};

export function CuentaCorrienteProveedorCondicionesClient({ proveedorId }: { proveedorId: string }) {
  const { canEdit } = useDashboardRole();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  const [cuenta, setCuenta] = useState<CuentaRow | null>(null);
  const [modalidad, setModalidad] = useState<CobroModalidad>(
    CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS.cobro_modalidad,
  );
  const [diasPlazo, setDiasPlazo] = useState(String(CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS.cobro_dias_plazo));
  const [periodicidad, setPeriodicidad] = useState<CobroPeriodicidad>('mensual');
  const [diaMes, setDiaMes] = useState('22');
  const [montoMinimo, setMontoMinimo] = useState(
    String(CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS.cobro_monto_minimo),
  );

  const hydrateFrom = useCallback((row: CuentaRow | null) => {
    if (row) {
      setCuenta(row);
      setModalidad(row.cobro_modalidad);
      setDiasPlazo(String(row.cobro_dias_plazo));
      setPeriodicidad((row.cobro_periodicidad ?? 'mensual') as CobroPeriodicidad);
      setDiaMes(row.cobro_dia_vencimiento_mes != null ? String(row.cobro_dia_vencimiento_mes) : '22');
      setMontoMinimo(String(row.cobro_monto_minimo));
    } else {
      setCuenta(null);
      setModalidad(CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS.cobro_modalidad);
      setDiasPlazo(String(CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS.cobro_dias_plazo));
      setPeriodicidad('mensual');
      setDiaMes('22');
      setMontoMinimo(String(CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS.cobro_monto_minimo));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/proveedores/${proveedorId}/cuenta-corriente`);
    const json = (await res.json()) as { cuenta?: CuentaRow | null; error?: string };
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      hydrateFrom(null);
    } else {
      hydrateFrom(json.cuenta ?? null);
    }
    setLoading(false);
  }, [proveedorId, hydrateFrom]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    const dias = Number.parseInt(diasPlazo, 10);
    const min = Number(montoMinimo.replace(',', '.'));
    const dMes = Number.parseInt(diaMes, 10);

    const body: Record<string, unknown> = {
      cobro_modalidad: modalidad,
      cobro_monto_minimo: Number.isFinite(min) ? min : 0,
    };

    if (modalidad === 'por_comprobante') {
      if (!Number.isFinite(dias) || dias < 1 || dias > 3650) {
        setError('Indicá un plazo en días entre 1 y 3650.');
        setSaving(false);
        return;
      }
      body.cobro_dias_plazo = dias;
      body.cobro_periodicidad = null;
      body.cobro_dia_vencimiento_mes = null;
    } else if (modalidad === 'periodico') {
      body.cobro_periodicidad = periodicidad;
      body.cobro_dia_vencimiento_mes = null;
    } else {
      if (!Number.isFinite(dMes) || dMes < 1 || dMes > 31) {
        setError('Indicá un día del mes entre 1 y 31.');
        setSaving(false);
        return;
      }
      body.cobro_dia_vencimiento_mes = dMes;
      body.cobro_periodicidad = null;
    }

    const res = await fetch(`/api/proveedores/${proveedorId}/cuenta-corriente`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { cuenta?: CuentaRow; error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo guardar');
      return;
    }
    if (json.cuenta) hydrateFrom(json.cuenta);
    setEditMode(false);
    router.refresh();
  }

  if (loading) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Vencimientos (lo que le debés)</h3>
        <p className="mt-1 text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Vencimientos (lo que le debés)</h3>
        {canEdit && !editMode ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditMode(true)}>
            Editar
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Definí plazos y monto mínimo por pago, igual que en la cuenta de clientes, pero referidos a
        facturas y saldos a pagar a este proveedor.
      </p>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {editMode ? (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Modalidad de pago / vencimiento</span>
            <select
              value={modalidad}
              onChange={(e) => setModalidad(e.target.value as CobroModalidad)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="por_comprobante">{MODALIDAD_LABEL.por_comprobante}</option>
              <option value="periodico">{MODALIDAD_LABEL.periodico}</option>
              <option value="dia_fijo_mes">{MODALIDAD_LABEL.dia_fijo_mes}</option>
            </select>
          </label>

          {modalidad === 'por_comprobante' ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Días hasta el vencimiento (desde la factura o compra)</span>
              <Input
                inputMode="numeric"
                value={diasPlazo}
                onChange={(e) => setDiasPlazo(e.target.value)}
              />
            </label>
          ) : null}

          {modalidad === 'periodico' ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Periodicidad</span>
              <select
                value={periodicidad}
                onChange={(e) =>
                  setPeriodicidad(e.target.value as CobroPeriodicidad)
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="diaria">{PERIOD_LABEL.diaria}</option>
                <option value="semanal">{PERIOD_LABEL.semanal}</option>
                <option value="quincenal">{PERIOD_LABEL.quincenal}</option>
                <option value="mensual">{PERIOD_LABEL.mensual}</option>
              </select>
            </label>
          ) : null}

          {modalidad === 'dia_fijo_mes' ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Día de vencimiento cada mes (1–31)</span>
              <Input
                inputMode="numeric"
                value={diaMes}
                onChange={(e) => setDiaMes(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                Se usa el próximo calendario con ese día a partir de la operación; en meses cortos
                se ajusta al último día.
              </span>
            </label>
          ) : null}

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Monto mínimo por pago</span>
            <Input
              inputMode="decimal"
              value={montoMinimo}
              onChange={(e) => setMontoMinimo(e.target.value)}
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">
              Un monto menor solo al liquidar por completo el saldo.
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void load().then(() => setEditMode(false))}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Modalidad</dt>
            <dd>{MODALIDAD_LABEL[modalidad] ?? modalidad}</dd>
          </div>
          {modalidad === 'por_comprobante' ? (
            <div>
              <dt className="text-muted-foreground">Plazo desde comprobante</dt>
              <dd>
                {diasPlazo} {Number.parseInt(diasPlazo, 10) === 1 ? 'día' : 'días'}
              </dd>
            </div>
          ) : null}
          {modalidad === 'periodico' ? (
            <div>
              <dt className="text-muted-foreground">Periodicidad</dt>
              <dd>{PERIOD_LABEL[periodicidad] ?? periodicidad}</dd>
            </div>
          ) : null}
          {modalidad === 'dia_fijo_mes' ? (
            <div>
              <dt className="text-muted-foreground">Día del mes</dt>
              <dd className="font-medium">{diaMes}</dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Monto mínimo por pago</dt>
            <dd className="font-medium">{montoMinimo}</dd>
          </div>
          {!cuenta ? (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Tocá Editar y guardá para crear la cuenta con esta configuración (se puede hacer antes
              de tener saldo).
            </p>
          ) : null}
        </dl>
      )}
    </div>
  );
}
