'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Banknote, Landmark, Plus, RefreshCw, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FechaInput } from '@/components/ui/fecha-input';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, hoyEnAR } from '@/lib/utils/formatters';

type Movimiento = {
  id: string;
  tipo: string;
  tipo_etiqueta: string;
  monto: number;
  es_ingreso: boolean;
  notas: string | null;
  fecha: string;
  created_at: string;
  proveedor_nombre: string | null;
  cierre_z_id: string | null;
};

type Cheque = {
  id: string;
  numero: string;
  banco: string;
  titular: string | null;
  fecha_emision: string | null;
  fecha_cobro: string | null;
  monto: number;
  saldo_disponible?: number;
  monto_usado?: number;
  estado: string;
  estado_etiqueta: string;
  notas: string | null;
};

type CierreReciente = {
  id: string;
  caja_id: string;
  caja_etiqueta: string;
  fecha_operativa: string;
  efectivo_contado: number | null;
  ventas_netas: number;
};

type ProveedorOption = { id: string; nombre: string };

type ObligacionOption = {
  id: string;
  saldo_pendiente: number;
  referencia: string;
};

function TesoreriaCampo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium leading-none">{label}</span>
      {children}
    </div>
  );
}

/** Base UI muestra el `value` del ítem (UUID) si se usa SelectValue; la etiqueta va en el trigger. */
function TesoreriaSelectEtiqueta({
  texto,
  placeholder,
}: {
  texto: string | null | undefined;
  placeholder: string;
}) {
  const visible = texto?.trim();
  return (
    <span
      className={cn(
        'block min-w-0 flex-1 truncate text-left',
        !visible && 'text-muted-foreground',
      )}
    >
      {visible || placeholder}
    </span>
  );
}

