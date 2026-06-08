'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import { fetchEffectiveBusinessPrefsOnly } from '@/lib/business-prefs/fetch';
import { describirSaldoCuentaCorriente } from '@/lib/cuenta-corriente/saldo';
import { fetchEmisorParaPdfInforme } from '@/lib/reportes/pdf-emisor-client';
import { descargarPdfTabla, nombrePdfReporte } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

type Comprob = {
  id: string;
  tipo: string;
  numero: string;
  fecha: string;
  total: number;
};

export type ObligacionRow = {
  id: string;
  saldo_pendiente: number;
  monto_original: number;
  vencimiento_at: string;
  estado: string;
  comprobante: Comprob | null;
  /** pago_proveedor_factura.origen */
  origen?: 'comprobante' | 'import_lista' | null;
  referencia?: string | null;
};

type ProveedorResumen = {
  nombre: string;
  cuit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
};

type TipoPago = 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro';

function fechaCorta(s: string) {
  if (!s || s.length < 10) return s;
  const [y, m, d] = s.slice(0, 10).split('-');
  if (!d || !m) return s;
  return `${d}/${m}/${y}`;
}

function textoVacio(s: string | null | undefined) {
  const t = s?.trim();
  return t ? t : '—';
}

function documentoObligacion(o: ObligacionRow) {
  if (o.comprobante) return `${o.comprobante.tipo} ${o.comprobante.numero}`;
  if (o.origen === 'import_lista' && o.referencia) return o.referencia;
  if (o.origen === 'import_lista') return 'Importación de lista';
  return 'Comprobante';
}

function origenObligacion(o: ObligacionRow) {
  if (o.origen === 'import_lista') return 'Importación de lista';
  return 'Factura de compra';
}

function estadoObligacion(o: ObligacionRow) {
  if (o.estado === 'parcial') return 'Parcial';
  if (o.estado === 'pendiente') return 'Pendiente';
  return o.estado || 'Pendiente';
}

