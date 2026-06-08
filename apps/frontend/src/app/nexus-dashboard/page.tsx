'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReceiptText, Save, UsersRound } from 'lucide-react';

import { MensualidadCortePicker } from '@/components/nexus-dashboard/mensualidad-corte-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { UNSAVED_LEAVE_TITLE, useWarnUnsavedChanges } from '@/hooks/useWarnUnsavedChanges';

type PlanTipo = 'plan0' | 'base' | 'intermedio' | 'completo';
type IAIlimitadaOrigen = 'lector_factura' | 'ia_pdf';

type FiltroPlan = 'todos' | PlanTipo;
type VistaDashboard = 'cuentas' | 'ginkgo';

type FacturacionDraft = {
  monto: string;
  porcentaje: string;
};

type NexusRow = {
  usuarioId: string;
  tenantId: string;
  email: string;
  nombreCompleto: string;
  negocioNombre: string;
  plan: PlanTipo;
  planCambiadoEn: string | null;
  iaIlimitadaOrigen: IAIlimitadaOrigen | null;
  sucursales: number;
  fechaUnion: string;
  tenantCreadoEn: string;
  usuarioActivo: boolean;
  tenantActivo: boolean;
  mensualidadCorteDia: number | null;
  mensualidadProximoCorte: string | null;
  ginkgoMontoAbonado: number | null;
  ginkgoPorcentaje: number | null;
  ginkgoFacturacionActualizadaEn: string | null;
};

function labelPlan(row: Pick<NexusRow, 'plan' | 'iaIlimitadaOrigen'>): string {
  if (row.plan === 'plan0') return 'Plan 0';
  if (row.plan === 'base') return 'Base';
  if (row.plan === 'completo') return 'Completo';
  const ia = row.iaIlimitadaOrigen ?? 'ia_pdf';
  return `Intermedio — ${ia === 'lector_factura' ? 'factura' : 'lista'}`;
}

function labelIA(v: IAIlimitadaOrigen): string {
  return v === 'lector_factura' ? 'Factura' : 'Lista';
}

function formatFecha(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** `yyyy-mm-dd` sin zona → fecha local estable. */
function formatSoloFecha(isoDate: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(y, mo, d));
  } catch {
    return isoDate;
  }
}

const ARS_FORMAT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PERCENT_FORMAT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatMoney(value: number | null) {
  return value == null ? 'Sin registrar' : ARS_FORMAT.format(value);
}

function formatPercent(value: number | null) {
  return value == null ? 'Sin registrar' : `${PERCENT_FORMAT.format(value)}%`;
}

function formatDraftValue(value: number | null) {
  if (value == null) return '';
  return String(value).replace('.', ',');
}

function draftFromRow(row: NexusRow): FacturacionDraft {
  return {
    monto: formatDraftValue(row.ginkgoMontoAbonado),
    porcentaje: formatDraftValue(row.ginkgoPorcentaje),
  };
}

function parseDecimal(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true as const, value: null };
  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { ok: false as const, value: null };
  return { ok: true as const, value: n };
}

function parseFacturacionDraft(draft: FacturacionDraft) {
  const monto = parseDecimal(draft.monto);
  if (!monto.ok || (monto.value != null && monto.value < 0)) {
    return { ok: false as const, error: 'El monto abonado debe ser 0 o mayor.' };
  }

  const porcentaje = parseDecimal(draft.porcentaje);
  if (
    !porcentaje.ok ||
    (porcentaje.value != null && (porcentaje.value < 0 || porcentaje.value > 100))
  ) {
    return { ok: false as const, error: 'El porcentaje debe estar entre 0 y 100.' };
  }

  return {
    ok: true as const,
    monto: monto.value,
    porcentaje: porcentaje.value,
    ginkgo:
      monto.value != null && porcentaje.value != null
        ? (monto.value * porcentaje.value) / 100
        : null,
  };
}

function sameNullableNumber(a: number | null, b: number | null) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.0001;
}

