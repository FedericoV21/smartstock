'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createBrowserClient } from '@/lib/supabase/client';
import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';
import {
  comprobanteEsVentaMpQrCompleta,
  comprobanteTienePagoMpQr,
} from '@/lib/mp-qr/venta-mp-qr-completa';
import type {
  MpCobroAprobadoPayload,
  MpFiscalIncompletoPayload,
} from '@/components/pos/mp-point-espera';
import {
  comprobanteDesdeFacturacionDetalleGet,
  numeroVisibleComprobante,
} from '@/lib/pos/parse-facturacion-detalle-get';
import { reintentarCaeCliente } from '@/lib/pos/reintentar-arca-cliente';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/formatters';

type Resultado = 'esperando' | 'emitiendo' | 'rechazado' | 'error' | 'timeout' | 'huerfano';

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

interface Props {
  comprobanteId: string;
  totalCobro: number;
  /** Debe coincidir con `comprobante.sucursal_id` o GET /api/facturacion/[id] devuelve 404 al hacer polling. */
  sucursalId?: string | null;
  /** Elegido en el POS. Con `ticket` no se solicita CAE AFIP / ARCA (solo factura fiscal). */
  tipoComprobantePos?: 'ticket' | 'factura';
  /** Si existe, inicia el cobro por el motor comun de pasarelas. */
  pasarelaIntegracionId?: string | null;
  onAprobado: (data: MpCobroAprobadoPayload) => void;
  onFiscalIncompleto: (data: MpFiscalIncompletoPayload) => void;
  onVolverMetodo: () => void;
  onCancelarVenta: () => void;
}

const TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_SYNC_RETRY_MS = 10_000;
const AUTO_SYNC_WAITING_MS = 12_000;

function urlApiFacturacionDetalle(comprobanteId: string, sucursalId?: string | null) {
  const s = typeof sucursalId === 'string' ? sucursalId.trim() : '';
  return s !== ''
    ? `/api/facturacion/${encodeURIComponent(comprobanteId)}?sucursal_id=${encodeURIComponent(s)}`
    : `/api/facturacion/${encodeURIComponent(comprobanteId)}`;
}

