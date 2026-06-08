'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createBrowserClient } from '@/lib/supabase/client';
import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';
import {
  comprobanteEsVentaMpPointCompleta,
  comprobanteTienePagoMpPoint,
} from '@/lib/mp-point/venta-mp-completa';
import {
  comprobanteDesdeFacturacionDetalleGet,
  numeroVisibleComprobante,
} from '@/lib/pos/parse-facturacion-detalle-get';
import { reintentarCaeCliente } from '@/lib/pos/reintentar-arca-cliente';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/formatters';

type Resultado = 'esperando' | 'emitiendo' | 'rechazado' | 'error' | 'timeout';

type BroadcastPayload = {
  estado?: string;
  payment_id?: number;
  payment_type?: string;
  motivo?: string;
  comprobante_estado?: string;
};

function parseBroadcastPayload(payload: unknown): BroadcastPayload {
  const o = payload as { payload?: BroadcastPayload };
  return o.payload ?? (payload as BroadcastPayload);
}

export type MpCobroAprobadoPayload = {
  numero: number;
  pdfUrl: string | null;
  comprobanteId: string;
  numeroCaja?: number | null;
  numeroTicketLabel?: string | null;
  lineaCajaTicket?: string | null;
};

/** @deprecated El flujo Posnet ya no usa “fiscal incompleto”: sin CAE se trata como error. Se mantiene el tipo por compatibilidad con integraciones. */
export type MpFiscalIncompletoPayload = {
  comprobanteId: string;
  motivo: string | null;
};

interface Props {
  comprobanteId: string;
  totalCobro: number;
  /** Debe coincidir con `comprobante.sucursal_id` o GET devuelve 404 al hacer polling. */
  sucursalId?: string | null;
  /** Elegido en el POS. Con `ticket` no se solicita CAE AFIP / ARCA (solo factura fiscal). */
  tipoComprobantePos?: 'ticket' | 'factura';
  /** Si existe, inicia el cobro por el motor comun de pasarelas. */
  pasarelaIntegracionId?: string | null;
  onAprobado: (data: MpCobroAprobadoPayload) => void;
  onVolverMetodo: () => void;
  onCancelarVenta: () => void;
}

const TIMEOUT_MS = 3 * 60 * 1000;

function urlApiFacturacionDetalle(comprobanteId: string, sucursalId?: string | null) {
  const s = typeof sucursalId === 'string' ? sucursalId.trim() : '';
  return s !== ''
    ? `/api/facturacion/${encodeURIComponent(comprobanteId)}?sucursal_id=${encodeURIComponent(s)}`
    : `/api/facturacion/${encodeURIComponent(comprobanteId)}`;
}