export default function NexusDashboardPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionOk, setSessionOk] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [rows, setRows] = useState<NexusRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloCicloActivo, setSoloCicloActivo] = useState(false);
  const [filtroPlan, setFiltroPlan] = useState<FiltroPlan>('todos');
  const [vista, setVista] = useState<VistaDashboard>('cuentas');
  const [facturacionDrafts, setFacturacionDrafts] = useState<Record<string, FacturacionDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setListError(null);
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      if (soloActivos) params.set('soloActivos', '1');
      if (soloCicloActivo) params.set('cicloActivo', '1');
      if (vista === 'cuentas' && filtroPlan !== 'todos') params.set('plan', filtroPlan);
      const qs = params.toString();
      const url = qs ? `/api/nexus-dashboard/tenants?${qs}` : '/api/nexus-dashboard/tenants';
      const res = await fetch(url, { credentials: 'include' });
      const json = (await res.json()) as { rows?: NexusRow[]; error?: string };
      if (!res.ok) {
        setListError(json.error ?? 'No se pudo cargar la lista.');
        setRows([]);
        if (res.status === 401) {
          setSessionOk(false);
        }
        return;
      }
      const nextRows = json.rows ?? [];
      setRows(nextRows);
      setFacturacionDrafts(
        Object.fromEntries(nextRows.map((row) => [row.tenantId, draftFromRow(row)]))
      );
    } catch {
      setListError('Error de red.');
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [soloActivos, soloCicloActivo, filtroPlan, vista]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/nexus-dashboard/session', { credentials: 'include' });
        const json = (await res.json()) as { ok?: boolean };
        if (!cancelled) {
          setSessionOk(Boolean(json.ok));
        }
      } catch {
        if (!cancelled) setSessionOk(false);
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionOk) return;
    void loadTenants();
  }, [sessionOk, loadTenants]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await fetch('/api/nexus-dashboard/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setLoginError(json.error ?? 'No se pudo ingresar.');
        return;
      }
      setSessionOk(true);
      setPassword('');
    } catch {
      setLoginError('Error de conexión.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    if (!(await confirmLeaveFacturacion())) return;
    await fetch('/api/nexus-dashboard/logout', { method: 'POST', credentials: 'include' });
    setSessionOk(false);
    setRows([]);
    setFacturacionDrafts({});
  }

  async function patchRow(
    row: NexusRow,
    patch: {
      plan?: PlanTipo;
      iaIlimitadaOrigen?: IAIlimitadaOrigen;
      usuarioActivo?: boolean;
      mensualidadCorteDia?: number | null;
      ginkgoMontoAbonado?: number | null;
      ginkgoPorcentaje?: number | null;
    },
    key: string
  ) {
    setBusyKey(key);
    setListError(null);
    try {
      const res = await fetch('/api/nexus-dashboard/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tenantId: row.tenantId,
          usuarioId: row.usuarioId,
          ...patch,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setListError(json.error ?? 'No se pudo guardar.');
        if (res.status === 401) setSessionOk(false);
        return;
      }
      await loadTenants();
    } catch {
      setListError('Error de red al guardar.');
    } finally {
      setBusyKey(null);
    }
  }

  function updateFacturacionDraft(tenantId: string, patch: Partial<FacturacionDraft>) {
    setListError(null);
    setFacturacionDrafts((prev) => ({
      ...prev,
      [tenantId]: {
        ...(prev[tenantId] ?? { monto: '', porcentaje: '' }),
        ...patch,
      },
    }));
  }

  async function saveFacturacion(row: NexusRow, draft: FacturacionDraft, key: string) {
    const parsed = parseFacturacionDraft(draft);
    if (!parsed.ok) {
      setListError(parsed.error);
      return;
    }
    await patchRow(
      row,
      {
        ginkgoMontoAbonado: parsed.monto,
        ginkgoPorcentaje: parsed.porcentaje,
      },
      key
    );
  }

  const facturacionRows = useMemo(
    () => rows.filter((row) => row.plan !== 'plan0'),
    [rows]
  );

  const facturacionResumen = useMemo(() => {
    return facturacionRows.reduce(
      (acc, row) => {
        const monto = row.ginkgoMontoAbonado;
        const porcentaje = row.ginkgoPorcentaje;
        if (monto != null) acc.totalAbonado += monto;
        if (monto != null && porcentaje != null) {
          acc.totalGinkgo += (monto * porcentaje) / 100;
        } else {
          acc.pendientes += 1;
        }
        return acc;
      },
      { totalAbonado: 0, totalGinkgo: 0, pendientes: 0 }
    );
  }, [facturacionRows]);

  const facturacionCambios = useMemo(() => {
    const cambios: { row: NexusRow; parsed: ReturnType<typeof parseFacturacionDraft> }[] = [];
    let invalidos = 0;

    for (const row of facturacionRows) {
      const draft = facturacionDrafts[row.tenantId] ?? draftFromRow(row);
      const parsed = parseFacturacionDraft(draft);
      if (!parsed.ok) {
        invalidos += 1;
        continue;
      }
      if (
        !sameNullableNumber(parsed.monto, row.ginkgoMontoAbonado) ||
        !sameNullableNumber(parsed.porcentaje, row.ginkgoPorcentaje)
      ) {
        cambios.push({ row, parsed });
      }
    }

    return { cambios, invalidos };
  }, [facturacionDrafts, facturacionRows]);

  const hasFacturacionUnsavedChanges =
    vista === 'ginkgo' &&
    (facturacionCambios.cambios.length > 0 || facturacionCambios.invalidos > 0);

  const confirmLeaveFacturacion = useCallback(async () => {
    if (!hasFacturacionUnsavedChanges) return true;
    return confirm({
      title: UNSAVED_LEAVE_TITLE,
      description:
        'Tenes cambios sin guardar en Facturacion Ginkgo. Si salis de esta seccion, se van a borrar los cambios aplicados sin guardar.',
      confirmLabel: 'Salir sin guardar',
      confirmVariant: 'destructive',
    });
  }, [confirm, hasFacturacionUnsavedChanges]);

  useWarnUnsavedChanges(hasFacturacionUnsavedChanges, { confirmLeave: confirmLeaveFacturacion });

  async function setVistaConGuard(v: VistaDashboard) {
    if (v === vista) return;
    if (!(await confirmLeaveFacturacion())) return;
    setVista(v);
  }

  async function reloadConGuard() {
    if (!(await confirmLeaveFacturacion())) return;
    await loadTenants();
  }

  async function setSoloActivosConGuard(value: boolean) {
    if (value === soloActivos) return;
    if (!(await confirmLeaveFacturacion())) return;
    setSoloActivos(value);
  }

  async function setSoloCicloActivoConGuard(value: boolean) {
    if (value === soloCicloActivo) return;
    if (!(await confirmLeaveFacturacion())) return;
    setSoloCicloActivo(value);
  }

  async function saveFacturacionPendiente() {
    if (facturacionCambios.invalidos > 0) {
      setListError('Revisá los campos marcados antes de guardar los cambios.');
      return;
    }
    if (facturacionCambios.cambios.length === 0) return;

    setBusyKey('ginkgo-bulk-save');
    setListError(null);
    try {
      const results = await Promise.all(
        facturacionCambios.cambios.map(async ({ row, parsed }) => {
          const res = await fetch('/api/nexus-dashboard/tenants', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              tenantId: row.tenantId,
              usuarioId: row.usuarioId,
              ginkgoMontoAbonado: parsed.ok ? parsed.monto : null,
              ginkgoPorcentaje: parsed.ok ? parsed.porcentaje : null,
            }),
          });
          const json = (await res.json()) as { error?: string };
          return { ok: res.ok, status: res.status, error: json.error };
        })
      );

      const failed = results.find((r) => !r.ok);
      if (failed) {
        setListError(failed.error ?? 'No se pudieron guardar todos los cambios.');
        if (failed.status === 401) setSessionOk(false);
        return;
      }

      await loadTenants();
    } catch {
      setListError('Error de red al guardar cambios.');
    } finally {
      setBusyKey(null);
    }
  }

  if (!sessionChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <p className="text-sm">Cargando…</p>
      </div>
    );
  }

  if (!sessionOk) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-200">
        <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900/80 p-8 shadow-xl">
          <h1 className="text-xl font-semibold tracking-tight">Nexus — panel temporal</h1>
          <p className="mt-2 text-sm text-slate-400">
            Acceso interno. Esta pantalla no usa tu sesión de Smart Stock.
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="text-sm font-medium text-slate-300" htmlFor="nexus-pw">
                Contraseña
              </label>
              <Input
                id="nexus-pw"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 border-slate-600 bg-slate-950 text-slate-100"
                placeholder="••••••••"
              />
            </div>
            {loginError ? <p className="text-sm text-red-400">{loginError}</p> : null}
            <Button type="submit" className="w-full" disabled={loginLoading}>
              {loginLoading ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 px-3 py-6 text-slate-100 sm:px-5">
      <div className="mx-auto max-w-[92rem]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="max-w-5xl [&>h1]:text-xl">
            <h1 className="text-2xl font-semibold tracking-tight">Nexus — creadores de negocio</h1>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">
              Primer administrador por negocio (alta inicial). Los cambios de plan aplican módulos vía{' '}
              <code className="rounded bg-slate-800 px-1 text-xs">activar_plan</code> (ARCA, POS MP,
              lector, etc.). El ciclo mensual usa día 1–28 del mes (febrero se ajusta solo).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
              <Button
                type="button"
                variant={vista === 'cuentas' ? 'secondary' : 'ghost'}
                size="sm"
                className={
                  vista === 'cuentas'
                    ? 'h-7 bg-slate-700 px-2 text-xs text-slate-100 hover:bg-slate-600/80'
                    : 'h-7 px-2 text-xs text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                }
                onClick={() => void setVistaConGuard('cuentas')}
              >
                <UsersRound className="size-3.5" aria-hidden />
                Cuentas
              </Button>
              <Button
                type="button"
                variant={vista === 'ginkgo' ? 'secondary' : 'ghost'}
                size="sm"
                className={
                  vista === 'ginkgo'
                    ? 'h-7 bg-slate-700 px-2 text-xs text-slate-100 hover:bg-slate-600/80'
                    : 'h-7 px-2 text-xs text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                }
                onClick={() => void setVistaConGuard('ginkgo')}
              >
                <ReceiptText className="size-3.5" aria-hidden />
                Facturacion Ginkgo
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="size-3.5 rounded border-slate-600"
                checked={soloActivos}
                onChange={(e) => void setSoloActivosConGuard(e.target.checked)}
              />
              Solo usuarios y negocios activos
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="size-3.5 rounded border-slate-600"
                checked={soloCicloActivo}
                onChange={(e) => void setSoloCicloActivoConGuard(e.target.checked)}
              />
              Solo con ciclo de mensualidad activo
            </label>
            {vista === 'cuentas' ? (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span className="shrink-0 text-slate-400">Plan</span>
                <Select
                  value={filtroPlan}
                  onValueChange={(v) => v && setFiltroPlan(v as FiltroPlan)}
                >
                  <SelectTrigger className="h-8 w-[9rem] border-slate-600 bg-slate-950 text-xs text-slate-100 transition-colors hover:bg-slate-800/35 hover:text-slate-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los planes</SelectItem>
                    <SelectItem value="plan0">Plan 0</SelectItem>
                    <SelectItem value="base">Base</SelectItem>
                    <SelectItem value="intermedio">Intermedio</SelectItem>
                    <SelectItem value="completo">Completo</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ) : (
              <span className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400">
                Todos los planes
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-8 border-slate-500 bg-slate-800 px-3 text-xs text-slate-100 transition-colors hover:bg-slate-700/70 hover:text-slate-50"
              onClick={() => void reloadConGuard()}
            >
              Actualizar
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 bg-slate-700 px-3 text-xs text-slate-100 transition-colors hover:bg-slate-600/75 hover:text-slate-50"
              onClick={() => void handleLogout()}
            >
              Salir
            </Button>
          </div>
        </header>

        {listError ? <p className="mt-4 text-sm text-red-400">{listError}</p> : null}

        {vista === 'ginkgo' ? (
          <div className="mt-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                <p className="text-xs text-slate-500">Cuentas facturables</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">
                  {facturacionRows.length}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                <p className="text-xs text-slate-500">Total abonado Nexus</p>
                <p className="mt-1 text-lg font-semibold text-slate-100">
                  {ARS_FORMAT.format(facturacionResumen.totalAbonado)}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/25 p-3">
                <p className="text-xs text-emerald-300/75">Corresponde a Ginkgo</p>
                <p className="mt-1 text-lg font-semibold text-emerald-200">
                  {ARS_FORMAT.format(facturacionResumen.totalGinkgo)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                <p className="text-xs text-slate-500">Pendientes de completar</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">
                  {facturacionResumen.pendientes}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2">
              <p className="text-xs text-slate-400">
                Cambios sin guardar:{' '}
                <span className="font-semibold text-slate-100">
                  {facturacionCambios.cambios.length}
                </span>
                {facturacionCambios.invalidos > 0 ? (
                  <span className="ml-2 text-red-300">
                    {facturacionCambios.invalidos} con errores
                  </span>
                ) : null}
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={
                  busyKey === 'ginkgo-bulk-save' ||
                  facturacionCambios.cambios.length === 0 ||
                  facturacionCambios.invalidos > 0
                }
                onClick={() => void saveFacturacionPendiente()}
              >
                <Save className="size-3.5" aria-hidden />
                {busyKey === 'ginkgo-bulk-save'
                  ? 'Guardando...'
                  : `Guardar cambios (${facturacionCambios.cambios.length})`}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          {listLoading ? (
            <p className="p-8 text-sm text-slate-400">Cargando negocios…</p>
          ) : vista === 'ginkgo' ? (
            facturacionRows.length === 0 ? (
              <p className="p-8 text-sm text-slate-400">
                No hay cuentas con estos filtros.
              </p>
            ) : (
              <Table className="min-w-[72rem] table-fixed text-[0.8125rem]">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[15%]" />
                  <col className="w-[11%]" />
                  <col className="w-[13%]" />
                  <col className="w-[9%]" />
                  <col className="w-[6%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="h-9 px-2 text-xs text-slate-300">Negocio</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">Plan</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">Contacto</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">Monto abonado</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">% Ginkgo</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">A Ginkgo</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">Ultima act.</TableHead>
                    <TableHead className="h-9 px-2 text-xs text-slate-300">Accion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr:nth-child(even)]:!bg-white/[0.025]">
                  {facturacionRows.map((row) => {
                    const keyBase = `${row.tenantId}-${row.usuarioId}`;
                    const factBusy = busyKey === `${keyBase}-fact`;
                    const draft = facturacionDrafts[row.tenantId] ?? draftFromRow(row);
                    const parsed = parseFacturacionDraft(draft);
                    const changed =
                      parsed.ok &&
                      (!sameNullableNumber(parsed.monto, row.ginkgoMontoAbonado) ||
                        !sameNullableNumber(parsed.porcentaje, row.ginkgoPorcentaje));
                    const estadoOk = row.usuarioActivo && row.tenantActivo;

                    return (
                      <TableRow
                        key={keyBase}
                        className="border-slate-800 transition-colors hover:bg-white/[0.04]"
                      >
                        <TableCell className="max-w-[13rem] whitespace-normal py-2 align-top">
                          <div className="space-y-1">
                            <p className="font-medium leading-snug text-slate-100">
                              {row.negocioNombre}
                            </p>
                            <p className="text-xs text-slate-500">
                              {estadoOk ? 'Activo' : 'Inactivo'}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal py-2 align-top text-xs text-slate-300">
                          {labelPlan(row)}
                        </TableCell>
                        <TableCell className="max-w-[13rem] whitespace-normal py-2 align-top">
                          <p className="leading-snug text-slate-300">{row.nombreCompleto}</p>
                          <p className="break-all text-xs leading-snug text-slate-500">{row.email}</p>
                        </TableCell>
                        <TableCell className="py-2 align-top">
                          <div className="flex max-w-[10rem] items-center gap-1.5">
                            <span className="text-xs text-slate-500">$</span>
                            <Input
                              inputMode="decimal"
                              value={draft.monto}
                              disabled={factBusy}
                              onChange={(e) =>
                                updateFacturacionDraft(row.tenantId, { monto: e.target.value })
                              }
                              className="h-8 border-slate-600 bg-slate-950 text-xs text-slate-100"
                              placeholder="0"
                            />
                          </div>
                          {!parsed.ok ? (
                            <p className="mt-1 text-[0.68rem] leading-tight text-red-300">
                              {parsed.error}
                            </p>
                          ) : (
                            <p className="mt-1 text-[0.68rem] leading-tight text-slate-500">
                              Actual: {formatMoney(row.ginkgoMontoAbonado)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="py-2 align-top">
                          <div className="flex max-w-[7rem] items-center gap-1.5">
                            <Input
                              inputMode="decimal"
                              value={draft.porcentaje}
                              disabled={factBusy}
                              onChange={(e) =>
                                updateFacturacionDraft(row.tenantId, {
                                  porcentaje: e.target.value,
                                })
                              }
                              className="h-8 border-slate-600 bg-slate-950 text-xs text-slate-100"
                              placeholder="0"
                            />
                            <span className="text-xs text-slate-500">%</span>
                          </div>
                          <p className="mt-1 text-[0.68rem] leading-tight text-slate-500">
                            Actual: {formatPercent(row.ginkgoPorcentaje)}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-normal py-2 align-top">
                          {parsed.ok && parsed.ginkgo != null ? (
                            <div className="space-y-1">
                              <p className="font-semibold text-emerald-200">
                                {ARS_FORMAT.format(parsed.ginkgo)}
                              </p>
                              {changed ? (
                                <p className="text-[0.68rem] leading-tight text-amber-200">
                                  Sin guardar
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">
                              Completar monto y porcentaje
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal py-2 align-top text-xs leading-snug text-slate-400">
                          {row.ginkgoFacturacionActualizadaEn
                            ? formatFecha(row.ginkgoFacturacionActualizadaEn)
                            : 'Sin registro'}
                        </TableCell>
                        <TableCell className="py-2 align-top">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 border-slate-600 bg-slate-950 px-2 text-xs text-slate-100 transition-colors hover:bg-slate-800/45"
                            disabled={factBusy || !parsed.ok || !changed}
                            onClick={() => void saveFacturacion(row, draft, `${keyBase}-fact`)}
                          >
                            <Save className="size-3.5" aria-hidden />
                            {factBusy ? '...' : 'Guardar'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          ) : rows.length === 0 ? (
            <p className="p-8 text-sm text-slate-400">No hay registros con estos filtros.</p>
          ) : (
            <Table className="min-w-[76rem] table-fixed text-[0.8125rem]">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[15%]" />
                <col className="w-[16%]" />
                <col className="w-[6%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
              </colgroup>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Negocio</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Contacto</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Correo</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Plan</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Sucursales</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Ciclo mensual</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Alta cuenta</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Estado</TableHead>
                  <TableHead className="h-9 px-2 text-xs text-slate-300">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:nth-child(even)]:!bg-white/[0.025]">
                {rows.map((row) => {
                  const keyBase = `${row.tenantId}-${row.usuarioId}`;
                  const planBusy = busyKey === `${keyBase}-plan`;
                  const iaBusy = busyKey === `${keyBase}-ia`;
                  const mensBusy = busyKey === `${keyBase}-mens`;
                  const actBusy = busyKey === `${keyBase}-act`;
                  const estadoOk = row.usuarioActivo && row.tenantActivo;
                  return (
                    <TableRow
                      key={keyBase}
                      className="border-slate-800 transition-colors hover:bg-white/[0.04] has-aria-expanded:bg-white/[0.04]"
                    >
                      <TableCell className="max-w-[10rem] whitespace-normal py-2 font-medium leading-snug">
                        {row.negocioNombre}
                      </TableCell>
                      <TableCell className="max-w-[8.5rem] whitespace-normal py-2 leading-snug text-slate-300">
                        {row.nombreCompleto}
                      </TableCell>
                      <TableCell
                        className="max-w-[12rem] whitespace-normal break-all py-2 text-xs leading-snug text-slate-300"
                        title={row.email}
                      >
                        {row.email}
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <div className="space-y-1.5">
                          <Select
                            value={row.plan}
                            disabled={planBusy}
                            onValueChange={(v) => {
                              if (!v || v === row.plan) return;
                              void patchRow(row, { plan: v as PlanTipo }, `${keyBase}-plan`);
                            }}
                          >
                            <SelectTrigger className="h-8 w-[11.25rem] border-slate-600 bg-slate-950 text-xs transition-colors hover:bg-slate-800/35">
                              <span className="truncate">{labelPlan(row)}</span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="plan0">Plan 0</SelectItem>
                              <SelectItem value="base">Base</SelectItem>
                              <SelectItem value="intermedio">Intermedio</SelectItem>
                              <SelectItem value="completo">Completo</SelectItem>
                            </SelectContent>
                          </Select>

                          {row.plan !== 'plan0' && row.plan !== 'base' ? (
                            <p className="text-[0.68rem] leading-tight text-slate-500">
                              Cambio:{' '}
                              <span className="text-slate-400">
                                {row.planCambiadoEn
                                  ? formatFecha(row.planCambiadoEn)
                                  : 'sin registro'}
                              </span>
                            </p>
                          ) : null}

                          {row.plan === 'intermedio' ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                              <span className="shrink-0">IA:</span>
                              <Select
                                value={row.iaIlimitadaOrigen ?? 'ia_pdf'}
                                disabled={iaBusy}
                                onValueChange={(v) => {
                                  if (!v || v === row.iaIlimitadaOrigen) return;
                                  void patchRow(
                                    row,
                                    { iaIlimitadaOrigen: v as IAIlimitadaOrigen },
                                    `${keyBase}-ia`,
                                  );
                                }}
                              >
                                <SelectTrigger className="h-7 w-[7.5rem] border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 transition-colors hover:bg-slate-800/35">
                                  <span className="truncate">
                                    {labelIA((row.iaIlimitadaOrigen ?? 'ia_pdf') as IAIlimitadaOrigen)}
                                  </span>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="lector_factura">Factura</SelectItem>
                                  <SelectItem value="ia_pdf">Lista</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-xs tabular-nums text-slate-300">
                        {row.sucursales}
                      </TableCell>
                      <TableCell className="max-w-[11rem] whitespace-normal py-2 align-top">
                        <MensualidadCortePicker
                          value={row.mensualidadCorteDia}
                          busy={mensBusy}
                          proximoCorteLabel={row.mensualidadProximoCorte}
                          formatSoloFecha={formatSoloFecha}
                          onChange={(dia) => {
                            const cur = row.mensualidadCorteDia ?? null;
                            if (dia === cur) return;
                            void patchRow(
                              row,
                              { mensualidadCorteDia: dia },
                              `${keyBase}-mens`
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="py-2 text-xs leading-snug text-slate-400">
                        {formatFecha(row.fechaUnion)}
                      </TableCell>
                      <TableCell className="py-2">
                        <span
                          className={
                            estadoOk
                              ? 'rounded-full bg-emerald-950 px-2 py-0.5 text-xs text-emerald-300'
                              : 'rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-200'
                          }
                        >
                          {estadoOk
                            ? 'Activo'
                            : !row.usuarioActivo
                              ? 'Usuario inactivo'
                              : 'Negocio inactivo'}
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        {row.usuarioActivo ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-8 px-2 text-xs"
                            disabled={actBusy}
                            onClick={() =>
                              void patchRow(row, { usuarioActivo: false }, `${keyBase}-act`)
                            }
                          >
                            {actBusy ? '…' : 'Inactivar usuario'}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 border-emerald-700 bg-emerald-950 px-2 text-xs text-emerald-200 transition-colors hover:bg-emerald-900/60 hover:text-emerald-100"
                            disabled={actBusy}
                            onClick={() =>
                              void patchRow(row, { usuarioActivo: true }, `${keyBase}-act`)
                            }
                          >
                            {actBusy ? '…' : 'Reactivar usuario'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      {hasFacturacionUnsavedChanges ? (
        <div className="fixed left-3 right-3 top-3 z-50 mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/60 bg-slate-900/95 px-3 py-2 shadow-2xl shadow-black/45 backdrop-blur sm:left-5 sm:right-5">
          <p className="text-xs text-slate-300">
            Cambios sin guardar:{' '}
            <span className="font-semibold text-slate-100">
              {facturacionCambios.cambios.length}
            </span>
            {facturacionCambios.invalidos > 0 ? (
              <span className="ml-2 text-red-300">
                {facturacionCambios.invalidos} con errores
              </span>
            ) : null}
          </p>
          <Button
            type="button"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={
              busyKey === 'ginkgo-bulk-save' ||
              facturacionCambios.cambios.length === 0 ||
              facturacionCambios.invalidos > 0
            }
            onClick={() => void saveFacturacionPendiente()}
          >
            <Save className="size-3.5" aria-hidden />
            {busyKey === 'ginkgo-bulk-save'
              ? 'Guardando...'
              : `Guardar cambios (${facturacionCambios.cambios.length})`}
          </Button>
        </div>
      ) : null}
      {ConfirmDialog}
    </div>
  );
}