export function MpQrEspera({
  comprobanteId,
  totalCobro,
  sucursalId,
  tipoComprobantePos,
  pasarelaIntegracionId,
  onAprobado,
  onFiscalIncompleto,
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
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  /** Una tanda de reintentos automáticos POST reintentar-arca por comprobante (evita duplicar con el polling). */
  const arcaAutoIntentadoRef = useRef(false);
  const onAprobadoRef = useRef(onAprobado);
  const onFiscalIncompletoRef = useRef(onFiscalIncompleto);
  const onVolverMetodoRef = useRef(onVolverMetodo);

  onAprobadoRef.current = onAprobado;
  onFiscalIncompletoRef.current = onFiscalIncompleto;
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

  const resolverFiscalIncompleto = useCallback(
    (payload: { motivo: string | null }) => {
      if (doneRef.current) return;
      doneRef.current = true;
      limpiarTimeout();
      onFiscalIncompletoRef.current({
        comprobanteId,
        motivo: payload.motivo,
      });
    },
    [comprobanteId, limpiarTimeout],
  );

  const fetchComprobanteEmitido = useCallback(
    async (opts?: { omitirReintentosAuto?: boolean }): Promise<boolean> => {
      if (doneRef.current) return false;
      const r = await fetch(urlApiFacturacionDetalle(comprobanteId, sucursalId));
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) return false;
      const c = comprobanteDesdeFacturacionDetalleGet(j);
      if (!c) return false;
      const est = String((c as { estado?: unknown }).estado ?? '');
      const tipo = String((c as Record<string, unknown>).tipo ?? '');
      const mpPidRaw = (c as { mp_qr_payment_id?: unknown }).mp_qr_payment_id;
      const pagoQrRegistrado = comprobanteTienePagoMpQr({
        mp_qr_payment_id:
          mpPidRaw === undefined || mpPidRaw === null
            ? null
            : typeof mpPidRaw === 'number'
              ? mpPidRaw
              : typeof mpPidRaw === 'string'
                ? mpPidRaw
                : String(mpPidRaw),
      });

      if (esTicketPos && pagoQrRegistrado && est === 'emitido') {
        const displayNum = numeroVisibleComprobante(c);
        if (displayNum != null) {
          const pdfRaw = (c as { pdf_url?: unknown }).pdf_url;
          const pdfUrl =
            typeof pdfRaw === 'string' || pdfRaw === null ? (pdfRaw as string | null) : null;
          const ncRaw = (c as { numero_caja?: unknown }).numero_caja;
          const nc = ncRaw != null && Number.isFinite(Number(ncRaw)) ? Number(ncRaw) : null;
          const lineaRaw = (c as { linea_caja_ticket?: unknown }).linea_caja_ticket;
          const linea =
            typeof lineaRaw === 'string' && lineaRaw.trim() !== '' ? lineaRaw.trim() : null;
          resolverAprobado({
            numero: displayNum,
            pdfUrl,
            comprobanteId,
            numeroCaja: nc,
            numeroTicketLabel: nc != null ? `Nº ${nc}` : null,
            ...(linea ? { lineaCajaTicket: linea } : {}),
          });
          return true;
        }
      }

      if (
        comprobanteTienePagoMpQr({
          mp_qr_payment_id:
            mpPidRaw === undefined || mpPidRaw === null
              ? null
              : typeof mpPidRaw === 'number'
                ? mpPidRaw
                : typeof mpPidRaw === 'string'
                  ? mpPidRaw
                  : String(mpPidRaw),
        }) &&
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
        resolverFiscalIncompleto({ motivo });
        return true;
      }

      const displayNum = numeroVisibleComprobante(c);
      const mpPid = (c as { mp_qr_payment_id?: unknown }).mp_qr_payment_id;
      const paymentId =
        typeof mpPid === 'number'
          ? mpPid
          : typeof mpPid === 'string' && String(mpPid).trim() !== ''
            ? Number(mpPid)
            : null;
      const caeC = (c as { cae?: unknown }).cae;
      const caeStr = typeof caeC === 'string' ? caeC : caeC != null ? String(caeC) : null;
      const tipoC = String((c as Record<string, unknown>).tipo ?? '');
      if (
        displayNum != null &&
        comprobanteEsVentaMpQrCompleta({
          estado: est,
          tipo: tipoC,
          cae: caeStr,
          mp_qr_payment_id: paymentId ?? undefined,
        })
      ) {
        const pdfRaw = (c as { pdf_url?: unknown }).pdf_url;
        const pdfUrl =
          typeof pdfRaw === 'string' || pdfRaw === null ? (pdfRaw as string | null) : null;
        const ncRaw = (c as { numero_caja?: unknown }).numero_caja;
        const nc =
          ncRaw != null && Number.isFinite(Number(ncRaw)) ? Number(ncRaw) : null;
        const lineaRaw = (c as { linea_caja_ticket?: unknown }).linea_caja_ticket;
        const linea =
          typeof lineaRaw === 'string' && lineaRaw.trim() !== ''
            ? lineaRaw.trim()
            : null;
        resolverAprobado({
          numero: displayNum,
          pdfUrl,
          comprobanteId,
          numeroCaja: nc,
          numeroTicketLabel: nc != null ? `Nº ${nc}` : null,
          ...(linea ? { lineaCajaTicket: linea } : {}),
        });
        return true;
      }
      return false;
    },
    [comprobanteId, sucursalId, esTicketPos, resolverAprobado, resolverFiscalIncompleto],
  );

  const fetchEmitidoRef = useRef(fetchComprobanteEmitido);
  fetchEmitidoRef.current = fetchComprobanteEmitido;

  const parseSyncResponse = useCallback(async (res: Response): Promise<Record<string, unknown>> => {
    const raw = await res.text();
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const trimmed = raw.trim();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
        return {
          error:
            'Mercado Pago devolvio una pagina HTML en vez de JSON. Reintenta en unos segundos; si persiste, revisa token/configuracion de MP QR.',
        };
      }
      return { error: trimmed.slice(0, 300) || 'Respuesta invalida del servidor al consultar estado' };
    }
  }, []);

  useEffect(() => {
    arcaAutoIntentadoRef.current = false;
  }, [comprobanteId]);

  useEffect(() => {
    function onOnline() {
      setOffline(false);
    }
    function onOffline() {
      setOffline(true);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if ((fase !== 'esperando' && fase !== 'emitiendo') || iniciando) return;
    const t = setInterval(() => {
      if (doneRef.current) return;
      void fetchEmitidoRef.current();
    }, 2500);
    void fetchEmitidoRef.current();
    return () => clearInterval(t);
  }, [fase, iniciando]);

  const consultarEstado = useCallback(async (opts?: { silencioso?: boolean }) => {
    if (consultando) return;
    setConsultando(true);
    if (!opts?.silencioso) setErrorMsg(null);
    try {
      const endpoint = pasarelaIntegracionId
        ? '/api/pagos/pasarela/sincronizar'
        : '/api/pagos/mp-qr/sincronizar';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comprobante_id: comprobanteId,
          ...(pasarelaIntegracionId ? { integracion_id: pasarelaIntegracionId } : {}),
        }),
      });
      const j = await parseSyncResponse(res);
      if (!res.ok) {
        if (!opts?.silencioso) {
          setErrorMsg(typeof j.error === 'string' ? j.error : 'No se pudo consultar');
        }
        return;
      }
      if (j.consulta_mp_omitida === true && opts?.silencioso) {
        await fetchEmitidoRef.current();
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
      if (j.estado_nexus === 'emitido' || j.estado === 'emitido') {
        await fetchEmitidoRef.current();
        return;
      }
      await fetchEmitidoRef.current();
    } catch {
      setErrorMsg('Error de red al consultar');
    } finally {
      setConsultando(false);
    }
  }, [comprobanteId, consultando, parseSyncResponse, pasarelaIntegracionId]);

  useEffect(() => {
    if (doneRef.current || offline) return;
    if (iniciando || consultando) return;
    if (fase !== 'timeout' && fase !== 'emitiendo') return;
    const t = setInterval(() => {
      if (doneRef.current || consultando) return;
      void consultarEstado({ silencioso: true });
    }, AUTO_SYNC_RETRY_MS);
    return () => clearInterval(t);
  }, [consultando, consultarEstado, fase, iniciando, offline]);

  useEffect(() => {
    if (doneRef.current || offline) return;
    if (errorMsg) return;
    if (iniciando || consultando) return;
    if (fase !== 'esperando') return;
    const t = setInterval(() => {
      if (doneRef.current || consultando || offline) return;
      void consultarEstado({ silencioso: true });
    }, AUTO_SYNC_WAITING_MS);
    return () => clearInterval(t);
  }, [consultando, consultarEstado, errorMsg, fase, iniciando, offline]);

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
            : '/api/pagos/mp-qr/iniciar';
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
            const msg =
              res.status === 409
                ? 'Esta caja tiene un cobro en curso. Esperá unos segundos o cancelalo desde la ticketera.'
                : typeof j.error === 'string'
                  ? j.error
                  : 'No se pudo iniciar el cobro QR';
            setErrorMsg(msg);
            setIniciando(false);
            return;
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

    channel.on('broadcast', { event: 'mp_qr' }, (payload) => {
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
        /**
         * El webhook puede emitir `error` / `fiscal_incompleto` antes de que el polling ejecute
         * reintentos; sin este bloque el modal AFIP aparece aunque un reintento inmediato logre CAE
         * (como al facturar desde el comprobante después).
         */
        limpiarTimeout();
        setTipoPago(typeof p.payment_type === 'string' ? p.payment_type : null);
        setFase('emitiendo');
        void (async () => {
          try {
            if (esTicketPos) {
              if (await fetchEmitidoRef.current({ omitirReintentosAuto: true })) {
                return;
              }
              setErrorMsg(
                'El pago se aprobó pero el ticket interno no quedó listo. Tocá «Consultar estado».',
              );
              setFase('esperando');
              return;
            }
            await reintentarCaeCliente(comprobanteId);
            if (await fetchEmitidoRef.current({ omitirReintentosAuto: true })) {
              return;
            }
            const motivoFallback =
              typeof p.motivo === 'string' && p.motivo.trim() !== ''
                ? p.motivo.trim()
                : null;
            resolverFiscalIncompleto({ motivo: motivoFallback });
          } catch {
            if (esTicketPos) {
              if (await fetchEmitidoRef.current({ omitirReintentosAuto: true })) {
                return;
              }
              setErrorMsg('No se pudo confirmar el ticket. Usá «Consultar estado».');
              setFase('esperando');
              return;
            }
            resolverFiscalIncompleto({
              motivo:
                typeof p.motivo === 'string' && p.motivo.trim() !== ''
                  ? p.motivo.trim()
                  : null,
            });
          }
        })();
      } else if (est === 'rechazado') {
        limpiarTimeout();
        setFase('rechazado');
      } else if (est === 'cancelado') {
        limpiarTimeout();
        onVolverMetodoRef.current();
      } else if (est === 'pago_huerfano') {
        limpiarTimeout();
        setFase('huerfano');
      }
    });

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        iniciarCobro();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[mp-qr] realtime no disponible, se usa polling', err);
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
    esTicketPos,
    limpiarTimeout,
    resolverAprobado,
    resolverFiscalIncompleto,
  ]);

  async function cancelar() {
    setCancelando(true);
    setErrorMsg(null);
    try {
      const endpoint = pasarelaIntegracionId
        ? '/api/pagos/pasarela/cancelar'
        : '/api/pagos/mp-qr/cancelar';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comprobante_id: comprobanteId,
          liberar_qr: true,
          ...(pasarelaIntegracionId ? { integracion_id: pasarelaIntegracionId } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(typeof j.error === 'string' ? j.error : 'No se pudo cancelar');
        setCancelando(false);
        return;
      }
      onVolverMetodo();
    } catch {
      setErrorMsg('Error de red');
    }
    setCancelando(false);
  }

  const puedeLiberarQr =
    errorMsg != null &&
    /cobro en curso|venta en curso|orden activa|in_use|occupied/i.test(errorMsg);

  if (fase === 'emitiendo') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <span className="text-3xl" aria-hidden>
            ✓
          </span>
        </div>
        <p className="text-lg font-semibold">¡Pago aprobado!</p>
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

  if (fase === 'huerfano') {
    return (
      <div className="space-y-4 text-center py-4">
        <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
          Llegó un pago aprobado después de cancelar el cobro en el POS. Quedó registrado como pago sin venta
          asociada: revisá con un administrador en Mercado Pago o en soporte.
        </p>
        <Button type="button" variant="outline" onClick={() => onVolverMetodo()}>
          Volver a métodos de pago
        </Button>
      </div>
    );
  }

  if (fase === 'rechazado') {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <span className="text-3xl">✗</span>
        </div>
        <p className="font-medium">Pago rechazado</p>
        <div className="flex gap-2 justify-center flex-wrap">
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
        <p className="text-destructive text-sm">Hubo un error al procesar el pago con QR.</p>
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
          El pago está tardando más de lo esperado. El cliente puede haber demorado en escanear o completar el pago.
        </p>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" disabled={consultando} onClick={() => void consultarEstado()}>
            {consultando ? 'Consultando…' : 'Consultar estado'}
          </Button>
          <Button type="button" variant="outline" disabled={cancelando} onClick={() => void cancelar()}>
            {cancelando ? 'Cancelando…' : 'Cancelar y volver'}
          </Button>
        </div>
      </div>
    );
  }

  if (errorMsg && !iniciando) {
    return (
      <div className="space-y-4 py-4">
        <p className="text-sm text-destructive text-center">{errorMsg}</p>
        <div className="flex gap-2 justify-center flex-wrap">
          {puedeLiberarQr ? (
            <Button type="button" variant="secondary" disabled={cancelando} onClick={() => void cancelar()}>
              {cancelando ? 'Cancelando…' : 'Cancelar cobro en MP'}
            </Button>
          ) : null}
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
          {!puedeLiberarQr ? (
            <Button type="button" variant="outline" onClick={onVolverMetodo}>
              Otro método
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      {offline ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          Sin conexión: el pago puede haberse completado igual. Cuando vuelva internet tocá «Verificar».
          <div className="mt-2">
            <Button type="button" size="sm" variant="secondary" disabled={consultando} onClick={() => void consultarEstado()}>
              {consultando ? '…' : 'Verificar'}
            </Button>
          </div>
        </div>
      ) : null}
      {esTicketPos ? (
        <div className="rounded-md border border-muted-foreground/25 bg-muted/40 px-3 py-2.5 text-left text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Ticket elegido:</span> este cobro registra un comprobante
          interno. No hay factura electrónica ARCA ni CAE; para fiscal AFIP cambiá a Factura antes de cobrar.
        </div>
      ) : null}
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/40 bg-muted/30 text-4xl" aria-hidden>
          ▦
        </div>
        <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalCobro)}</p>
        <p className="font-medium">Esperando que el cliente escanee el QR…</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          El monto ya está cargado en el QR del mostrador. Decile al cliente que abra Mercado Pago, Modo o cualquier
          billetera con QR y escanee el código fijo del mostrador.
        </p>
      </div>
      {iniciando ? (
        <div className="flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="w-full min-h-12"
        disabled={cancelando || iniciando}
        onClick={() => void cancelar()}
      >
        {cancelando ? 'Cancelando…' : 'Cancelar'}
      </Button>
      {errorMsg && iniciando ? <p className="text-xs text-amber-600 text-center">{errorMsg}</p> : null}
    </div>
  );
}