export function MpPointEspera({
  comprobanteId,
  totalCobro,
  sucursalId,
  tipoComprobantePos,
  pasarelaIntegracionId,
  onAprobado,
  onVolverMetodo,
  onCancelarVenta,
}: Props) {
  const esTicketPos = tipoComprobantePos === 'ticket';
  const [fase, setFase] = useState<Resultado>('esperando');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(true);
  const [cancelando, setCancelando] = useState(false);
  const [tipoPago, setTipoPago] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  const arcaAutoIntentadoRef = useRef(false);
  const onAprobadoRef = useRef(onAprobado);
  const onVolverMetodoRef = useRef(onVolverMetodo);

  onAprobadoRef.current = onAprobado;
  onVolverMetodoRef.current = onVolverMetodo;

  const limpiarTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resolverAprobado = useCallback(
    (payload: MpCobroAprobadoPayload) => {
      if (doneRef.current) return;
      doneRef.current = true;
      limpiarTimeout();
      onAprobadoRef.current(payload);
    },
    [limpiarTimeout],
  );

  const marcarErrorEmisionFiscal = useCallback(
    (motivo: string | null) => {
      if (doneRef.current) return;
      doneRef.current = true;
      limpiarTimeout();
      setErrorMsg(
        motivo?.trim() ||
          'El pago se acreditó pero la factura no quedó autorizada con CAE. Revisá Facturación o ARCA.',
      );
      setFase('error');
    },
    [limpiarTimeout],
  );

  const fetchComprobanteEmitido = useCallback(
    async (opts?: { omitirReintentosAuto?: boolean }): Promise<boolean> => {
      if (doneRef.current) return false;
      const r = await fetch(urlApiFacturacionDetalle(comprobanteId, sucursalId));
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) return false;
      const c = comprobanteDesdeFacturacionDetalleGet(j);
      if (!c) return false;
      const est = String(c.estado ?? '');
      const mpPid = c.mp_point_payment_id;
      const tipo = String((c as { tipo?: unknown }).tipo ?? '');

      if (
        comprobanteTienePagoMpPoint({ mp_point_payment_id: mpPid as number | string | null }) &&
        (est === 'pendiente_arca' || est === 'error_arca') &&
        tipoComprobanteRequiereCaeAfip(tipo)
      ) {
        if (!opts?.omitirReintentosAuto && !arcaAutoIntentadoRef.current) {
          arcaAutoIntentadoRef.current = true;
          await reintentarCaeCliente(comprobanteId);
          return fetchComprobanteEmitido({ omitirReintentosAuto: true });
        }
        const rawErr = (c as Record<string, unknown>).ultimo_error_arca_mensaje;
        const motivo =
          typeof rawErr === 'string' && rawErr.trim() !== '' ? rawErr.trim() : null;
        marcarErrorEmisionFiscal(motivo);
        return true;
      }

      const displayNum = numeroVisibleComprobante(c);
      if (displayNum == null) return false;
      const mpNum =
        typeof mpPid === 'number'
          ? mpPid
          : typeof mpPid === 'string' && mpPid.trim() !== ''
            ? Number(mpPid)
            : null;
      const tipoC = String((c as { tipo?: unknown }).tipo ?? '');
      const caeC = (c as { cae?: unknown }).cae;
      const caeStr = typeof caeC === 'string' ? caeC : caeC != null ? String(caeC) : null;
      if (
        !comprobanteEsVentaMpPointCompleta({
          estado: est,
          tipo: tipoC,
          cae: caeStr,
          mp_point_payment_id: mpNum ?? undefined,
        })
      ) {
        return false;
      }
      const pdfRaw = c.pdf_url;
      const pdfUrl = typeof pdfRaw === 'string' || pdfRaw === null ? (pdfRaw as string | null) : null;
      const ncRaw = c.numero_caja;
      const numeroCaja =
        ncRaw != null && Number.isFinite(Number(ncRaw)) ? Number(ncRaw) : null;
      const lineaRaw = c.linea_caja_ticket;
      const lineaCajaTicket =
        typeof lineaRaw === 'string' && lineaRaw.trim() !== '' ? lineaRaw.trim() : null;
      resolverAprobado({
        numero: displayNum,
        pdfUrl,
        comprobanteId,
        numeroCaja,
        numeroTicketLabel: numeroCaja != null ? `Nº ${numeroCaja}` : null,
        ...(lineaCajaTicket ? { lineaCajaTicket } : {}),
      });
      return true;
    },
    [comprobanteId, sucursalId, marcarErrorEmisionFiscal, resolverAprobado],
  );

  const fetchEmitidoRef = useRef(fetchComprobanteEmitido);
  fetchEmitidoRef.current = fetchComprobanteEmitido;

  useEffect(() => {
    arcaAutoIntentadoRef.current = false;
  }, [comprobanteId]);

  /** Si el broadcast Realtime falla, el backend igual emite con el webhook; reconsultamos el comprobante. */
  useEffect(() => {
    if ((fase !== 'esperando' && fase !== 'emitiendo') || iniciando) return;
    const t = setInterval(() => {
      if (doneRef.current) return;
      void fetchEmitidoRef.current();
    }, 2500);
    void fetchEmitidoRef.current();
    return () => clearInterval(t);
  }, [fase, iniciando]);

  const consultarEstado = useCallback(async () => {
    setConsultando(true);
    setErrorMsg(null);
    try {
      const endpoint = pasarelaIntegracionId
        ? '/api/pagos/pasarela/sincronizar'
        : '/api/pagos/mp-point/sincronizar';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comprobante_id: comprobanteId,
          ...(pasarelaIntegracionId ? { integracion_id: pasarelaIntegracionId } : {}),
        }),
      });
      const j = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setErrorMsg(typeof j.error === 'string' ? j.error : 'No se pudo consultar');
        return;
      }
      if (j.mp_cobro_completo === true) {
        await fetchEmitidoRef.current();
        return;
      }
      if (j.pago_mp_registrado === true && typeof j.mensaje === 'string' && j.mensaje.trim() !== '') {
        setErrorMsg(j.mensaje.trim());
        await fetchEmitidoRef.current();
        return;
      }
      if (j.estado_nexus === 'emitido') {
        await fetchEmitidoRef.current();
        return;
      }
      await fetchEmitidoRef.current();
    } catch {
      setErrorMsg('Error de red al consultar');
    } finally {
      setConsultando(false);
    }
  }, [comprobanteId, pasarelaIntegracionId]);

  useEffect(() => {
    doneRef.current = false;
    const supabase = createBrowserClient();
    const channelName = `comprobante-${comprobanteId}`;
    const channel = supabase.channel(channelName, {
      config: { private: true, broadcast: { self: true } },
    });
    let inicioDisparado = false;
    const iniciarCobro = () => {
      if (inicioDisparado || doneRef.current) return;
      inicioDisparado = true;
      void (async () => {
        try {
          const endpoint = pasarelaIntegracionId
            ? '/api/pagos/pasarela/iniciar'
            : '/api/pagos/mp-point/iniciar';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              comprobante_id: comprobanteId,
              total: totalCobro,
              ...(pasarelaIntegracionId ? { integracion_id: pasarelaIntegracionId } : {}),
            }),
          });
          const j = await res.json();
          if (!res.ok) {
            setErrorMsg(j.error ?? 'No se pudo iniciar el cobro en la terminal');
            if (typeof window !== 'undefined') {
              console.info('[mp-posnet]', 'iniciar_error', { comprobanteId, status: res.status, j });
            }
            setIniciando(false);
            return;
          }
          if (typeof window !== 'undefined') {
            console.info('[mp-posnet]', 'iniciar_ok', {
              comprobanteId,
              intent_id: j.intent_id,
              monto_terminal_pesos: j.monto_terminal_pesos,
              total_enviado_body: totalCobro,
            });
          }
          setErrorMsg(null);
          setIniciando(false);
          timeoutRef.current = setTimeout(() => {
            setFase('timeout');
          }, TIMEOUT_MS);
        } catch {
          setErrorMsg('Error de conexión al iniciar el cobro');
          setIniciando(false);
        }
      })();
    };

    channel.on('broadcast', { event: 'mp_point' }, (payload) => {
      const p = parseBroadcastPayload(payload);
      const est = p.estado;
      if (est === 'aprobado') {
        limpiarTimeout();
        setErrorMsg(null);
        setTipoPago(typeof p.payment_type === 'string' ? p.payment_type : null);
        setFase('emitiendo');
        void (async () => {
          try {
            if (await fetchEmitidoRef.current()) {
              return;
            }
            setErrorMsg('El pago se aprobó pero la emisión aún no está lista. Tocá «Consultar estado».');
          } catch {
            setErrorMsg('No se pudo confirmar la emisión. Usá «Consultar estado».');
          }
        })();
      } else if (est === 'fiscal_incompleto' || est === 'error') {
        limpiarTimeout();
        setFase('emitiendo');
        void (async () => {
          try {
            await reintentarCaeCliente(comprobanteId);
            if (await fetchEmitidoRef.current({ omitirReintentosAuto: true })) {
              return;
            }
            const motivo =
              typeof p.motivo === 'string' && p.motivo.trim() !== ''
                ? p.motivo.trim()
                : null;
            marcarErrorEmisionFiscal(motivo);
          } catch {
            marcarErrorEmisionFiscal(
              typeof p.motivo === 'string' && p.motivo.trim() !== ''
                ? p.motivo.trim()
                : null,
            );
          }
        })();
      } else if (est === 'rechazado') {
        limpiarTimeout();
        setFase('rechazado');
      } else if (est === 'cancelado') {
        limpiarTimeout();
        onVolverMetodoRef.current();
      }
    });

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        iniciarCobro();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[mp-point] realtime no disponible, se usa polling', err);
        iniciarCobro();
      }
    });

    return () => {
      limpiarTimeout();
      void supabase.removeChannel(channel);
    };
  }, [
    comprobanteId,
    totalCobro,
    pasarelaIntegracionId,
    retryNonce,
    limpiarTimeout,
    marcarErrorEmisionFiscal,
    resolverAprobado,
  ]);

  async function cancelar() {
    setCancelando(true);
    setErrorMsg(null);
    try {
      const endpoint = pasarelaIntegracionId
        ? '/api/pagos/pasarela/cancelar'
        : '/api/pagos/mp-point/cancelar';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comprobante_id: comprobanteId,
          ...(pasarelaIntegracionId ? { integracion_id: pasarelaIntegracionId } : {}),
        }),
      });
      const j = await res.json();
      if (res.status === 409) {
        setErrorMsg('El cliente está pagando, esperá el resultado');
        setCancelando(false);
        return;
      }
      if (!res.ok && res.status !== 400) {
        setErrorMsg(j.error ?? 'No se pudo cancelar');
        setCancelando(false);
        return;
      }
      onVolverMetodo();
    } catch {
      setErrorMsg('Error de red');
    }
    setCancelando(false);
  }

  if (fase === 'emitiendo') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <span className="text-3xl" aria-hidden>
            ✓
          </span>
        </div>
        <p className="text-lg font-semibold">Pago aprobado en el Posnet</p>
        {tipoPago ? (
          <p className="text-sm text-muted-foreground capitalize">{tipoPago.replace(/_/g, ' ')}</p>
        ) : null}
        <p className="text-sm text-muted-foreground max-w-sm">
          {esTicketPos ? (
            <>
              Emitiendo ticket interno <span className="whitespace-nowrap">(sin CAE AFIP).</span>{' '}
              Registramos la venta y el cobro; en un momento podés imprimir o seguir cobrando.
            </>
          ) : (
            <>
              Solicitando CAE ante ARCA y actualizando el sistema. En un momento podés imprimir o iniciar otra venta.
            </>
          )}
        </p>
        {errorMsg ? (
          <div className="w-full max-w-sm space-y-2">
            <p className="text-xs text-amber-700 dark:text-amber-200">{errorMsg}</p>
            <Button
              type="button"
              variant="secondary"
              disabled={consultando}
              onClick={() => void consultarEstado()}
            >
              {consultando ? 'Consultando…' : 'Consultar estado'}
            </Button>
          </div>
        ) : null}
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          role="status"
          aria-label="Cargando"
        />
      </div>
    );
  }

  if (fase === 'rechazado') {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <span className="text-3xl">✗</span>
        </div>
        <p className="font-medium">Pago rechazado en la terminal</p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={onVolverMetodo}>
            Intentar de nuevo
          </Button>
          <Button variant="ghost" onClick={onCancelarVenta}>
            Cancelar venta
          </Button>
        </div>
      </div>
    );
  }

  if (fase === 'error') {
    return (
      <div className="space-y-4 text-center py-4">
        <p className="font-medium text-destructive">No se pudo completar la emisión</p>
        {errorMsg ? (
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{errorMsg}</p>
        ) : (
          <p className="text-destructive text-sm">Hubo un error al procesar el cobro en la terminal.</p>
        )}
        <Button variant="outline" onClick={onVolverMetodo}>
          Volver
        </Button>
      </div>
    );
  }

  if (fase === 'timeout') {
    return (
      <div className="space-y-4 py-4">
        <p className="text-sm text-center">
          El pago está tardando más de lo esperado. Verificá la terminal.
        </p>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" disabled={consultando} onClick={() => void consultarEstado()}>
            {consultando ? 'Consultando…' : 'Consultar estado'}
          </Button>
          <Button type="button" variant="outline" onClick={onVolverMetodo}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  if (errorMsg && !iniciando) {
    return (
      <div className="space-y-4 py-4">
        <p className="text-sm text-destructive text-center">{errorMsg}</p>
        <div className="flex gap-2 justify-center">
          <Button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setIniciando(true);
              setFase('esperando');
              setRetryNonce((n) => n + 1);
            }}
          >
            Reintentar
          </Button>
          <Button type="button" variant="outline" onClick={onVolverMetodo}>
            Otro método
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      {esTicketPos ? (
        <div className="rounded-md border border-muted-foreground/25 bg-muted/40 px-3 py-2.5 text-left text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Ticket elegido:</span> este cobro registra un comprobante
          interno. No hay factura electrónica ARCA ni CAE; para fiscal AFIP cambiá a Factura antes de cobrar.
        </div>
      ) : null}
      <div className="text-center">
        <div className="h-12 w-12 mx-auto animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-2xl font-bold tabular-nums">{formatCurrency(totalCobro)}</p>
        <p className="mt-2 font-medium">Esperando pago en terminal…</p>
        <p className="text-sm text-muted-foreground mt-1">
          El cliente puede pagar con tarjeta, débito, NFC o QR
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full min-h-12"
        disabled={cancelando || iniciando}
        onClick={() => void cancelar()}
      >
        {cancelando ? 'Cancelando…' : 'Cancelar'}
      </Button>
      {errorMsg ? <p className="text-sm text-amber-600 text-center">{errorMsg}</p> : null}
    </div>
  );
}