export function TesoreriaClient({
  sucursalIdInicial = null,
  cierreZIdInicial = null,
  proveedorIdInicial = null,
}: {
  sucursalIdInicial?: string | null;
  cierreZIdInicial?: string | null;
  proveedorIdInicial?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cajaNombre, setCajaNombre] = useState('');
  const [alcance, setAlcance] = useState<'tenant' | 'sucursal'>('sucursal');
  const [saldoEfectivo, setSaldoEfectivo] = useState(0);
  const [totalCheques, setTotalCheques] = useState(0);
  const [cantCheques, setCantCheques] = useState(0);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [filtroCheque, setFiltroCheque] = useState<string>('todos');

  const [modal, setModal] = useState<
    'ingreso' | 'cheque' | 'transferencia' | 'pago' | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [montoIngreso, setMontoIngreso] = useState<number | null>(null);
  const [notasIngreso, setNotasIngreso] = useState('');

  const [chequeForm, setChequeForm] = useState({
    numero: '',
    banco: '',
    titular: '',
    fecha_emision: '',
    fecha_cobro: '',
    monto: null as number | null,
    notas: '',
  });

  const [transferForm, setTransferForm] = useState({
    monto: null as number | null,
    cierre_z_id: cierreZIdInicial ?? '',
    notas: '',
  });
  const [cierresRecientes, setCierresRecientes] = useState<CierreReciente[]>([]);

  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [pagoForm, setPagoForm] = useState({
    proveedor_id: proveedorIdInicial ?? '',
    monto: null as number | null,
    tipo_pago: 'efectivo' as 'efectivo' | 'cheque',
    cheque_id: '',
    obligacion_id: '',
    notas: '',
  });
  const [obligaciones, setObligaciones] = useState<ObligacionOption[]>([]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (sucursalIdInicial) p.set('sucursal_id', sucursalIdInicial);
    return p.toString();
  }, [sucursalIdInicial]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/tesoreria?${qs}`, { cache: 'no-store' });
    const json = (await res.json()) as {
      error?: string;
      caja?: { nombre: string };
      alcance?: 'tenant' | 'sucursal';
      saldo_efectivo?: number;
      total_cheques_cartera?: number;
      cantidad_cheques_cartera?: number;
      movimientos?: Movimiento[];
      cheques?: Cheque[];
    };
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar tesorería');
      return;
    }
    setCajaNombre(json.caja?.nombre ?? 'Caja interna');
    setAlcance(json.alcance ?? 'sucursal');
    setSaldoEfectivo(Number(json.saldo_efectivo ?? 0));
    setTotalCheques(Number(json.total_cheques_cartera ?? 0));
    setCantCheques(Number(json.cantidad_cheques_cartera ?? 0));
    setMovimientos(json.movimientos ?? []);
    setCheques(json.cheques ?? []);
  }, [qs]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (cierreZIdInicial) {
      setTransferForm((f) => ({ ...f, cierre_z_id: cierreZIdInicial }));
      setModal('transferencia');
    }
  }, [cierreZIdInicial]);

  useEffect(() => {
    if (proveedorIdInicial) {
      setPagoForm((f) => ({ ...f, proveedor_id: proveedorIdInicial }));
      setModal('pago');
    }
  }, [proveedorIdInicial]);

  useEffect(() => {
    if (modal !== 'transferencia') return;
    void (async () => {
      const res = await fetch(`/api/tesoreria/cierres-recientes?${qs}`);
      const json = (await res.json()) as { cierres?: CierreReciente[] };
      if (res.ok) setCierresRecientes(json.cierres ?? []);
    })();
  }, [modal, qs]);

  useEffect(() => {
    if (modal !== 'pago') return;
    void (async () => {
      const res = await fetch('/api/proveedores?estado=todos');
      const json = (await res.json()) as { proveedores?: ProveedorOption[] };
      if (res.ok) setProveedores(json.proveedores ?? []);
    })();
  }, [modal]);

  useEffect(() => {
    const provId = pagoForm.proveedor_id.trim();
    if (!provId || modal !== 'pago') return;
    if (proveedores.some((p) => p.id === provId)) return;
    void (async () => {
      const res = await fetch(`/api/proveedores/${provId}`);
      const json = (await res.json()) as { nombre?: string; id?: string };
      if (!res.ok || !json.nombre || !json.id) return;
      setProveedores((prev) => {
        if (prev.some((p) => p.id === json.id)) return prev;
        return [...prev, { id: json.id!, nombre: json.nombre! }];
      });
    })();
  }, [pagoForm.proveedor_id, modal, proveedores]);

  useEffect(() => {
    const provId = pagoForm.proveedor_id.trim();
    if (!provId || modal !== 'pago') {
      setObligaciones([]);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/tesoreria/obligaciones?${qs}&proveedor_id=${encodeURIComponent(provId)}`);
      const json = (await res.json()) as { obligaciones?: ObligacionOption[] };
      if (!res.ok) return;
      setObligaciones(json.obligaciones ?? []);
    })();
  }, [pagoForm.proveedor_id, modal]);

  const chequesFiltrados = useMemo(() => {
    if (filtroCheque === 'todos') return cheques;
    return cheques.filter((c) => c.estado === filtroCheque);
  }, [cheques, filtroCheque]);

  const chequesEnCartera = useMemo(
    () =>
      cheques.filter(
        (c) => c.estado === 'en_cartera' && Number(c.saldo_disponible ?? c.monto) > 0.01,
      ),
    [cheques],
  );

  const chequeSeleccionado = useMemo(
    () => chequesEnCartera.find((c) => c.id === pagoForm.cheque_id) ?? null,
    [chequesEnCartera, pagoForm.cheque_id],
  );

  function etiquetaCheque(c: Cheque): string {
    return `${c.numero} · ${c.banco} · disp. ${formatCurrency(Number(c.saldo_disponible ?? c.monto))}`;
  }

  const proveedorPagoLabel = useMemo(() => {
    if (!pagoForm.proveedor_id) return null;
    return proveedores.find((p) => p.id === pagoForm.proveedor_id)?.nombre ?? null;
  }, [pagoForm.proveedor_id, proveedores]);

  const obligacionPagoLabel = useMemo(() => {
    if (!pagoForm.obligacion_id) return null;
    const obl = obligaciones.find((o) => o.id === pagoForm.obligacion_id);
    if (!obl) return null;
    return `${obl.referencia} · ${formatCurrency(obl.saldo_pendiente)}`;
  }, [pagoForm.obligacion_id, obligaciones]);

  const medioPagoLabel =
    pagoForm.tipo_pago === 'cheque' ? 'Cheque en cartera' : 'Efectivo (saldo tesorería)';

  const cierreTransferLabel = useMemo(() => {
    if (!transferForm.cierre_z_id) return null;
    const cierre = cierresRecientes.find((c) => c.id === transferForm.cierre_z_id);
    if (!cierre) return null;
    const monto =
      cierre.efectivo_contado != null ? ` · ${formatCurrency(cierre.efectivo_contado)}` : '';
    return `${formatDate(cierre.fecha_operativa)} · ${cierre.caja_etiqueta}${monto}`;
  }, [transferForm.cierre_z_id, cierresRecientes]);

  const filtroChequeLabel: Record<string, string> = {
    todos: 'Todos',
    en_cartera: 'En cartera',
    depositado: 'Depositados',
    entregado: 'Agotados',
    rechazado: 'Rechazados',
  };

  async function enviarIngreso() {
    if (montoIngreso == null || montoIngreso <= 0) {
      setModalError('Indicá un monto válido');
      return;
    }
    setSaving(true);
    setModalError(null);
    const res = await fetch(`/api/tesoreria/ingreso-efectivo?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto: montoIngreso, notas: notasIngreso.trim() || null, fecha: hoyEnAR() }),
    });
    const json = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setModalError(json.error ?? 'Error');
      return;
    }
    setModal(null);
    setMontoIngreso(null);
    setNotasIngreso('');
    void cargar();
  }

  async function enviarCheque() {
    if (!chequeForm.numero.trim() || !chequeForm.banco.trim()) {
      setModalError('Número y banco son obligatorios');
      return;
    }
    if (chequeForm.monto == null || chequeForm.monto <= 0) {
      setModalError('Indicá un monto válido');
      return;
    }
    setSaving(true);
    setModalError(null);
    const res = await fetch(`/api/tesoreria/cheques?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...chequeForm,
        monto: chequeForm.monto,
        fecha: hoyEnAR(),
      }),
    });
    const json = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setModalError(json.error ?? 'Error');
      return;
    }
    setModal(null);
    setChequeForm({ numero: '', banco: '', titular: '', fecha_emision: '', fecha_cobro: '', monto: null, notas: '' });
    void cargar();
  }

  async function enviarTransferencia() {
    if (transferForm.monto == null || transferForm.monto <= 0) {
      setModalError('Indicá un monto válido');
      return;
    }
    setSaving(true);
    setModalError(null);
    const cierreSel = cierresRecientes.find((c) => c.id === transferForm.cierre_z_id);
    const res = await fetch(`/api/tesoreria/transferencia-desde-caja?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto: transferForm.monto,
        cierre_z_id: transferForm.cierre_z_id.trim() || null,
        caja_id: cierreSel?.caja_id?.length === 36 ? cierreSel.caja_id : null,
        notas: transferForm.notas.trim() || null,
        fecha: hoyEnAR(),
      }),
    });
    const json = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setModalError(json.error ?? 'Error');
      return;
    }
    setModal(null);
    setTransferForm({ monto: null, cierre_z_id: '', notas: '' });
    void cargar();
  }

  async function enviarPago() {
    if (!pagoForm.proveedor_id.trim()) {
      setModalError('Elegí un proveedor');
      return;
    }
    if (pagoForm.monto == null || pagoForm.monto <= 0) {
      setModalError('Indicá un monto válido');
      return;
    }
    if (pagoForm.tipo_pago === 'cheque' && !pagoForm.cheque_id) {
      setModalError('Elegí un cheque en cartera');
      return;
    }
    if (pagoForm.tipo_pago === 'cheque' && chequeSeleccionado) {
      const saldo = Number(chequeSeleccionado.saldo_disponible ?? chequeSeleccionado.monto);
      if (pagoForm.monto > saldo + 0.01) {
        setModalError(`El monto supera el saldo del cheque (disponible: ${formatCurrency(saldo)})`);
        return;
      }
    }
    setSaving(true);
    setModalError(null);
    const res = await fetch(`/api/tesoreria/pago-proveedor?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proveedor_id: pagoForm.proveedor_id,
        monto: pagoForm.monto,
        tipo_pago: pagoForm.tipo_pago,
        cheque_id: pagoForm.cheque_id || null,
        pago_proveedor_factura_id: pagoForm.obligacion_id || null,
        notas: pagoForm.notas.trim() || null,
        fecha: hoyEnAR(),
      }),
    });
    const json = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setModalError(json.error ?? 'Error');
      return;
    }
    setModal(null);
    setPagoForm({
      proveedor_id: '',
      monto: null,
      tipo_pago: 'efectivo',
      cheque_id: '',
      obligacion_id: '',
      notas: '',
    });
    void cargar();
  }

  async function cambiarEstadoCheque(chequeId: string, estado: 'depositado' | 'rechazado') {
    const res = await fetch(`/api/tesoreria/cheques/${chequeId}/estado?${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error ?? 'Error al actualizar cheque');
      return;
    }
    void cargar();
  }

  if (loading && movimientos.length === 0) {
    return <p className="text-sm text-muted-foreground">Cargando tesorería…</p>;
  }

  if (error && movimientos.length === 0) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tesorería</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {cajaNombre}
            {alcance === 'tenant' ? ' · Alcance: negocio completo' : ' · Por sucursal'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void cargar()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Actualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Wallet className="h-4 w-4" />
            Saldo efectivo
          </div>
          <p className="text-2xl font-semibold tabular-nums mt-2">{formatCurrency(saldoEfectivo)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Landmark className="h-4 w-4" />
            Cheques en cartera
          </div>
          <p className="text-2xl font-semibold tabular-nums mt-2">{formatCurrency(totalCheques)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {cantCheques} cheque(s) · saldo disponible
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Acciones</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => { setModal('ingreso'); setModalError(null); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Ingreso
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setModal('cheque'); setModalError(null); }}>
              Cheque
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setModal('transferencia'); setModalError(null); }}>
              Desde caja
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setModal('pago');
                setModalError(null);
                setPagoForm((f) => ({
                  ...f,
                  tipo_pago: chequesEnCartera.length > 0 ? 'cheque' : 'efectivo',
                  cheque_id: '',
                }));
              }}
            >
              Pagar proveedor
            </Button>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Movimientos recientes</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="p-2 font-medium">Fecha</th>
                <th className="p-2 font-medium">Tipo</th>
                <th className="p-2 font-medium">Detalle</th>
                <th className="p-2 font-medium text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-muted-foreground">
                    Sin movimientos
                  </td>
                </tr>
              ) : (
                movimientos.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="p-2 whitespace-nowrap">{formatDate(m.fecha)}</td>
                    <td className="p-2">{m.tipo_etiqueta}</td>
                    <td className="p-2 text-muted-foreground">
                      {m.proveedor_nombre ?? m.notas ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'p-2 text-right tabular-nums font-medium',
                        m.es_ingreso ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground',
                      )}
                    >
                      {m.es_ingreso ? '+' : '−'}
                      {formatCurrency(Number(m.monto))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Cartera de cheques</h2>
          <Select value={filtroCheque} onValueChange={(v) => setFiltroCheque(v ?? 'todos')}>
            <SelectTrigger className="w-[180px]">
              <TesoreriaSelectEtiqueta
                texto={filtroChequeLabel[filtroCheque] ?? filtroCheque}
                placeholder="Estado"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="en_cartera">En cartera</SelectItem>
              <SelectItem value="depositado">Depositados</SelectItem>
              <SelectItem value="entregado">Agotados</SelectItem>
              <SelectItem value="rechazado">Rechazados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="p-2 font-medium">Nº</th>
                <th className="p-2 font-medium">Banco</th>
                <th className="p-2 font-medium">Titular</th>
                <th className="p-2 font-medium">Cobro</th>
                <th className="p-2 font-medium">Estado</th>
                <th className="p-2 font-medium text-right">Monto</th>
                <th className="p-2 font-medium text-right">Disponible</th>
                <th className="p-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {chequesFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-muted-foreground">
                    Sin cheques
                  </td>
                </tr>
              ) : (
                chequesFiltrados.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="p-2">{c.numero}</td>
                    <td className="p-2">{c.banco}</td>
                    <td className="p-2">{c.titular ?? '—'}</td>
                    <td className="p-2">{c.fecha_cobro ? formatDate(c.fecha_cobro) : '—'}</td>
                    <td className="p-2">{c.estado_etiqueta}</td>
                    <td className="p-2 text-right tabular-nums">{formatCurrency(Number(c.monto))}</td>
                    <td className="p-2 text-right tabular-nums">
                      {c.estado === 'en_cartera' ? (
                        <>
                          {formatCurrency(Number(c.saldo_disponible ?? c.monto))}
                          {Number(c.monto_usado ?? 0) > 0.01 ? (
                            <span className="block text-xs text-muted-foreground">
                              usado {formatCurrency(Number(c.monto_usado))}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-2">
                      {c.estado === 'en_cartera' &&
                      Number(c.saldo_disponible ?? c.monto) + 0.01 >= Number(c.monto) ? (
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void cambiarEstadoCheque(c.id, 'depositado')}>
                            Depositado en banco
                          </Button>
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => void cambiarEstadoCheque(c.id, 'rechazado')}>
                            Rechazar
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={modal === 'ingreso'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ingreso de efectivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="grid gap-1 text-sm">
              <span>Monto</span>
              <MontoInput value={montoIngreso} onValueChange={setMontoIngreso} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Notas</span>
              <Input value={notasIngreso} onChange={(e) => setNotasIngreso(e.target.value)} />
            </label>
            {modalError ? <p className="text-sm text-destructive">{modalError}</p> : null}
            <Button type="button" disabled={saving} onClick={() => void enviarIngreso()}>
              Registrar ingreso
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'cheque'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar cheque</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-1">
              <span>Número</span>
              <Input value={chequeForm.numero} onChange={(e) => setChequeForm((f) => ({ ...f, numero: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-1">
              <span>Banco</span>
              <Input value={chequeForm.banco} onChange={(e) => setChequeForm((f) => ({ ...f, banco: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span>Titular</span>
              <Input value={chequeForm.titular} onChange={(e) => setChequeForm((f) => ({ ...f, titular: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Emisión</span>
              <FechaInput
                value={chequeForm.fecha_emision}
                onValueChange={(v) => setChequeForm((f) => ({ ...f, fecha_emision: v }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Cobro</span>
              <FechaInput
                value={chequeForm.fecha_cobro}
                onValueChange={(v) => setChequeForm((f) => ({ ...f, fecha_cobro: v }))}
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span>Monto</span>
              <MontoInput
                value={chequeForm.monto}
                decimals={0}
                onValueChange={(v) => setChequeForm((f) => ({ ...f, monto: v }))}
              />
            </label>
            {modalError ? <p className="text-sm text-destructive sm:col-span-2">{modalError}</p> : null}
            <Button type="button" className="sm:col-span-2" disabled={saving} onClick={() => void enviarCheque()}>
              Registrar cheque
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'transferencia'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferencia desde caja POS</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Registra en tesorería el efectivo retirado de una caja. Opcionalmente vinculá un cierre Z reciente.
          </p>
          <div className="space-y-3">
            <label className="grid gap-1 text-sm">
              <span>Cierre Z (opcional)</span>
              <Select
                value={transferForm.cierre_z_id || '__none__'}
                onValueChange={(v) => {
                  const id = !v || v === '__none__' ? '' : v;
                  const cierre = cierresRecientes.find((c) => c.id === id);
                  setTransferForm((f) => ({
                    ...f,
                    cierre_z_id: id,
                    monto: cierre?.efectivo_contado != null ? Number(cierre.efectivo_contado) : f.monto,
                  }));
                }}
              >
                <SelectTrigger className="w-full">
                  <TesoreriaSelectEtiqueta texto={cierreTransferLabel} placeholder="Sin vincular" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin vincular</SelectItem>
                  {cierresRecientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {formatDate(c.fecha_operativa)} · {c.caja_etiqueta}
                      {c.efectivo_contado != null ? ` · ${formatCurrency(c.efectivo_contado)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>Monto</span>
              <MontoInput value={transferForm.monto} onValueChange={(v) => setTransferForm((f) => ({ ...f, monto: v }))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Notas</span>
              <Input value={transferForm.notas} onChange={(e) => setTransferForm((f) => ({ ...f, notas: e.target.value }))} />
            </label>
            {modalError ? <p className="text-sm text-destructive">{modalError}</p> : null}
            <Button type="button" disabled={saving} onClick={() => void enviarTransferencia()}>
              <Banknote className="h-4 w-4 mr-1" />
              Registrar transferencia
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'pago'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="flex max-h-[min(90vh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Pagar proveedor desde tesorería</DialogTitle>
            <DialogDescription>
              Usá el efectivo de tesorería o un cheque en cartera. Con cheque podés repartir el saldo entre varios
              proveedores hasta agotarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <TesoreriaCampo label="Proveedor">
              <Select
                value={pagoForm.proveedor_id || '__none__'}
                onValueChange={(v) =>
                  setPagoForm((f) => ({
                    ...f,
                    proveedor_id: !v || v === '__none__' ? '' : v,
                    obligacion_id: '',
                    monto: null,
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <TesoreriaSelectEtiqueta
                    texto={
                      proveedorPagoLabel ??
                      (pagoForm.proveedor_id ? 'Cargando proveedor…' : null)
                    }
                    placeholder="Elegí proveedor"
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Elegí proveedor</SelectItem>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TesoreriaCampo>

            {obligaciones.length > 0 ? (
              <TesoreriaCampo label="Factura (opcional)">
                <Select
                  value={pagoForm.obligacion_id || '__none__'}
                  onValueChange={(v) => {
                    const id = !v || v === '__none__' ? '' : v;
                    const obl = obligaciones.find((o) => o.id === id);
                    setPagoForm((f) => {
                      const saldoCheque = chequeSeleccionado
                        ? Number(chequeSeleccionado.saldo_disponible ?? chequeSeleccionado.monto)
                        : null;
                      const montoSugerido = obl ? obl.saldo_pendiente : f.monto;
                      const monto =
                        saldoCheque != null && montoSugerido != null
                          ? Math.min(saldoCheque, montoSugerido)
                          : montoSugerido;
                      return {
                        ...f,
                        obligacion_id: id,
                        monto,
                      };
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <TesoreriaSelectEtiqueta
                      texto={obligacionPagoLabel}
                      placeholder="Pago a cuenta (sin factura)"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Pago a cuenta (sin factura)</SelectItem>
                    {obligaciones.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.referencia} · {formatCurrency(o.saldo_pendiente)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TesoreriaCampo>
            ) : null}

            <TesoreriaCampo label="Medio de pago">
              <Select
                value={pagoForm.tipo_pago}
                onValueChange={(v) =>
                  setPagoForm((f) => ({
                    ...f,
                    tipo_pago: v === 'cheque' ? 'cheque' : 'efectivo',
                    cheque_id: '',
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <TesoreriaSelectEtiqueta texto={medioPagoLabel} placeholder="Elegí medio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo (saldo tesorería)</SelectItem>
                  <SelectItem value="cheque" disabled={chequesEnCartera.length === 0}>
                    Cheque en cartera
                    {chequesEnCartera.length === 0 ? ' (sin cheques disponibles)' : ''}
                  </SelectItem>
                </SelectContent>
              </Select>
            </TesoreriaCampo>

            {pagoForm.tipo_pago === 'cheque' ? (
              <TesoreriaCampo label="Cheque">
                <Select
                  value={pagoForm.cheque_id || '__none__'}
                  onValueChange={(v) => {
                    const id = !v || v === '__none__' ? '' : v;
                    const ch = chequesEnCartera.find((c) => c.id === id);
                    const saldo = ch ? Number(ch.saldo_disponible ?? ch.monto) : null;
                    setPagoForm((f) => ({
                      ...f,
                      cheque_id: id,
                      monto:
                        saldo != null && f.monto != null ? Math.min(saldo, f.monto) : saldo,
                    }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <TesoreriaSelectEtiqueta
                      texto={chequeSeleccionado ? etiquetaCheque(chequeSeleccionado) : null}
                      placeholder="Elegí cheque"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Elegí cheque</SelectItem>
                    {chequesEnCartera.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {etiquetaCheque(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chequeSeleccionado ? (
                  <p className="text-xs text-muted-foreground">
                    Saldo disponible:{' '}
                    {formatCurrency(Number(chequeSeleccionado.saldo_disponible ?? chequeSeleccionado.monto))}
                  </p>
                ) : null}
              </TesoreriaCampo>
            ) : (
              <p className="text-xs text-muted-foreground">
                Se descontará del saldo efectivo de tesorería ({formatCurrency(saldoEfectivo)}).
              </p>
            )}

            <TesoreriaCampo label="Monto">
              <MontoInput
                className="w-full"
                placeholder="0,00"
                value={pagoForm.monto}
                onValueChange={(v) => setPagoForm((f) => ({ ...f, monto: v }))}
              />
            </TesoreriaCampo>

            <TesoreriaCampo label="Notas (opcional)">
              <Input
                className="w-full"
                placeholder="Referencia, observaciones…"
                value={pagoForm.notas}
                onChange={(e) => setPagoForm((f) => ({ ...f, notas: e.target.value }))}
              />
            </TesoreriaCampo>

            {modalError ? <p className="text-sm text-destructive">{modalError}</p> : null}
          </div>

          <DialogFooter className="flex-col gap-2 border-t bg-muted/30 px-5 py-4 sm:flex-col sm:items-stretch">
            <Button type="button" className="w-full sm:w-auto sm:self-end" disabled={saving} onClick={() => void enviarPago()}>
              Registrar pago
            </Button>
            {pagoForm.proveedor_id ? (
              <p className="text-center text-xs text-muted-foreground sm:text-right">
                También podés pagar desde{' '}
                <Link href={`/proveedores/${pagoForm.proveedor_id}`} className="underline">
                  la ficha del proveedor
                </Link>
                .
              </p>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