export function ProveedorCuentasPorPagarClient({
  proveedorId,
  proveedorResumen,
  saldoCuenta,
  obligacionesInicial,
  canEdit,
}: {
  proveedorId: string;
  proveedorResumen: ProveedorResumen;
  saldoCuenta: number;
  obligacionesInicial: ObligacionRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [obligaciones, setObligaciones] = useState(obligacionesInicial);
  const [saldo, setSaldo] = useState(saldoCuenta);
  const [formId, setFormId] = useState<string | null>(null);
  const [obligacionesSeleccionadas, setObligacionesSeleccionadas] = useState<string[]>([]);

  useEffect(() => {
    setObligaciones(obligacionesInicial);
    setSaldo(saldoCuenta);
  }, [obligacionesInicial, saldoCuenta]);
  const saldoInfo = describirSaldoCuentaCorriente(saldo, 'proveedor');
  const [monto, setMonto] = useState<number | null>(null);
  const [tipoPago, setTipoPago] = useState<TipoPago>('efectivo');
  const [detallePago, setDetallePago] = useState('');
  const [fecha, setFecha] = useState(() => {
    const t = new Date();
    return t.toISOString().slice(0, 10);
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detallePagoMultiple, setDetallePagoMultiple] = useState('');
  const [savingMultiple, setSavingMultiple] = useState(false);
  const [errMultiple, setErrMultiple] = useState<string | null>(null);
  // Pago a cuenta
  const [montoLibre, setMontoLibre] = useState<number | null>(null);
  const [detallePagoLibre, setDetallePagoLibre] = useState('');
  const [savingLibre, setSavingLibre] = useState(false);
  const [errLibre, setErrLibre] = useState<string | null>(null);
  const [cajaInternaHabilitada, setCajaInternaHabilitada] = useState(false);

  useEffect(() => {
    void fetchEffectiveBusinessPrefsOnly().then((p) => {
      setCajaInternaHabilitada(p.cajaInterna.habilitado);
    });
  }, []);

  function abrir(oblId: string, saldoPend: number) {
    setFormId(oblId);
    setMonto(saldoPend > 0 ? saldoPend : null);
    setDetallePago('');
    setErr(null);
  }

  function cerrar() {
    setFormId(null);
    setErr(null);
  }

  function toggleObligacionSeleccionada(id: string, checked: boolean) {
    setObligacionesSeleccionadas((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
    setErrMultiple(null);
  }

  function seleccionarTodasPendientes() {
    setObligacionesSeleccionadas(pendientes.map((o) => o.id));
    setErrMultiple(null);
  }

  function limpiarSeleccionMultiple() {
    setObligacionesSeleccionadas([]);
    setErrMultiple(null);
  }

  async function enviarObl(oblId: string) {
    const m = monto;
    if (m === null || m <= 0) {
      setErr('Indicá un monto válido');
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/pago-proveedor-factura/${oblId}/pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto: m,
        tipo_pago: tipoPago,
        notas: detallePago.trim() || null,
        fecha: fecha,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; resultado?: { nuevo_saldo?: number } };
    setSaving(false);
    if (!res.ok) {
      setErr(j.error ?? 'Error al registrar');
      return;
    }
    const nuevo = j.resultado?.nuevo_saldo;
    setObligaciones((prev) =>
      prev
        .map((o) =>
          o.id === oblId
            ? { ...o, saldo_pendiente: typeof nuevo === 'number' ? nuevo : 0, estado: nuevo === 0 ? 'pagada' : o.estado }
            : o,
        )
        .filter((o) => o.saldo_pendiente > 0.001),
    );
    setSaldo((s) => s - m);
    cerrar();
    router.refresh();
  }

  async function enviarPagoCuenta() {
    const m = montoLibre;
    if (m === null || m <= 0) {
      setErrLibre('Indicá un monto válido');
      return;
    }
    setSavingLibre(true);
    setErrLibre(null);
    const res = await fetch(`/api/proveedores/${proveedorId}/pago-cuenta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto: m,
        tipo_pago: tipoPago,
        notas: detallePagoLibre.trim() || null,
        fecha: fecha,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setSavingLibre(false);
    if (!res.ok) {
      setErrLibre(j.error ?? 'Error al registrar');
      return;
    }
    setMontoLibre(null);
    setDetallePagoLibre('');
    setSaldo((s) => s - m);
    setErrLibre(null);
    router.refresh();
  }

  const pendientes = obligaciones;
  const seleccionadasSet = new Set(obligacionesSeleccionadas);
  const pendientesSeleccionadas = pendientes.filter((o) => seleccionadasSet.has(o.id));
  const totalSeleccionado = Math.round(
    pendientesSeleccionadas.reduce((acc, o) => acc + Number(o.saldo_pendiente), 0) * 100,
  ) / 100;
  const totalPendiente = Math.round(pendientes.reduce((acc, o) => acc + Number(o.saldo_pendiente), 0) * 100) / 100;

  async function generarResumenFacturasPdf() {
    const fechaResumen = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const emisor = await fetchEmisorParaPdfInforme();

    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte(`proveedor-${proveedorResumen.nombre}-facturas-a-pagar`),
      titulo: 'Facturas a pagar',
      emisor,
      lineasMeta: [
        `Fecha del resumen: ${fechaResumen}`,
        `Proveedor: ${proveedorResumen.nombre}`,
        `CUIT: ${textoVacio(proveedorResumen.cuit)} · Telefono: ${textoVacio(proveedorResumen.telefono)} · Email: ${textoVacio(proveedorResumen.email)}`,
        `Direccion: ${textoVacio(proveedorResumen.direccion)}`,
        `Facturas pendientes: ${pendientes.length} · Total a pagar: ${money(totalPendiente)} · ${saldoInfo.titulo}: ${money(saldoInfo.monto)}`,
      ],
      encabezados: ['Documento', 'Fecha', 'Vence', 'Origen', 'Estado', 'Total', 'Saldo a pagar'],
      anchosMm: [45, 22, 22, 28, 20, 24, 25],
      filas: pendientes.map((o) => [
        documentoObligacion(o),
        o.comprobante?.fecha ? fechaCorta(o.comprobante.fecha) : '—',
        fechaCorta(o.vencimiento_at),
        origenObligacion(o),
        estadoObligacion(o),
        money(Number(o.monto_original)),
        money(Number(o.saldo_pendiente)),
      ]),
    });
  }

  async function enviarPagoMultiple() {
    if (pendientesSeleccionadas.length === 0) {
      setErrMultiple('Seleccioná al menos una factura');
      return;
    }
    if (!Number.isFinite(totalSeleccionado) || totalSeleccionado <= 0) {
      setErrMultiple('El total seleccionado debe ser mayor a cero');
      return;
    }

    setSavingMultiple(true);
    setErrMultiple(null);
    const res = await fetch(`/api/proveedores/${proveedorId}/pago-multiple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        obligaciones: pendientesSeleccionadas.map((o) => ({ id: o.id })),
        tipo_pago: tipoPago,
        notas: detallePagoMultiple.trim() || null,
        fecha,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      resultado?: {
        total_pagado?: number;
        facturas?: { id: string; nuevo_saldo: number }[];
      };
    };
    setSavingMultiple(false);
    if (!res.ok) {
      setErrMultiple(j.error ?? 'Error al registrar el pago');
      return;
    }

    const saldoPorFactura = new Map(
      (j.resultado?.facturas ?? []).map((f) => [f.id, Number(f.nuevo_saldo)] as const),
    );
    setObligaciones((prev) =>
      prev
        .map((o) => {
          if (!saldoPorFactura.has(o.id)) return o;
          const nuevo = saldoPorFactura.get(o.id) ?? 0;
          return { ...o, saldo_pendiente: nuevo, estado: nuevo <= 0.001 ? 'pagada' : 'parcial' };
        })
        .filter((o) => o.saldo_pendiente > 0.001),
    );
    setSaldo((s) => s - (j.resultado?.total_pagado ?? totalSeleccionado));
    setObligacionesSeleccionadas([]);
    setDetallePagoMultiple('');
    router.refresh();
  }

  if (!canEdit) {
    return (
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-medium">Cuentas por pagar (facturas)</h2>
          <BotonDescargarPdf disabled={pendientes.length === 0} onGenerar={generarResumenFacturasPdf} />
        </div>
        {pendientes.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No hay comprobantes con saldo en seguimiento.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {pendientes.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                <span>
                  {o.comprobante
                    ? `${o.comprobante.tipo} ${o.comprobante.numero} · ${fechaCorta(o.comprobante.fecha)}`
                    : o.origen === 'import_lista' && o.referencia
                      ? o.referencia
                      : o.origen === 'import_lista'
                        ? 'Importación de lista'
                        : 'Comprobante'}
                </span>
                <span className="font-medium tabular-nums">{money(o.saldo_pendiente)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-medium">Cuentas por pagar</h2>
        <div className="flex flex-wrap items-center gap-2">
          {cajaInternaHabilitada ? (
            <Link
              href={`/tesoreria?proveedor_id=${encodeURIComponent(proveedorId)}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Pagar desde caja interna
            </Link>
          ) : null}
          <BotonDescargarPdf disabled={pendientes.length === 0} onGenerar={generarResumenFacturasPdf} />
        </div>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Registrá pagos asociados a facturas con seguimiento, o un pago a la cuenta (saldo) cuando no aplica una
        factura concreta.
      </p>

      {pendientes.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Facturas con saldo</h3>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={seleccionarTodasPendientes}>
                Seleccionar todas
              </Button>
              {obligacionesSeleccionadas.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={limpiarSeleccionMultiple}>
                  Limpiar selección
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">Pago a varias facturas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Seleccioná las facturas de abajo y registrá un único pago para todas.
                </p>
              </div>
              <p className="font-semibold tabular-nums">{money(totalSeleccionado)}</p>
            </div>
            {errMultiple ? <p className="mt-2 text-xs text-destructive">{errMultiple}</p> : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-0.5 text-xs">
                <span className="text-muted-foreground">Medio</span>
                <select
                  className="border-input h-8 rounded-md border bg-background px-2"
                  value={tipoPago}
                  onChange={(e) => setTipoPago(e.target.value as TipoPago)}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
              <label className="grid gap-0.5 text-xs">
                <span className="text-muted-foreground">Fecha</span>
                <input
                  type="date"
                  className="border-input h-8 rounded-md border bg-background px-2"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </label>
              <label className="grid gap-0.5 text-xs sm:col-span-2">
                <span className="text-muted-foreground">Detalle del pago</span>
                <Input
                  className="h-8"
                  value={detallePagoMultiple}
                  onChange={(e) => setDetallePagoMultiple(e.target.value)}
                  placeholder="Ej. Cheque Banco Macro #123456"
                />
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button
                  type="button"
                  size="sm"
                  disabled={savingMultiple || pendientesSeleccionadas.length === 0}
                  onClick={() => void enviarPagoMultiple()}
                >
                  {savingMultiple
                    ? 'Registrando…'
                    : `Registrar pago de ${pendientesSeleccionadas.length} factura${
                        pendientesSeleccionadas.length === 1 ? '' : 's'
                      }`}
                </Button>
              </div>
            </div>
          </div>

          <ul className="divide-y divide-border rounded-lg border text-sm">
            {pendientes.map((o) => (
              <li key={o.id} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 rounded border-border"
                      checked={seleccionadasSet.has(o.id)}
                      onChange={(e) => toggleObligacionSeleccionada(o.id, e.target.checked)}
                      aria-label={`Seleccionar ${o.comprobante ? `${o.comprobante.tipo} ${o.comprobante.numero}` : 'comprobante'}`}
                    />
                    <div className="min-w-0">
                    <p className="font-medium">
                      {o.comprobante
                        ? `${o.comprobante.tipo} ${o.comprobante.numero}`
                        : o.origen === 'import_lista' && o.referencia
                          ? o.referencia
                          : o.origen === 'import_lista'
                            ? 'Importación de lista (sin comprobante)'
                            : 'Comprobante'}
                    </p>
                    {o.comprobante ? (
                      <p className="text-muted-foreground text-xs">
                        {fechaCorta(o.comprobante.fecha)} · vence {fechaCorta(o.vencimiento_at)}
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-xs">Vence {fechaCorta(o.vencimiento_at)}</p>
                    )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{money(o.saldo_pendiente)}</p>
                    {formId !== o.id ? (
                      <Button type="button" size="sm" className="mt-1" variant="secondary" onClick={() => abrir(o.id, o.saldo_pendiente)}>
                        Registrar pago
                      </Button>
                    ) : null}
                  </div>
                </div>
                {formId === o.id ? (
                  <div className="mt-3 grid max-w-md gap-2 rounded-md bg-muted/50 p-3 sm:grid-cols-2">
                    {err ? <p className="text-destructive col-span-2 text-xs">{err}</p> : null}
                    <label className="grid gap-0.5 text-xs">
                      <span className="text-muted-foreground">Monto</span>
                      <MontoInput
                        className="h-8"
                        value={monto}
                        onValueChange={setMonto}
                        min={0}
                        decimals={2}
                        placeholder="0,00"
                      />
                    </label>
                    <label className="grid gap-0.5 text-xs">
                      <span className="text-muted-foreground">Medio</span>
                      <select
                        className="border-input h-8 rounded-md border bg-background px-2"
                        value={tipoPago}
                        onChange={(e) => setTipoPago(e.target.value as TipoPago)}
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="cheque">Cheque</option>
                        <option value="tarjeta">Tarjeta</option>
                        <option value="otro">Otro</option>
                      </select>
                    </label>
                    <label className="grid gap-0.5 text-xs sm:col-span-2">
                      <span className="text-muted-foreground">Fecha del pago</span>
                      <input
                        type="date"
                        className="border-input h-8 rounded-md border bg-background px-2"
                        value={fecha}
                        onChange={(e) => setFecha(e.target.value)}
                      />
                    </label>
                    <label className="grid gap-0.5 text-xs sm:col-span-2">
                      <span className="text-muted-foreground">Detalle del pago (opcional)</span>
                      <textarea
                        className="border-input min-h-16 rounded-md border bg-background px-2 py-1.5 text-sm shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                        value={detallePago}
                        onChange={(e) => setDetallePago(e.target.value)}
                        placeholder="Ej. transferencia, comprobante, cuenta origen, aclaraciones"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button type="button" size="sm" disabled={saving} onClick={() => void enviarObl(o.id)}>
                        {saving ? 'Registrando…' : 'Confirmar pago'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={cerrar}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">No tenés comprobantes con saldo en seguimiento (desde carga con cuenta corriente).</p>
      )}

      <div className={cn('mt-6 border-t border-border pt-4', pendientes.length > 0 ? '' : 'mt-4 border-t-0 pt-0')}>
        <h3 className="text-sm font-medium">
          Pago a la cuenta ({saldoInfo.titulo.toLowerCase()}: {money(saldoInfo.monto)})
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Usalo para bajar deuda no asociada a facturas con seguimiento, generar saldo a favor o registrar ajustes.
          No modifica el detalle de facturas de la tabla de arriba.
        </p>
        {errLibre ? <p className="text-destructive mt-2 text-sm">{errLibre}</p> : null}
        {pendientes.length > 0 && saldo > 0.001 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Si la deuda corresponde a facturas de la lista, preferí <strong>Pago a varias facturas</strong> o{' '}
            <strong>Registrar pago</strong> en cada fila. El pago a cuenta ajusta el saldo sin detalle de factura.
          </p>
        ) : null}
        {saldo <= 0.001 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Como no hay deuda neta, el pago quedará como saldo a favor del tenant.
          </p>
        ) : null}
        <div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="grid gap-0.5 text-xs">
            <span className="text-muted-foreground">Monto</span>
            <MontoInput
              className="h-8 w-32"
              value={montoLibre}
              onValueChange={setMontoLibre}
              min={0}
              decimals={2}
              placeholder="0,00"
            />
          </label>
          <label className="grid gap-0.5 text-xs">
            <span className="text-muted-foreground">Medio</span>
            <select
              className="border-input h-8 rounded-md border bg-background px-2"
              value={tipoPago}
              onChange={(e) => setTipoPago(e.target.value as TipoPago)}
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label className="grid gap-0.5 text-xs">
            <span className="text-muted-foreground">Fecha</span>
            <input
              type="date"
              className="border-input h-8 rounded-md border bg-background px-2"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={savingLibre || montoLibre === null || montoLibre <= 0}
            onClick={() => void enviarPagoCuenta()}
          >
            {savingLibre ? 'Registrando…' : 'Registrar pago a cuenta'}
          </Button>
          <label className="grid w-full gap-0.5 text-xs">
            <span className="text-muted-foreground">Detalle del pago (opcional)</span>
            <textarea
              className="border-input min-h-16 rounded-md border bg-background px-2 py-1.5 text-sm shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
              value={detallePagoLibre}
              onChange={(e) => setDetallePagoLibre(e.target.value)}
              placeholder="Ej. transferencia, comprobante, cuenta origen, aclaraciones"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
