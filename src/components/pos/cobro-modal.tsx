'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { printTicket } from '@/components/pos/ticket-termico';
import { determinarTipoFactura } from '@/lib/facturacion/tipo-comprobante';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

import type { CartItem } from '@/app/(dashboard)/facturacion/pos/page';

import { loadPosPrefs } from '@/lib/pos/prefs';

const TZ_AR = 'America/Argentina/Buenos_Aires';

function emisionTicketAhora(): { fechaEmision: string; horaEmision: string } {
  const now = new Date();
  return {
    fechaEmision: now.toLocaleDateString('es-AR', {
      timeZone: TZ_AR,
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }),
    horaEmision: now.toLocaleTimeString('es-AR', {
      timeZone: TZ_AR,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
}

function anchoTicketDesdePrefs(): '80mm' | '57mm' {
  if (typeof window === 'undefined') return '80mm';
  const p = loadPosPrefs().anchoTicket;
  return p === '57mm' || p === '80mm' ? p : '80mm';
}

type CondicionIVA = Parameters<typeof determinarTipoFactura>[0];

type MetodoPago = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'mixto';

interface Props {
  items: CartItem[];
  /** Si es true, el servidor rechaza ventas sin stock; si false, permite contra stock (preferencia POS). */
  stockBloqueante: boolean;
  clienteId: string;
  clienteNombre: string;
  clienteCondicionIva: CondicionIVA;
  tipoComprobante: 'ticket' | 'factura';
  total: number;
  subtotal: number;
  descuentoMonto: number;
  ivaMonto: number;
  tenantCondicionIva: CondicionIVA;
  tenantNombre: string;
  tenantLogoUrl?: string | null;
  tenantCuit?: string | null;
  tenantDomicilio?: string | null;
  tenantPuntoVenta?: number | null;
  cajeroNombre?: string | null;
  /** IVA por defecto del tenant cuando el producto no tiene alícuota (p. ej. 21). */
  ivaPorcentajeDefault?: number;
  onSuccess: (result: { comprobanteId: string; numero: number; pdfUrl: string | null }) => void;
  onClose: () => void;
}

type Step = 'metodo' | 'pago' | 'procesando' | 'exito' | 'error';

type MedioCatalogo = {
  id: string;
  nombre: string;
  activo: boolean;
  medio_pago_opcion: { id: string; cuotas: number; recargo_porcentaje: number }[];
};

type PagoTab = 'rapido' | 'planes';

const METODOS: { id: MetodoPago; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'mixto', label: 'Mixto' },
];

/** Partes del pago mixto (sin la opción UI «mixto»); los % vienen de atajos por medio. */
const PARTES_MIXTO = ['efectivo', 'debito', 'credito', 'transferencia'] as const;

export function CobroModal({
  items,
  stockBloqueante,
  clienteId,
  clienteNombre,
  clienteCondicionIva,
  tipoComprobante,
  total,
  subtotal,
  descuentoMonto,
  ivaMonto,
  tenantCondicionIva,
  tenantNombre,
  tenantLogoUrl,
  tenantCuit,
  tenantDomicilio,
  tenantPuntoVenta,
  cajeroNombre,
  ivaPorcentajeDefault = 21,
  onSuccess,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>('metodo');
  const [pagoTab, setPagoTab] = useState<PagoTab>('rapido');
  const [mediosCatalogo, setMediosCatalogo] = useState<MedioCatalogo[]>([]);
  const [rapidosPct, setRapidosPct] = useState<Record<MetodoPago, number>>({
    efectivo: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
    mixto: 0,
  });
  const [medioCatalogoId, setMedioCatalogoId] = useState('');
  const [opcionCatalogoId, setOpcionCatalogoId] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [mixtoDetalle, setMixtoDetalle] = useState<Record<string, number>>({
    efectivo: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [resultData, setResultData] = useState<{
    comprobanteId: string;
    numero: number;
    pdfUrl: string | null;
  } | null>(null);

  const opcionCatalogoSeleccionada = useMemo(() => {
    if (pagoTab !== 'planes' || !opcionCatalogoId) return null;
    for (const m of mediosCatalogo) {
      const o = m.medio_pago_opcion?.find((x) => x.id === opcionCatalogoId);
      if (o) return { ...o, medioNombre: m.nombre };
    }
    return null;
  }, [pagoTab, opcionCatalogoId, mediosCatalogo]);

  /** Ajuste neto por medios (monto parcial × % de cada medio). */
  const ajusteMixtoProporcional = useMemo(() => {
    let adj = 0;
    for (const k of PARTES_MIXTO) {
      const monto = mixtoDetalle[k] ?? 0;
      const pct = rapidosPct[k] ?? 0;
      adj += (monto * pct) / 100;
    }
    return Math.round(adj * 100) / 100;
  }, [mixtoDetalle, rapidosPct]);

  const totalCobro = useMemo(() => {
    if (pagoTab === 'planes' && opcionCatalogoSeleccionada) {
      const pct = opcionCatalogoSeleccionada.recargo_porcentaje;
      return Math.round((total + (total * pct) / 100) * 100) / 100;
    }
    if (pagoTab === 'rapido') {
      if (metodo === 'mixto') {
        return Math.round((total + ajusteMixtoProporcional) * 100) / 100;
      }
      const pct = rapidosPct[metodo] ?? 0;
      return Math.round((total + (total * pct) / 100) * 100) / 100;
    }
    return total;
  }, [total, pagoTab, opcionCatalogoSeleccionada, rapidosPct, metodo, ajusteMixtoProporcional]);

  useEffect(() => {
    if (step !== 'metodo') return;
    void fetch('/api/configuracion/medios-de-pago')
      .then((r) => r.json())
      .then(
        (j: {
          medios?: MedioCatalogo[];
          rapidos?: Partial<Record<MetodoPago, number>>;
        }) => {
          setMediosCatalogo(
            (j.medios ?? []).filter((m) => m.activo && (m.medio_pago_opcion?.length ?? 0) > 0),
          );
          if (j.rapidos) {
            setRapidosPct({
              efectivo: j.rapidos.efectivo ?? 0,
              debito: j.rapidos.debito ?? 0,
              credito: j.rapidos.credito ?? 0,
              transferencia: j.rapidos.transferencia ?? 0,
              mixto: j.rapidos.mixto ?? 0,
            });
          }
        },
      )
      .catch(() => {
        setMediosCatalogo([]);
      });
  }, [step]);

  useEffect(() => {
    if (!medioCatalogoId) {
      setOpcionCatalogoId('');
      return;
    }
    const m = mediosCatalogo.find((x) => x.id === medioCatalogoId);
    if (!m?.medio_pago_opcion?.length) {
      setOpcionCatalogoId('');
      return;
    }
    setOpcionCatalogoId((prev) =>
      m.medio_pago_opcion.some((o) => o.id === prev) ? prev : m.medio_pago_opcion[0].id,
    );
  }, [medioCatalogoId, mediosCatalogo]);

  const recibidoNum = parseFloat(recibido) || 0;
  const vuelto =
    metodo === 'efectivo' && recibidoNum > totalCobro
      ? Math.round((recibidoNum - totalCobro) * 100) / 100
      : 0;

  const faltaEfectivo =
    recibidoNum < totalCobro ? Math.round((totalCobro - recibidoNum) * 100) / 100 : 0;

  const mixtoTotal = PARTES_MIXTO.reduce((s, k) => s + (mixtoDetalle[k] ?? 0), 0);
  const mixtoCompleto = Math.abs(mixtoTotal - total) < 0.02;
  const faltaMixto =
    mixtoTotal < total - 0.02 ? Math.round((total - mixtoTotal) * 100) / 100 : 0;
  const excedeMixto =
    mixtoTotal > total + 0.02 ? Math.round((mixtoTotal - total) * 100) / 100 : 0;

  const canConfirm =
    pagoTab === 'planes'
      ? Boolean(opcionCatalogoId)
      : metodo === 'efectivo'
        ? recibidoNum >= totalCobro
        : metodo === 'mixto'
          ? mixtoCompleto
          : true;

  const confirmar = useCallback(async () => {
    setStep('procesando');
    setErrorMsg('');

    const tipo = determinarTipoFactura(tenantCondicionIva, clienteCondicionIva, {
      quiereTicket: tipoComprobante === 'ticket',
    });

    const body: Record<string, unknown> = {
      tipo,
      cliente_id: clienteId || null,
      items: items.map((it) => ({
        producto_id: it.producto.id,
        cantidad: it.cantidad,
        precio_unitario: it.producto.precio_venta,
      })),
      stock_bloqueante: stockBloqueante,
    };

    if (pagoTab === 'planes' && opcionCatalogoId) {
      body.medio_pago_opcion_id = opcionCatalogoId;
    } else {
      body.metodo_pago = metodo;
      if (metodo === 'mixto') {
        body.metodo_pago_detalle = mixtoDetalle;
      }
    }

    try {
      const res = await fetch('/api/facturacion/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error ?? 'Error al emitir el comprobante');
        setStep('error');
        return;
      }

      const data = await res.json();
      const result = {
        comprobanteId: data.comprobante.id,
        numero: data.comprobante.numero,
        pdfUrl: data.comprobante.pdf_url,
      };
      setResultData(result);
      setStep('exito');
      onSuccess(result);
    } catch {
      setErrorMsg('Error de conexión. El carrito se mantiene intacto.');
      setStep('error');
    }
  }, [
    clienteCondicionIva,
    clienteId,
    items,
    metodo,
    mixtoDetalle,
    onSuccess,
    stockBloqueante,
    tenantCondicionIva,
    tipoComprobante,
    pagoTab,
    opcionCatalogoId,
  ]);

  // Escape to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && step !== 'procesando') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, step]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            {step === 'exito' ? 'Venta completada' : step === 'error' ? 'Error' : 'Cobro'}
          </h2>
          {step !== 'procesando' && (
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          )}
        </div>

        <div className="p-6">
          {/* Step: method selection */}
          {step === 'metodo' && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cliente</span>
                <span className="font-medium">{clienteNombre}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Comprobante</span>
                <span className="font-medium capitalize">{tipoComprobante}</span>
              </div>
              {descuentoMonto > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Descuento</span>
                  <span className="text-green-600">-{formatCurrency(descuentoMonto)}</span>
                </div>
              )}
              <div className="flex justify-between text-2xl font-bold border-t pt-3">
                <span>
                  {pagoTab === 'planes' && opcionCatalogoSeleccionada
                    ? 'Total a cobrar'
                    : pagoTab === 'rapido' && Math.abs(totalCobro - total) > 0.001
                      ? 'Total a cobrar'
                      : 'Total'}
                </span>
                <span>{formatCurrency(totalCobro)}</span>
              </div>
              {pagoTab === 'planes' && opcionCatalogoSeleccionada && Math.abs(totalCobro - total) > 0.001 ? (
                <p className="text-xs text-muted-foreground text-right">
                  Mercadería {formatCurrency(total)} · ajuste medio de pago incluido
                </p>
              ) : null}
              {pagoTab === 'rapido' && metodo !== 'mixto' && Math.abs((rapidosPct[metodo] ?? 0)) > 1e-9 ? (
                <p className="text-xs text-muted-foreground text-right">
                  Mercadería {formatCurrency(total)} · atajo {METODOS.find((x) => x.id === metodo)?.label}:{' '}
                  {(rapidosPct[metodo] ?? 0) >= 0 ? '+' : ''}
                  {rapidosPct[metodo]}%
                </p>
              ) : null}
              {pagoTab === 'rapido' && metodo === 'mixto' ? (
                <p className="text-xs text-muted-foreground text-right">
                  Mercadería {formatCurrency(total)} — en el siguiente paso asignás montos; el % de cada medio
                  se aplica solo al monto de ese medio.
                </p>
              ) : null}

              <div className="flex rounded-lg border p-1 bg-muted/40">
                <button
                  type="button"
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
                    pagoTab === 'rapido' ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                  onClick={() => setPagoTab('rapido')}
                >
                  Rápido
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
                    pagoTab === 'planes' ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                  onClick={() => setPagoTab('planes')}
                >
                  Planes (cuotas)
                </button>
              </div>

              {pagoTab === 'rapido' ? (
                <>
                  <p className="text-sm text-muted-foreground">Método de pago</p>
                  <div className="grid grid-cols-3 gap-2">
                    {METODOS.map((m) => (
                      <Button
                        key={m.id}
                        type="button"
                        variant={metodo === m.id ? 'default' : 'outline'}
                        className="h-14 text-base"
                        onClick={() => setMetodo(m.id)}
                      >
                        {m.label}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Medio configurado</span>
                    <select
                      value={medioCatalogoId}
                      onChange={(e) => {
                        setMedioCatalogoId(e.target.value);
                        setOpcionCatalogoId('');
                      }}
                      className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="">Seleccionar…</option>
                      {mediosCatalogo.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  {medioCatalogoId ? (
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Cuotas / recargo</span>
                      <select
                        value={opcionCatalogoId}
                        onChange={(e) => setOpcionCatalogoId(e.target.value)}
                        className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      >
                        <option value="">Elegir…</option>
                        {(mediosCatalogo.find((x) => x.id === medioCatalogoId)?.medio_pago_opcion ?? []).map(
                          (o) => (
                            <option key={o.id} value={o.id}>
                              {o.cuotas === 1
                                ? 'Contado'
                                : `${o.cuotas} cuotas`}{' '}
                              ({o.recargo_porcentaje >= 0 ? '+' : ''}
                              {o.recargo_porcentaje}%)
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Configurá medios en{' '}
                      <span className="font-medium text-foreground">Configuración → Medios de pago</span>.
                    </p>
                  )}
                </div>
              )}

              <Button
                className="w-full h-14 text-lg font-bold mt-2"
                disabled={pagoTab === 'planes' && (!medioCatalogoId || !opcionCatalogoId)}
                onClick={() => {
                  if (pagoTab === 'planes') {
                    void confirmar();
                    return;
                  }
                  if (metodo === 'efectivo' || metodo === 'mixto') {
                    setStep('pago');
                  } else {
                    void confirmar();
                  }
                }}
              >
                {pagoTab === 'planes'
                  ? 'Confirmar cobro'
                  : metodo === 'efectivo' || metodo === 'mixto'
                    ? 'Continuar'
                    : 'Confirmar cobro'}
              </Button>
            </div>
          )}

          {/* Step: payment details (cash/mixto) */}
          {step === 'pago' && metodo === 'efectivo' && (
            <div className="space-y-4">
              <div className="flex justify-between text-2xl font-bold">
                <span>Total</span>
                <span>{formatCurrency(totalCobro)}</span>
              </div>

              <label className="grid gap-1">
                <span className="text-sm text-muted-foreground">Monto recibido</span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={recibido}
                  onChange={(e) => setRecibido(e.target.value)}
                  placeholder="0.00"
                  className="text-3xl h-16 text-center font-mono"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canConfirm) void confirmar();
                  }}
                />
              </label>

              {faltaEfectivo > 0 && (
                <div className="flex justify-between text-xl font-bold text-amber-600 dark:text-amber-400">
                  <span>Falta</span>
                  <span>{formatCurrency(faltaEfectivo)}</span>
                </div>
              )}

              {vuelto > 0 && (
                <div className="flex justify-between text-2xl font-bold text-green-600">
                  <span>Vuelto</span>
                  <span>{formatCurrency(vuelto)}</span>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('metodo')} className="flex-1">
                  Atrás
                </Button>
                <Button
                  className="flex-1 h-14 text-lg font-bold"
                  disabled={!canConfirm}
                  onClick={() => void confirmar()}
                >
                  Confirmar cobro
                </Button>
              </div>
            </div>
          )}

          {step === 'pago' && metodo === 'mixto' && (
            <div className="space-y-4">
              <div className="flex justify-between text-xl font-bold">
                <span>Total a cobrar</span>
                <span>{formatCurrency(totalCobro)}</span>
              </div>
              {Math.abs(ajusteMixtoProporcional) > 0.001 ? (
                <p className="text-xs text-muted-foreground text-right">
                  Mercadería {formatCurrency(total)}
                  {ajusteMixtoProporcional >= 0 ? ' · ajuste neto +' : ' · ajuste neto '}
                  {formatCurrency(ajusteMixtoProporcional)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground text-right">
                  Mercadería {formatCurrency(total)} — sin ajuste por medios
                </p>
              )}

              <p className="text-sm text-muted-foreground">Distribuir el pago entre métodos (suma = mercadería):</p>

              {PARTES_MIXTO.map((m) => (
                <label key={m} className="flex items-center gap-3">
                  <span className="text-sm w-28 capitalize">{m}</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={mixtoDetalle[m] || ''}
                    onChange={(e) =>
                      setMixtoDetalle((prev) => ({
                        ...prev,
                        [m]: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="flex-1 h-8"
                    placeholder="0.00"
                  />
                </label>
              ))}

              <div
                className={cn(
                  'flex justify-between text-sm font-medium',
                  mixtoCompleto ? 'text-green-600' : 'text-amber-600',
                )}
              >
                <span>Suma (debe igualar mercadería)</span>
                <span>
                  {formatCurrency(mixtoTotal)} / {formatCurrency(total)}
                </span>
              </div>

              {faltaMixto > 0 && (
                <div className="flex justify-between text-lg font-bold text-amber-600 dark:text-amber-400">
                  <span>Falta</span>
                  <span>{formatCurrency(faltaMixto)}</span>
                </div>
              )}

              {excedeMixto > 0 && (
                <div className="flex justify-between text-sm font-medium text-destructive">
                  <span>Excede el total</span>
                  <span>{formatCurrency(excedeMixto)}</span>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('metodo')} className="flex-1">
                  Atrás
                </Button>
                <Button
                  className="flex-1 h-14 text-lg font-bold"
                  disabled={!mixtoCompleto}
                  onClick={() => void confirmar()}
                >
                  Confirmar cobro
                </Button>
              </div>
            </div>
          )}

          {/* Processing */}
          {step === 'procesando' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Procesando la emisión…</p>
            </div>
          )}

          {/* Success */}
          {step === 'exito' && resultData && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <span className="text-3xl">✓</span>
              </div>
              <p className="text-lg font-semibold">
                {tipoComprobante === 'ticket' ? 'Ticket' : 'Factura'} #{resultData.numero}
              </p>
              {vuelto > 0 && (
                <p className="text-2xl font-bold text-green-600">
                  Vuelto: {formatCurrency(vuelto)}
                </p>
              )}
              <div className="flex gap-2 justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const { fechaEmision, horaEmision } = emisionTicketAhora();
                    printTicket(
                      {
                        tenantNombre,
                        logoUrl: tenantLogoUrl,
                        tenantCuit: tenantCuit ?? undefined,
                        tenantDomicilio: tenantDomicilio ?? undefined,
                        tipoComprobante,
                        numero: resultData.numero,
                        fechaEmision,
                        horaEmision,
                        puntoVenta: tenantPuntoVenta ?? undefined,
                        cajeroNombre: cajeroNombre ?? undefined,
                        ivaPorcentajeDefault,
                        clienteNombre,
                        items: items.map((it) => ({
                          nombre: it.producto.nombre,
                          cantidad: it.cantidad,
                          precio_unitario: it.producto.precio_venta,
                          subtotal: Math.round(it.cantidad * it.producto.precio_venta * 100) / 100,
                          unidad: it.producto.unidad,
                          iva_porcentaje: it.producto.iva_porcentaje ?? null,
                          codigo_identificacion:
                            (it.producto.codigo_barras && it.producto.codigo_barras.trim()) ||
                            it.producto.codigo ||
                            null,
                        })),
                        subtotal,
                        descuento: descuentoMonto,
                        ivaMonto,
                        total,
                        metodoPago: metodo,
                        vuelto: vuelto > 0 ? vuelto : undefined,
                      },
                      anchoTicketDesdePrefs(),
                    );
                  }}
                >
                  Imprimir ticket
                </Button>
                <Button onClick={onClose}>Nueva venta</Button>
              </div>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <span className="text-3xl">✗</span>
              </div>
              <p className="text-sm text-destructive">{errorMsg}</p>
              <div className="flex gap-2 justify-center pt-2">
                <Button variant="outline" onClick={() => setStep('metodo')}>
                  Reintentar
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
