'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AnularComprobanteDialog } from '@/components/facturacion/anular-comprobante-dialog';
import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import { diagnosticoHumanoArca } from '@/lib/facturacion/arca/diagnostico-humano';
import {
  soloDigitosDocumento,
  validarDocumentoFiscalRealtime,
} from '@/lib/clientes/documento-fiscal';
import { telefonoArgentinoAE164 } from '@/lib/cobranza/logic';
import { userFacingErrorCopy } from '@/lib/errors/user-copy';
import { formatCurrency } from '@/lib/utils/formatters';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Fila = {
  id: string;
  tipo: string;
  estado: string;
  total: number;
  pdf_url: string | null;
  numero_orden: number;
  created_at: string;
  intentos_arca: number | null;
  ultimo_error_arca_codigo: string | null;
  ultimo_error_arca_mensaje: string | null;
  ultimo_intento_arca_at: string | null;
  cliente: {
    id: string;
    nombre: string;
    razon_social: string | null;
    cuit_dni: string | null;
    documento_fiscal_tipo: 'cuit' | 'dni' | null;
    telefono: string | null;
  } | null;
};

export function BandejaArcaClient() {
  const [items, setItems] = useState<Fila[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [anularId, setAnularId] = useState<string | null>(null);
  const [waDisponible, setWaDisponible] = useState(false);
  const [docDraftByCompId, setDocDraftByCompId] = useState<Record<string, string>>({});
  const [docSaveStateByCompId, setDocSaveStateByCompId] = useState<
    Record<string, 'idle' | 'saving' | 'ok' | 'error'>
  >({});
  const [retryStateByCompId, setRetryStateByCompId] = useState<
    Record<string, 'idle' | 'ok' | 'error'>
  >({});

  function draftDocumento(c: Fila): string {
    return docDraftByCompId[c.id] ?? c.cliente?.cuit_dni ?? '';
  }

  function limpiarEstadoExitosoTemporal(compId: string) {
    window.setTimeout(() => {
      setRetryStateByCompId((prev) => ({ ...prev, [compId]: 'idle' }));
      void load();
    }, 1200);
  }

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/facturacion/bandeja-arca', { cache: 'no-store' });
      const json = (await res.json()) as { items?: Fila[]; error?: string };
      if (!res.ok) {
        setError(
          userFacingErrorCopy(
            'arca',
            json.error,
            'No pudimos cargar la bandeja de errores fiscales. Reintentá en unos minutos.',
          ),
        );
        return;
      }
      setItems(json.items ?? []);
    } catch {
      setError(
        userFacingErrorCopy(
          'arca',
          'network',
          'No pudimos conectar con el servicio fiscal. Reintentá en unos minutos.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [featureRes, channelRes] = await Promise.all([
          fetch('/api/whatsapp/feature-flag', { cache: 'no-store' }),
          fetch('/api/whatsapp/channel', { cache: 'no-store' }),
        ]);
        const feature = (await featureRes.json().catch(() => ({}))) as { enabled?: boolean };
        const channel = (await channelRes.json().catch(() => ({}))) as { activa?: boolean };
        setWaDisponible(Boolean(feature.enabled) && Boolean(channel.activa));
      } catch {
        setWaDisponible(false);
      }
    })();
  }, []);

  async function guardarDocumentoCliente(c: Fila): Promise<boolean> {
    if (!c.cliente?.id) {
      setError('Este comprobante no tiene cliente vinculado para actualizar CUIT/DNI.');
      setDocSaveStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
      return false;
    }
    const draft = draftDocumento(c);
    const validacion = validarDocumentoFiscalRealtime(draft);
    if (!validacion.ok) {
      setError(validacion.error);
      setDocSaveStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
      return false;
    }

    const original = soloDigitosDocumento(c.cliente.cuit_dni);
    if (validacion.normalizado === original) {
      return true;
    }

    setDocSaveStateByCompId((prev) => ({ ...prev, [c.id]: 'saving' }));
    try {
      const res = await fetch(`/api/clientes/${encodeURIComponent(c.cliente.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuit_dni: validacion.normalizado || null,
          documento_fiscal_tipo: validacion.tipo,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          userFacingErrorCopy(
            'arca',
            json.error,
            'No pudimos guardar el CUIT/DNI del cliente. Revisá el dato e intentá nuevamente.',
          ),
        );
        setDocSaveStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
        return false;
      }
      setItems((prev) =>
        prev.map((row) =>
          row.id === c.id && row.cliente
            ? {
                ...row,
                cliente: {
                  ...row.cliente,
                  cuit_dni: validacion.normalizado || null,
                  documento_fiscal_tipo: validacion.tipo,
                },
              }
            : row,
        ),
      );
      setDocDraftByCompId((prev) => ({
        ...prev,
        [c.id]: validacion.normalizado,
      }));
      setDocSaveStateByCompId((prev) => ({ ...prev, [c.id]: 'ok' }));
      return true;
    } catch {
      setError(
        userFacingErrorCopy(
          'arca',
          'network',
          'No pudimos guardar el CUIT/DNI por un problema de conexión.',
        ),
      );
      setDocSaveStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
      return false;
    }
  }

  async function autorizarComprobante(c: Fila) {
    setActionId(c.id);
    setError(null);
    if (c.cliente) {
      const draft = draftDocumento(c);
      const hayCambiosDocumento =
        soloDigitosDocumento(draft) !== soloDigitosDocumento(c.cliente.cuit_dni);
      if (hayCambiosDocumento) {
        const validacion = validarDocumentoFiscalRealtime(draft);
        if (!validacion.ok) {
          setError(validacion.error);
          setRetryStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
          setActionId(null);
          return;
        }
        const actualizado = await guardarDocumentoCliente(c);
        if (!actualizado) {
          setRetryStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
          setActionId(null);
          return;
        }
      }
    }

    try {
      const res = await fetch(`/api/facturacion/${c.id}/reintentar-arca`, { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(
          userFacingErrorCopy(
            'arca',
            json.error,
            'No pudimos reintentar la facturación. Reintentá en unos minutos.',
          ),
        );
        setRetryStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
        return;
      }
      setRetryStateByCompId((prev) => ({ ...prev, [c.id]: 'ok' }));
      setItems((prev) =>
        prev.map((row) =>
          row.id === c.id
            ? {
                ...row,
                estado: 'emitido',
                ultimo_error_arca_codigo: null,
                ultimo_error_arca_mensaje: null,
              }
            : row,
        ),
      );
      limpiarEstadoExitosoTemporal(c.id);
    } catch {
      setError(
        userFacingErrorCopy(
          'arca',
          'network',
          'No pudimos reintentar la facturación por un problema de conexión.',
        ),
      );
      setRetryStateByCompId((prev) => ({ ...prev, [c.id]: 'error' }));
    } finally {
      setActionId(null);
    }
  }

  function buildWhatsappUrl(c: Fila): string | null {
    if (!waDisponible || !c.pdf_url || !c.cliente?.telefono) return null;
    const telefono = telefonoArgentinoAE164(c.cliente.telefono);
    if (!telefono) return null;
    const lineas = [
      `Hola ${c.cliente.razon_social?.trim() || c.cliente.nombre},`,
      '',
      `Te compartimos el PDF del comprobante de orden #${c.numero_orden}.`,
      c.pdf_url,
    ];
    return `https://wa.me/${telefono}?text=${encodeURIComponent(lineas.join('\n'))}`;
  }

  return (
    <>
      <AnularComprobanteDialog
        open={anularId != null}
        onOpenChange={(open) => {
          if (!open) setAnularId(null);
        }}
        comprobanteId={anularId}
        apiBasePath="/api/facturacion"
        onAnulado={() => void load()}
      />
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Reintentar carga
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No tenés facturas con errores pendientes de resolver.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border border-zinc-200 dark:border-zinc-700">
          {items.map((c) => {
            const retryState = retryStateByCompId[c.id] ?? 'idle';
            const labelCliente =
              c.cliente?.razon_social?.trim() || c.cliente?.nombre || '—';
            const esPendiente = c.estado === 'pendiente_arca';
            const diagnostico = diagnosticoHumanoArca(
              c.ultimo_error_arca_codigo,
              c.ultimo_error_arca_mensaje,
            );
            const draftDoc = draftDocumento(c);
            const validacionDoc = validarDocumentoFiscalRealtime(draftDoc);
            const waUrl = buildWhatsappUrl(c);
            const estadoVisual =
              retryState === 'ok' ? 'ok' : esPendiente ? 'pendiente' : 'error';
            const docCambiosPendientes =
              soloDigitosDocumento(draftDoc) !== soloDigitosDocumento(c.cliente?.cuit_dni);
            const docSaveState = docSaveStateByCompId[c.id] ?? 'idle';
            return (
              <li
                key={c.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span
                      className={
                        estadoVisual === 'ok'
                          ? 'rounded-md bg-semantic-success-bg px-2 py-0.5 text-xs font-medium text-semantic-success-fg'
                          : estadoVisual === 'pendiente'
                            ? 'rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'
                            : 'rounded-md bg-semantic-arca-error-bg px-2 py-0.5 text-xs font-medium text-semantic-arca-error-fg'
                      }
                    >
                      {estadoVisual === 'ok'
                        ? 'Autorizado'
                        : estadoVisual === 'pendiente'
                          ? 'Pendiente AFIP'
                          : 'Error fiscal'}
                    </span>
                    <span>
                      Orden #{c.numero_orden} · {formatearTipoComprobante(c.tipo)} · {labelCliente} ·{' '}
                      {formatCurrency(Number(c.total))}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Diagnóstico: {diagnostico.titulo}
                  </p>
                  <p className="text-xs text-muted-foreground">Qué revisar: {diagnostico.recomendacion}</p>
                  {diagnostico.detalleTecnico ? (
                    <p className="text-xs text-muted-foreground">
                      Detalle técnico: {diagnostico.codigo ? `${diagnostico.codigo} — ` : null}
                      {diagnostico.detalleTecnico}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.intentos_arca ?? 0} intento(s)
                    {c.ultimo_intento_arca_at
                      ? ` · último ${new Date(c.ultimo_intento_arca_at).toLocaleString('es-AR')}`
                      : null}
                  </p>
                  {c.cliente ? (
                    <div className="mt-2 rounded-md border border-border/70 bg-muted/20 p-2">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        CUIT / DNI del receptor (validación en tiempo real)
                      </p>
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          value={draftDoc}
                          onChange={(e) =>
                            setDocDraftByCompId((prev) => ({
                              ...prev,
                              [c.id]: e.target.value,
                            }))
                          }
                          placeholder="Ej: 20123456786 o 32123456"
                          className="h-10 w-full sm:max-w-[15rem]"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          disabled={
                            actionId === c.id ||
                            docSaveState === 'saving' ||
                            (docCambiosPendientes && !validacionDoc.ok)
                          }
                          onClick={() => {
                            void autorizarComprobante(c);
                          }}
                        >
                          {actionId === c.id || docSaveState === 'saving'
                            ? 'Reintentando…'
                            : 'Reintentar facturación'}
                        </Button>
                      </div>
                      <p
                        className={cn(
                          'mt-1 text-[11px]',
                          validacionDoc.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive',
                        )}
                      >
                        {validacionDoc.ok
                          ? validacionDoc.tipo === 'cuit'
                            ? 'CUIT válido.'
                            : validacionDoc.tipo === 'dni'
                              ? 'DNI válido.'
                              : 'Sin documento cargado (opcional).'
                          : validacionDoc.error}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/facturacion/${c.id}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'default' }))}
                  >
                    Ver comprobante
                  </Link>
                  {!c.cliente ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={actionId === c.id}
                      onClick={() => void autorizarComprobante(c)}
                    >
                      {actionId === c.id ? 'Reintentando…' : 'Reintentar facturación'}
                    </Button>
                  ) : null}
                  {waUrl ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                    >
                      Enviar PDF por WhatsApp
                    </a>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={actionId === c.id}
                    onClick={() => setAnularId(c.id)}
                  >
                    Anular
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
