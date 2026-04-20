'use client';

import { useCallback, useEffect, useState } from 'react';

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

const METODOS: { id: MetodoPago; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'mixto', label: 'Mixto' },
];

export function CobroModal({
  items,
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

  const vuelto =
    metodo === 'efectivo' && parseFloat(recibido) > total
      ? Math.round((parseFloat(recibido) - total) * 100) / 100
      : 0;

  const mixtoTotal = Object.values(mixtoDetalle).reduce((s, v) => s + v, 0);
  const mixtoCompleto = Math.abs(mixtoTotal - total) < 0.01;

  const canConfirm =
    metodo === 'efectivo'
      ? parseFloat(recibido) >= total
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
      metodo_pago: metodo,
    };

    if (metodo === 'mixto') {
      body.metodo_pago_detalle = mixtoDetalle;
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
    tenantCondicionIva,
    tipoComprobante,
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
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>

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

              <Button
                className="w-full h-14 text-lg font-bold mt-2"
                onClick={() => {
                  if (metodo === 'efectivo' || metodo === 'mixto') {
                    setStep('pago');
                  } else {
                    void confirmar();
                  }
                }}
              >
                {metodo === 'efectivo' || metodo === 'mixto'
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
                <span>{formatCurrency(total)}</span>
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
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>

              <p className="text-sm text-muted-foreground">Distribuir el pago entre métodos:</p>

              {(['efectivo', 'debito', 'credito', 'transferencia'] as const).map((m) => (
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
                <span>Suma</span>
                <span>
                  {formatCurrency(mixtoTotal)} / {formatCurrency(total)}
                </span>
              </div>

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
