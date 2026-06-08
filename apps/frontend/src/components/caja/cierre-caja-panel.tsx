'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Banknote, Calculator, CheckCircle2, ChevronDown, ExternalLink, Lock, LockOpen } from 'lucide-react';

import { BotonDescargarPdf } from '@/components/reportes/boton-descargar-pdf';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import { CajasGestionCierre, type CajaConfigRow } from '@/components/caja/cajas-gestion-cierre';
import { GastosCajaLineasEditor, type GastoLineaBorrador } from '@/components/caja/gastos-caja-lineas-editor';
import { fetchEffectiveBusinessPrefsOnly } from '@/lib/business-prefs/fetch';
import { redondear2 } from '@/lib/caja/cierre-z-calculo';
import { etiquetaMetodoPagoCierre } from '@/lib/caja/etiqueta-metodo-pago-cierre';
import type { CajaGastoSesionRow } from '@/lib/caja/caja-gastos-sesion';
import { compactarGastosDesdeBorrador } from '@/lib/caja/gastos-cierre';
import { nombrePdfReporte, descargarPdfTabla } from '@/lib/reportes/pdf-informe';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, hoyEnAR, TIMEZONE_AR } from '@/lib/utils/formatters';

type Snapshot = {
  total_comprobantes: number;
  ventas_brutas: number;
  notas_credito_total: number;
  ventas_netas: number;
  pagos_cta_cte_total: number;
  efectivo_cobros_cc_manual?: number;
  efectivo_esperado: number;
  fondo_apertura?: number;
  efectivo_ventas_periodo?: number;
  modo_periodo?: string;
  medios: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[];
};

type AperturaVigente = {
  id: string;
  opened_at: string;
  fondo_efectivo: number;
  fecha_operativa: string;
};

type EventoHistorialCaja =
  | {
      tipo: 'apertura';
      id: string;
      at: string;
      fondo_efectivo: number;
      fecha_operativa: string;
    }
  | {
      tipo: 'cierre';
      id: string;
      at: string;
      caja_id: string;
      fecha_operativa: string;
      tipo_cierre: 'diario' | 'parcial';
      rango_desde: string;
      rango_hasta: string;
      ventas_brutas: number;
      notas_credito_total: number;
      ventas_netas: number;
      pagos_cta_cte_total: number;
      total_comprobantes: number;
      reciente_fuera_fecha?: boolean;
      payload_resumen?: {
        jornada?: string | null;
        gastos_items?: { concepto: string; monto: number }[] | null;
        arqueo_efectivo?: {
          fondo_apertura?: number;
          efectivo_ventas_periodo?: number;
          esperado?: number;
          esperado_sistema?: number;
          esperado_ajustado?: number;
          gastos_monto?: number;
          gastos_detalle?: string | null;
          contado: number;
          diferencia: number;
        } | null;
        modo_periodo?: string | null;
      } | null;
      medios: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[];
    };

type OrdenDetalleCierre = {
  id: string;
  numero_orden: number | null;
  tipo: string;
  numero_visible: string;
  fecha: string;
  created_at: string;
  cliente: string;
  usuario: string | null;
  metodo_pago: string | null;
  total: number;
  url_detalle: string;
};

type DetalleCierreCaja = {
  cierre: {
    id: string;
    caja_id: string;
    fecha_operativa: string;
    tipo_cierre: 'diario' | 'parcial';
    rango_desde: string;
    rango_hasta: string;
    total_comprobantes: number;
    ventas_brutas: number;
    notas_credito_total: number;
    ventas_netas: number;
    pagos_cta_cte_total: number;
    created_at: string;
    payload_resumen?: Extract<EventoHistorialCaja, { tipo: 'cierre' }>['payload_resumen'];
  };
  medios: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[];
  ordenes: OrdenDetalleCierre[];
};

const horaArFormatter = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE_AR,
});

function formatHoraAR(value: string): string {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? horaArFormatter.format(d) : '--:--';
}

export function CierreCajaPanel() {
  const hoy = useMemo(() => hoyEnAR(), []);
  const [fechaOperativa, setFechaOperativa] = useState(hoy);
  const [cajaId, setCajaId] = useState('');
  const [cajaIdOperativa, setCajaIdOperativa] = useState<string | null>(null);
  const [modoPeriodo, setModoPeriodo] = useState<'jornada_fecha' | 'sesion_apertura'>('jornada_fecha');
  const [tipoCierre, setTipoCierre] = useState<'diario' | 'parcial'>('diario');
  const [rangoDesdeHora, setRangoDesdeHora] = useState('08:00');
  const [rangoHastaHora, setRangoHastaHora] = useState('12:00');
  const [efectivoContado, setEfectivoContado] = useState<number | null>(null);
  const [gastosLineas, setGastosLineas] = useState<GastoLineaBorrador[]>([]);
  const [gastosSesion, setGastosSesion] = useState<CajaGastoSesionRow[]>([]);
  const [totalGastosSesion, setTotalGastosSesion] = useState(0);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventoHistorialCaja[]>([]);
  const [aperturaVigente, setAperturaVigente] = useState<AperturaVigente | null>(null);
  const [ultimoCierreContado, setUltimoCierreContado] = useState<number | null>(null);
  const [fondoRegistrar, setFondoRegistrar] = useState<number | null>(null);
  const [regAperturaBusy, setRegAperturaBusy] = useState(false);
  const [cierreExitoMsg, setCierreExitoMsg] = useState<string | null>(null);
  const [detalleCierreId, setDetalleCierreId] = useState<string | null>(null);
  const [detalleCierre, setDetalleCierre] = useState<DetalleCierreCaja | null>(null);
  const [detalleCierreLoading, setDetalleCierreLoading] = useState(false);
  const [detalleCierreError, setDetalleCierreError] = useState<string | null>(null);

  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const [sucursalesOpt, setSucursalesOpt] = useState<{ id: string; nombre: string; codigo: string }[]>([]);
  const [cajasConfig, setCajasConfig] = useState<CajaConfigRow[]>([]);
  const [cajasGestion, setCajasGestion] = useState<CajaConfigRow[]>([]);
  const [puedeGestionarCajas, setPuedeGestionarCajas] = useState(false);
  const [usuariosCajaOpciones, setUsuariosCajaOpciones] = useState<{ id: string; label: string }[]>([]);
  const [contextoCajasLoading, setContextoCajasLoading] = useState(true);
  const [contextoCajasError, setContextoCajasError] = useState<string | null>(null);
  const [cajaInternaHabilitada, setCajaInternaHabilitada] = useState(false);

  useEffect(() => {
    void fetchEffectiveBusinessPrefsOnly().then((p) => {
      setCajaInternaHabilitada(p.cajaInterna.habilitado);
    });
  }, []);

  const gastosCompact = useMemo(() => compactarGastosDesdeBorrador(gastosLineas), [gastosLineas]);
  const totalGastosAdicionales = gastosCompact.ok ? gastosCompact.total : 0;
  const totalGastos = redondear2(totalGastosSesion + totalGastosAdicionales);
  const diferenciaPreview =
    preview && efectivoContado !== null
      ? redondear2(efectivoContado - (preview.efectivo_esperado - totalGastos))
      : null;

  const opcionesCajaRegistrada = useMemo(() => {
    const activas = cajasConfig.filter((c) => c.activa);
    const cur = cajasConfig.find((c) => c.id === cajaId && !c.activa);
    return cur ? [...activas, cur] : activas;
  }, [cajasConfig, cajaId]);

  const cajaSelectRegistrada = opcionesCajaRegistrada.some((c) => c.id === cajaId) ? cajaId : '';
  const cajaRegistradaElegida = cajaSelectRegistrada
    ? opcionesCajaRegistrada.find((c) => c.id === cajaSelectRegistrada)
    : null;

  useEffect(() => {
    async function loadCajaOperativa() {
      try {
        const [mpQrRes, mpPointRes] = await Promise.all([
          fetch('/api/configuracion/mp-qr', { cache: 'no-store' }),
          fetch('/api/configuracion/mp-point', { cache: 'no-store' }),
        ]);

        let nextCaja: string | null = null;
        if (mpQrRes.ok) {
          const mpQr = (await mpQrRes.json()) as { external_pos_id?: string | null };
          const qrId = String(mpQr.external_pos_id ?? '').trim();
          if (qrId) nextCaja = qrId;
        }
        if (!nextCaja && mpPointRes.ok) {
          const mpPoint = (await mpPointRes.json()) as { device_id?: string | null };
          const pointId = String(mpPoint.device_id ?? '').trim();
          if (pointId) nextCaja = pointId;
        }

        setCajaIdOperativa(nextCaja);
        if (nextCaja) {
          setCajaId((prev) => (prev.trim() ? prev : nextCaja));
        }
      } catch {
        setCajaIdOperativa(null);
      }
    }
    void loadCajaOperativa();
  }, []);

  async function loadCajaContext(sid?: string | null) {
    setContextoCajasLoading(true);
    setContextoCajasError(null);
    try {
      const qs = sid ? `?sucursal_id=${encodeURIComponent(sid)}` : '';
      const res = await fetch(`/api/configuracion/cajas${qs}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        sucursales?: { id: string; nombre: string; codigo: string }[];
        sucursal_id?: string | null;
        cajas?: CajaConfigRow[];
        cajas_gestion?: CajaConfigRow[];
        puede_gestionar?: boolean;
        usuarios_opciones?: { id: string; label: string }[];
        error?: string;
      };
      if (!res.ok) {
        setContextoCajasError(json.error ?? 'No se pudo cargar sucursales y cajas');
        setSucursalId(null);
        setSucursalesOpt([]);
        setCajasConfig([]);
        setCajasGestion([]);
        setContextoCajasLoading(false);
        return;
      }
      setSucursalesOpt(json.sucursales ?? []);
      setSucursalId(typeof json.sucursal_id === 'string' ? json.sucursal_id : null);
      setCajasConfig((json.cajas ?? []) as CajaConfigRow[]);
      setCajasGestion((json.cajas_gestion ?? json.cajas ?? []) as CajaConfigRow[]);
      setPuedeGestionarCajas(Boolean(json.puede_gestionar));
      setUsuariosCajaOpciones(json.usuarios_opciones ?? []);
    } catch {
      setContextoCajasError('Error de red al cargar cajas');
      setSucursalId(null);
      setCajasGestion([]);
    }
    setContextoCajasLoading(false);
  }

  useEffect(() => {
    void loadCajaContext();
  }, []);

  async function loadHistorial() {
    if (!sucursalId) {
      setLoading(false);
      setEventos([]);
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    qs.set('fecha_operativa', fechaOperativa);
    qs.set('sucursal_id', sucursalId);
    qs.set('incluir_ultimos', '1');
    if (cajaId.trim()) qs.set('caja_id', cajaId.trim());
    const res = await fetch(`/api/caja/historial-movimientos?${qs.toString()}`);
    const json = (await res.json()) as { eventos?: EventoHistorialCaja[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo cargar el historial');
      setEventos([]);
    } else {
      setEventos((json.eventos ?? []) as EventoHistorialCaja[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaOperativa, cajaId, sucursalId]);

  useEffect(() => {
    setDetalleCierreId(null);
    setDetalleCierre(null);
    setDetalleCierreError(null);
  }, [fechaOperativa, cajaId, sucursalId]);

  async function loadApertura() {
    if (!sucursalId) {
      setAperturaVigente(null);
      setUltimoCierreContado(null);
      return;
    }
    const qs = new URLSearchParams();
    qs.set('sucursal_id', sucursalId);
    if (cajaId.trim()) qs.set('caja_id', cajaId.trim());
    const res = await fetch(`/api/caja/apertura?${qs.toString()}`, { cache: 'no-store' });
    const json = (await res.json()) as {
      vigente?: AperturaVigente | null;
      ultimo_cierre_contado?: number | null;
    };
    if (res.ok) {
      setAperturaVigente(json.vigente ?? null);
      setUltimoCierreContado(
        json.ultimo_cierre_contado !== undefined && json.ultimo_cierre_contado !== null
          ? Number(json.ultimo_cierre_contado)
          : null,
      );
    } else {
      setAperturaVigente(null);
      setUltimoCierreContado(null);
    }
  }

  useEffect(() => {
    void loadApertura();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaOperativa, cajaId, sucursalId]);

  useEffect(() => {
    if (modoPeriodo === 'sesion_apertura' && tipoCierre === 'parcial') {
      setTipoCierre('diario');
    }
  }, [modoPeriodo, tipoCierre]);

  async function consultarMovimientos() {
    if (!sucursalId) {
      setError('Elegí una sucursal para consultar movimientos.');
      return;
    }
    setPreviewLoading(true);
    setError(null);
    setCierreExitoMsg(null);
    const qs = new URLSearchParams();
    qs.set('preview', '1');
    qs.set('sucursal_id', sucursalId);
    if (modoPeriodo !== 'sesion_apertura') {
      qs.set('fecha_operativa', fechaOperativa);
    }
    if (cajaId.trim()) qs.set('caja_id', cajaId.trim());
    if (modoPeriodo === 'sesion_apertura') {
      qs.set('modo_periodo', 'sesion_apertura');
      qs.set('tipo_cierre', 'diario');
    } else {
      qs.set('tipo_cierre', tipoCierre);
      if (tipoCierre === 'parcial') {
        qs.set('rango_desde_hora', rangoDesdeHora);
        qs.set('rango_hasta_hora', rangoHastaHora);
      }
    }
    const res = await fetch(`/api/caja/cierre-z?${qs.toString()}`, { cache: 'no-store' });
    const json = (await res.json()) as {
      snapshot?: Snapshot;
      gastos_sesion?: CajaGastoSesionRow[];
      total_gastos_sesion?: number;
      error?: string;
    };
    if (!res.ok) {
      setPreview(null);
      setGastosSesion([]);
      setTotalGastosSesion(0);
      setError(json.error ?? 'No se pudo calcular el período');
    } else {
      setPreview(json.snapshot ?? null);
      setGastosSesion(json.gastos_sesion ?? []);
      setTotalGastosSesion(Number(json.total_gastos_sesion ?? 0));
    }
    setPreviewLoading(false);
  }

  async function confirmarCierre() {
    if (!sucursalId) {
      setError('Elegí una sucursal antes de confirmar el cierre.');
      return;
    }
    if (!preview) {
      setError('Consultá primero los movimientos del período antes de confirmar el cierre.');
      return;
    }
    setSaving(true);
    setError(null);
    setCierreExitoMsg(null);
    const body: Record<string, unknown> = {
      sucursal_id: sucursalId,
      caja_id: cajaId.trim() || null,
      modo_periodo: modoPeriodo,
      tipo_cierre: modoPeriodo === 'sesion_apertura' ? 'diario' : tipoCierre,
      rango_desde_hora:
        modoPeriodo === 'sesion_apertura' ? null : tipoCierre === 'parcial' ? rangoDesdeHora : null,
      rango_hasta_hora:
        modoPeriodo === 'sesion_apertura' ? null : tipoCierre === 'parcial' ? rangoHastaHora : null,
    };
    if (modoPeriodo !== 'sesion_apertura') {
      body.fecha_operativa = fechaOperativa;
    }
    if (tipoCierre === 'diario') {
      if (efectivoContado === null) {
        setError('Ingresá el efectivo que contás en la gaveta para cerrar el día.');
        setSaving(false);
        return;
      }
      body.efectivo_contado = efectivoContado;
    } else if (efectivoContado !== null) {
      body.efectivo_contado = efectivoContado;
    }

    const gastosOk = compactarGastosDesdeBorrador(gastosLineas);
    if (!gastosOk.ok) {
      setError(gastosOk.error);
      setSaving(false);
      return;
    }
    if (gastosOk.items.length > 0) {
      body.gastos_items = gastosOk.items;
    }

    const res = await fetch('/api/caja/cierre-z', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo registrar el cierre');
      setSaving(false);
      return;
    }
    setSaving(false);
    setPreview(null);
    setEfectivoContado(null);
    setGastosLineas([]);
    setGastosSesion([]);
    setTotalGastosSesion(0);
    setCierreExitoMsg('El cierre de caja se registró correctamente.');
    await loadHistorial();
    await loadApertura();
  }

  async function registrarAperturaPanel() {
    if (!sucursalId) {
      setError('Elegí una sucursal antes de registrar la apertura.');
      return;
    }
    if (fondoRegistrar === null || fondoRegistrar < 0) {
      setError('Ingresá el fondo en efectivo al abrir (número ≥ 0).');
      return;
    }
    setRegAperturaBusy(true);
    setError(null);
    const res = await fetch('/api/caja/apertura', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sucursal_id: sucursalId,
        fecha_operativa: fechaOperativa,
        caja_id: cajaId.trim() || null,
        fondo_efectivo: fondoRegistrar,
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo registrar la apertura');
      setRegAperturaBusy(false);
      return;
    }
    setFondoRegistrar(null);
    setRegAperturaBusy(false);
    await loadApertura();
    await loadHistorial();
    if (modoPeriodo === 'sesion_apertura') void consultarMovimientos();
  }

  async function toggleDetalleCierre(cierreId: string) {
    if (detalleCierreId === cierreId) {
      setDetalleCierreId(null);
      setDetalleCierre(null);
      setDetalleCierreError(null);
      return;
    }
    if (!sucursalId) {
      setDetalleCierreError('Elegí una sucursal para ver el detalle del cierre.');
      return;
    }
    setDetalleCierreId(cierreId);
    setDetalleCierre(null);
    setDetalleCierreError(null);
    setDetalleCierreLoading(true);
    const qs = new URLSearchParams();
    qs.set('sucursal_id', sucursalId);
    const res = await fetch(`/api/caja/cierre-z/${encodeURIComponent(cierreId)}/resumen?${qs.toString()}`, {
      cache: 'no-store',
    });
    const json = (await res.json()) as DetalleCierreCaja & { error?: string };
    if (!res.ok) {
      setDetalleCierreError(json.error ?? 'No se pudo cargar el resumen del cierre');
      setDetalleCierre(null);
    } else {
      setDetalleCierre(json);
    }
    setDetalleCierreLoading(false);
  }

  function generarPdf() {
    const cierresDia = eventos.filter((e): e is Extract<EventoHistorialCaja, { tipo: 'cierre' }> => e.tipo === 'cierre');
    const aperturasDia = eventos.filter((e): e is Extract<EventoHistorialCaja, { tipo: 'apertura' }> => e.tipo === 'apertura');
    if (cierresDia.length === 0 && aperturasDia.length === 0) return;
    const filas = cierresDia.map((c) => {
      const medios =
        c.medios?.map((m) => `${m.metodo_pago}: ${formatCurrency(Number(m.monto_neto))}`).join(' · ') ?? '—';
      const mediosCorto = medios.length > 52 ? `${medios.slice(0, 50)}…` : medios;
      const arq = c.payload_resumen?.arqueo_efectivo;
      const refEsperado =
        arq?.esperado_ajustado ?? arq?.esperado ?? arq?.esperado_sistema ?? null;
      const arqueoTxt = arq && refEsperado !== null
        ? `arq ${formatCurrency(arq.contado)} vs ${formatCurrency(refEsperado)}`
        : '—';
      return [
        c.tipo_cierre === 'parcial' ? 'Parcial' : 'Final',
        formatDate(c.fecha_operativa),
        c.caja_id === '__sin_caja__' ? 'Sin caja' : c.caja_id.slice(0, 16),
        String(c.total_comprobantes),
        formatCurrency(Number(c.ventas_brutas)),
        formatCurrency(Number(c.notas_credito_total)),
        formatCurrency(Number(c.ventas_netas)),
        formatCurrency(Number(c.pagos_cta_cte_total)),
        arqueoTxt,
        mediosCorto,
      ];
    });
    const lineasAperturas =
      aperturasDia.length > 0
        ? `Aperturas del día: ${aperturasDia.map((a) => `${formatCurrency(a.fondo_efectivo)} (${formatHoraAR(a.at)})`).join(' · ')}`
        : null;
    descargarPdfTabla({
      nombreArchivo: nombrePdfReporte(`caja-${fechaOperativa}`),
      titulo: 'Aperturas y cierres de caja',
      lineasMeta: [
        `Día del listado: ${fechaOperativa}`,
        cajaId.trim() ? `Caja: ${cajaId.trim()}` : 'Sin caja (filtro)',
        ...(lineasAperturas ? [lineasAperturas] : []),
      ],
      encabezados: ['Tipo', 'Fecha', 'Caja', 'Comp.', 'Bruto', 'NC', 'Neto', 'Pagos CC', 'Arqueo', 'Medios'],
      anchosMm: [14, 22, 20, 12, 20, 16, 20, 20, 26, 24],
      filas,
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[color:var(--brand-primary)]">
          <Lock className="h-6 w-6 shrink-0" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Caja</h1>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cerrá por sesión (desde la última apertura) o por franja del día: declarás el efectivo al abrir y el
          arqueo suma fondo más ventas en efectivo del período. Cada movimiento queda con fecha y hora; el listado
          de abajo podés filtrarlo por un día concreto.
        </p>
      </header>

      {contextoCajasLoading ? (
        <p className="text-sm text-muted-foreground">Cargando sucursales y cajas…</p>
      ) : null}
      {contextoCajasError ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {contextoCajasError}
        </div>
      ) : null}
      {!contextoCajasLoading && !sucursalId ? (
        <p className="text-sm text-muted-foreground">
          No hay sucursal disponible para tu usuario. Asigná una sucursal en tu perfil o pedile a un administrador.
        </p>
      ) : null}

      {puedeGestionarCajas && sucursalId ? (
        <CajasGestionCierre
          sucursalId={sucursalId}
          sucursales={sucursalesOpt}
          cajas={cajasGestion}
          usuariosOpciones={usuariosCajaOpciones}
          onActualizado={() => void loadCajaContext(sucursalId)}
        />
      ) : null}

      <section
        aria-labelledby="cierre-datos-heading"
        className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
      >
        <h2 id="cierre-datos-heading" className="text-base font-medium text-foreground">
          1. Período y caja
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-muted-foreground">Sucursal</span>
            <select
              value={sucursalId ?? ''}
              onChange={(e) => void loadCajaContext(e.target.value)}
              disabled={!sucursalesOpt.length || contextoCajasLoading}
              className="h-10 w-full max-w-xl cursor-pointer rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sucursalesOpt.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} ({s.codigo})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-muted-foreground">Día para listar / parciales</span>
            <Input type="date" value={fechaOperativa} onChange={(e) => setFechaOperativa(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-muted-foreground">Caja registrada</span>
            <select
              value={cajaSelectRegistrada}
              onChange={(e) => setCajaId(e.target.value)}
              disabled={!sucursalId}
              className="h-10 w-full max-w-xl cursor-pointer rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Otro identificador (terminal MP, POS externo, etc.)</option>
              {opcionesCajaRegistrada.map((c) => (
                <option key={c.id} value={c.id}>
                  {String(c.numero).padStart(2, '0')} — {c.nombre}
                  {!c.activa ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
          </label>
          {cajaRegistradaElegida ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Operás sobre{' '}
              <span className="font-medium text-foreground">
                {String(cajaRegistradaElegida.numero).padStart(2, '0')} — {cajaRegistradaElegida.nombre}
              </span>
              . No hace falta copiar ningún código técnico.
            </p>
          ) : (
            <label className="grid gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium text-muted-foreground">Identificador de caja (texto libre)</span>
              <Input
                value={cajaId}
                onChange={(e) => setCajaId(e.target.value)}
                placeholder={cajaIdOperativa ? `Caja detectada: ${cajaIdOperativa}` : 'UUID de caja o mismo ID que en el POS'}
                autoComplete="off"
                disabled={!sucursalId}
              />
            </label>
          )}
        </div>
        <fieldset className="grid gap-2 text-sm">
          <legend className="font-medium text-muted-foreground">Período del cierre</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="modo-periodo-panel"
                checked={modoPeriodo === 'jornada_fecha'}
                onChange={() => setModoPeriodo('jornada_fecha')}
              />
              <span>Por día y franja horaria</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="modo-periodo-panel"
                checked={modoPeriodo === 'sesion_apertura'}
                onChange={() => setModoPeriodo('sesion_apertura')}
              />
              <span>Desde última apertura (fondo + ventas hasta fin del día)</span>
            </label>
          </div>
        </fieldset>

        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm space-y-2">
          <p className="font-medium text-foreground">Apertura de caja</p>
          {aperturaVigente ? (
            <p className="text-muted-foreground">
              Sesión vigente: fondo{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {formatCurrency(aperturaVigente.fondo_efectivo)}
              </span>{' '}
              · desde{' '}
              <span className="tabular-nums text-foreground">
                {formatDateTime(aperturaVigente.opened_at)}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              Sin sesión de caja abierta (falta apertura o ya se cerró esta sesión).
              {ultimoCierreContado !== null ? (
                <>
                  {' '}
                  Último cierre (contado):{' '}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatCurrency(ultimoCierreContado)}
                  </span>{' '}
                  — referencia solamente; hoy puede quedar otro monto en gaveta.
                </>
              ) : null}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid flex-1 gap-1 text-xs">
              <span className="font-medium text-foreground">Registrar fondo al abrir</span>
              <MontoInput
                placeholder="Ej. 2.000"
                value={fondoRegistrar}
                onValueChange={setFondoRegistrar}
                min={0}
                decimals={2}
                className="h-9"
                autoComplete="off"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="cursor-pointer shrink-0"
              disabled={regAperturaBusy || !sucursalId}
              onClick={() => void registrarAperturaPanel()}
            >
              {regAperturaBusy ? 'Guardando…' : 'Guardar apertura'}
            </Button>
          </div>
        </div>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-muted-foreground">Tipo de cierre</span>
          <select
            value={tipoCierre}
            onChange={(e) => setTipoCierre(e.target.value as 'diario' | 'parcial')}
            disabled={modoPeriodo === 'sesion_apertura'}
            className="h-10 w-full max-w-md cursor-pointer rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="diario">Cierre final del día (toda la jornada)</option>
            <option value="parcial">Corte parcial (franja horaria)</option>
          </select>
        </label>
        {modoPeriodo === 'sesion_apertura' ? (
          <p className="text-xs text-muted-foreground">
            En modo “desde última apertura” el cierre es siempre el del día operativo (no hay parcial por hora).
          </p>
        ) : null}
        {tipoCierre === 'parcial' ? (
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-muted-foreground">Desde</span>
              <Input type="time" value={rangoDesdeHora} onChange={(e) => setRangoDesdeHora(e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-muted-foreground">Hasta</span>
              <Input type="time" value={rangoHastaHora} onChange={(e) => setRangoHastaHora(e.target.value)} />
            </label>
          </div>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          className="cursor-pointer gap-2"
          onClick={() => void consultarMovimientos()}
          disabled={previewLoading || !sucursalId}
        >
          <Calculator className="h-4 w-4 shrink-0" aria-hidden />
          {previewLoading ? 'Calculando…' : 'Consultar movimientos del período'}
        </Button>
      </section>

      {preview ? (
        <section
          aria-labelledby="cierre-arqueo-heading"
          className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <h2 id="cierre-arqueo-heading" className="text-base font-medium text-foreground">
            2. Totales del sistema y arqueo de efectivo
          </h2>
          <div className="grid gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Efectivo según sistema</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(preview.efectivo_esperado)}
              </p>
              {modoPeriodo === 'sesion_apertura' ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Fondo al abrir {formatCurrency(preview.fondo_apertura ?? 0)} + ventas en efectivo del período{' '}
                  {formatCurrency(preview.efectivo_ventas_periodo ?? 0)}
                  {(preview.efectivo_cobros_cc_manual ?? 0) > 0
                    ? ` + cobros efectivo desde cuenta corriente ${formatCurrency(preview.efectivo_cobros_cc_manual ?? 0)}`
                    : ''}
                  .
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Suma de tickets en efectivo y la parte en efectivo de pagos mixtos (menos notas de crédito en
                  efectivo)
                  {(preview.efectivo_cobros_cc_manual ?? 0) > 0
                    ? `, más cobros en efectivo registrados desde cuenta corriente (${formatCurrency(preview.efectivo_cobros_cc_manual ?? 0)})`
                    : ''}
                  .
                </p>
              )}
              {totalGastos > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {totalGastosSesion > 0 ? (
                    <>
                      Gastos del turno:{' '}
                      <span className="font-medium text-foreground">−{formatCurrency(totalGastosSesion)}</span>
                      <br />
                    </>
                  ) : null}
                  {totalGastosAdicionales > 0 ? (
                    <>
                      Gastos adicionales al cierre:{' '}
                      <span className="font-medium text-foreground">−{formatCurrency(totalGastosAdicionales)}</span>
                      <br />
                    </>
                  ) : null}
                  Total gastos:{' '}
                  <span className="font-medium text-foreground">−{formatCurrency(totalGastos)}</span>
                  <br />
                  Referencia para arqueo:{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatCurrency(preview.efectivo_esperado - totalGastos)}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Comprobantes:</span>{' '}
                <span className="font-medium tabular-nums">{preview.total_comprobantes}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Ventas netas:</span>{' '}
                <span className="font-medium tabular-nums">{formatCurrency(preview.ventas_netas)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">
                  Cobros cuenta cliente (sin sumar efectivo manual libre ya incluido arriba):
                </span>{' '}
                <span className="font-medium tabular-nums">{formatCurrency(preview.pagos_cta_cte_total)}</span>
              </p>
            </div>
          </div>

          {preview.medios.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Desglose por método de pago
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="Medios de pago del período">
                {preview.medios.map((m) => (
                  <li
                    key={m.metodo_pago}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs tabular-nums"
                  >
                    <span className="font-medium">{etiquetaMetodoPagoCierre(m.metodo_pago)}</span>:{' '}
                    {formatCurrency(Number(m.monto_neto))} (
                    {m.cantidad_comprobantes})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="grid gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Banknote className="h-4 w-4 text-[color:var(--brand-accent)]" aria-hidden />
              Efectivo que contás en la gaveta
            </span>
            <MontoInput
              placeholder="0,00"
              value={efectivoContado}
              onValueChange={setEfectivoContado}
              min={0}
              decimals={2}
              className="max-w-xs text-lg"
              aria-describedby="arqueo-ayuda"
            />
            <span id="arqueo-ayuda" className="text-xs text-muted-foreground">
              Contá billetes y monedas; acepta miles (1.234,56), pegado desde Excel o ticket, y montos con $.
            </span>
          </label>

          {gastosSesion.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Gastos registrados en el turno</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(totalGastosSesion)}
                </p>
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {gastosSesion.map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{g.concepto}</span>
                    <span className="shrink-0 tabular-nums text-foreground">{formatCurrency(g.monto)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <GastosCajaLineasEditor
            lineas={gastosLineas}
            onChange={setGastosLineas}
            titulo="Gastos adicionales al cierre (opcional)"
            descripcion="Solo para egresos que no registraste durante el turno en el POS."
          />

          {diferenciaPreview !== null ? (
            <p
              className={cn(
                'rounded-md border px-3 py-2 text-sm tabular-nums',
                Math.abs(diferenciaPreview) < 0.005
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100',
              )}
              role="status"
            >
              <span className="font-medium">Diferencia (contado − sistema + gastos):</span>{' '}
              {formatCurrency(diferenciaPreview)}
              {Math.abs(diferenciaPreview) < 0.005 ? ' · Cuadrado' : ' · Revisá vuelto o faltante'}
            </p>
          ) : null}

          <Button
            type="button"
            className="cursor-pointer"
            onClick={() => void confirmarCierre()}
            disabled={
              saving ||
              !sucursalId ||
              !preview ||
              !gastosCompact.ok ||
              (modoPeriodo === 'sesion_apertura' && !aperturaVigente) ||
              (tipoCierre === 'diario' && (efectivoContado === null || efectivoContado < 0))
            }
          >
            {saving ? 'Guardando cierre…' : 'Confirmar cierre de caja'}
          </Button>
        </section>
      ) : null}

      {cierreExitoMsg ? (
        <div
          className="flex gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-950 dark:text-emerald-100"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <div>
            <p className="font-semibold text-foreground">Listo</p>
            <p>{cierreExitoMsg}</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <section
        aria-labelledby="cierre-historial-heading"
        className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="cierre-historial-heading" className="text-base font-medium text-foreground">
            Historial de caja · aperturas y cierres
            <span className="block text-sm font-normal text-muted-foreground">
              Filtrado al {formatDate(fechaOperativa)} + ultimos cierres de la caja
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={() => void loadHistorial()}>
              Actualizar listado
            </Button>
            <a
              href={
                sucursalId
                  ? `/api/caja/cierre-z?fecha_operativa=${encodeURIComponent(fechaOperativa)}&sucursal_id=${encodeURIComponent(sucursalId)}${
                      cajaId.trim() ? `&caja_id=${encodeURIComponent(cajaId.trim())}` : ''
                    }&export=csv`
                  : '#'
              }
              aria-disabled={!sucursalId}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                sucursalId ? 'cursor-pointer' : 'pointer-events-none cursor-not-allowed opacity-45',
              )}
              onClick={!sucursalId ? (e) => e.preventDefault() : undefined}
            >
              Exportar CSV
            </a>
            <BotonDescargarPdf
              className="h-9"
              disabled={loading || eventos.length === 0}
              onGenerar={generarPdf}
            />
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : eventos.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>No hay aperturas ni cierres para ese día y caja.</p>
            {aperturaVigente ? (
              <p>
                Hay una sesión abierta desde{' '}
                <span className="font-medium text-foreground">
                  {formatDateTime(aperturaVigente.opened_at)}
                </span>{' '}
                (fecha operativa {formatDate(aperturaVigente.fecha_operativa)}). Si querés ver su historial,
                filtrá por esa fecha.
              </p>
            ) : null}
            {aperturaVigente && aperturaVigente.fecha_operativa !== fechaOperativa ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setFechaOperativa(aperturaVigente.fecha_operativa)}
              >
                Ver historial de la sesión abierta
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {eventos.map((ev) => {
              if (ev.tipo === 'apertura') {
                return (
                  <li
                    key={`ap-${ev.id}`}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] p-4 dark:bg-emerald-950/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 font-medium text-foreground">
                        <LockOpen className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                        Apertura de caja
                      </h3>
                      <time className="text-xs text-muted-foreground" dateTime={ev.at}>
                        {formatDateTime(ev.at)}
                      </time>
                    </div>
                    <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                      Fondo declarado:{' '}
                      <span className="font-semibold text-foreground">{formatCurrency(ev.fondo_efectivo)}</span>
                    </p>
                  </li>
                );
              }
              const c = ev;
              const arq = c.payload_resumen?.arqueo_efectivo;
              return (
                <li key={c.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium text-foreground">
                      {c.tipo_cierre === 'parcial' ? 'Parcial' : 'Cierre final'} ·{' '}
                      {c.caja_id === '__sin_caja__' ? 'Sin caja' : c.caja_id}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.reciente_fuera_fecha ? (
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-900 dark:text-sky-100">
                          Ultimo cierre
                        </span>
                      ) : null}
                      <time className="text-xs text-muted-foreground" dateTime={c.at}>
                        {formatDateTime(c.at)}
                      </time>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 cursor-pointer gap-1"
                        aria-expanded={detalleCierreId === c.id}
                        onClick={() => void toggleDetalleCierre(c.id)}
                      >
                        {detalleCierreId === c.id ? 'Ocultar' : 'Ver resumen'}
                        <ChevronDown
                          className={cn('h-3.5 w-3.5 transition-transform', detalleCierreId === c.id && 'rotate-180')}
                          aria-hidden
                        />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(c.rango_desde)} — {formatDateTime(c.rango_hasta)}
                  </p>
                  {c.reciente_fuera_fecha ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Fecha operativa: {formatDate(c.fecha_operativa)}. Se muestra porque es uno de los ultimos
                      cierres de esta caja.
                    </p>
                  ) : null}
                  {arq ? (
                    <div className="mt-2 space-y-1 text-sm tabular-nums">
                      <p>
                        <span className="text-muted-foreground">Arqueo:</span> contado{' '}
                        {formatCurrency(arq.contado)}
                        {typeof arq.fondo_apertura === 'number' &&
                        (arq.fondo_apertura > 0 || c.payload_resumen?.modo_periodo === 'sesion_apertura') ? (
                          <>
                            {' '}
                            · fondo apertura {formatCurrency(arq.fondo_apertura)}
                          </>
                        ) : null}
                        {typeof arq.efectivo_ventas_periodo === 'number' &&
                        c.payload_resumen?.modo_periodo === 'sesion_apertura' ? (
                          <>
                            {' '}
                            · ventas efectivo {formatCurrency(arq.efectivo_ventas_periodo)}
                          </>
                        ) : null}
                        {typeof arq.esperado_sistema === 'number' ? (
                          <>
                            {' '}
                            · sistema {formatCurrency(arq.esperado_sistema)}
                            {(arq.gastos_monto ?? 0) > 0 ? (
                              <>
                                {' '}
                                · gastos {formatCurrency(Number(arq.gastos_monto))}
                              </>
                            ) : null}
                            {typeof arq.esperado_ajustado === 'number' ? (
                              <>
                                {' '}
                                · referencia {formatCurrency(arq.esperado_ajustado)}
                              </>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {' '}
                            · referencia {formatCurrency(arq.esperado ?? arq.esperado_ajustado ?? 0)}
                          </>
                        )}
                        {' '}
                        · diferencia{' '}
                        <span
                          className={cn(
                            'font-medium',
                            Math.abs(arq.diferencia) < 0.005 ? 'text-emerald-600' : 'text-amber-700',
                          )}
                        >
                          {formatCurrency(arq.diferencia)}
                        </span>
                      </p>
                      {c.payload_resumen?.gastos_items && c.payload_resumen.gastos_items.length > 0 ? (
                        <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                          {c.payload_resumen.gastos_items.map((g, i) => (
                            <li key={`${c.id}-g-${i}`}>
                              {g.concepto}: {formatCurrency(Number(g.monto))}
                            </li>
                          ))}
                        </ul>
                      ) : arq.gastos_detalle ? (
                        <p className="text-xs text-muted-foreground">Gastos: {arq.gastos_detalle}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {c.payload_resumen?.modo_periodo === 'sesion_apertura' ? (
                    <p className="mt-1 text-xs text-muted-foreground">Período: desde última apertura</p>
                  ) : c.payload_resumen?.jornada ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Jornada:{' '}
                      {c.payload_resumen.jornada === 'dia_completo'
                        ? 'Todo el día'
                        : c.payload_resumen.jornada === 'manana'
                          ? 'Mañana'
                          : c.payload_resumen.jornada === 'tarde'
                            ? 'Tarde'
                            : c.payload_resumen.jornada}
                    </p>
                  ) : null}
                  {cajaInternaHabilitada && c.tipo_cierre === 'diario' ? (
                    <p className="mt-2">
                      <Link
                        href={`/tesoreria?${new URLSearchParams({
                          ...(sucursalId ? { sucursal_id: sucursalId } : {}),
                          cierre_z_id: c.id,
                        }).toString()}`}
                        className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto p-0 text-xs')}
                      >
                        Registrar retiro en tesorería
                        <ExternalLink className="ml-1 inline h-3 w-3" />
                      </Link>
                    </p>
                  ) : null}
                  <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                    <p>
                      <span className="text-muted-foreground">Neto:</span>{' '}
                      {formatCurrency(Number(c.ventas_netas))}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Comprobantes:</span> {c.total_comprobantes}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Pagos c/c:</span>{' '}
                      {formatCurrency(Number(c.pagos_cta_cte_total))}
                    </p>
                  </div>
                  {c.medios?.length ? (
                    <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Medios guardados en el cierre">
                      {c.medios.map((m) => (
                        <li key={`${c.id}-${m.metodo_pago}`} className="rounded-full border border-border px-2 py-1">
                          {m.metodo_pago}: {formatCurrency(Number(m.monto_neto))}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {detalleCierreId === c.id ? (
                    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
                      {detalleCierreLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando resumen del cierre...</p>
                      ) : detalleCierreError ? (
                        <div
                          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                          role="alert"
                        >
                          {detalleCierreError}
                        </div>
                      ) : detalleCierre ? (
                        <div className="space-y-4">
                          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Periodo</p>
                              <p className="mt-1 tabular-nums text-foreground">
                                {formatDateTime(detalleCierre.cierre.rango_desde)}
                                <br />
                                {formatDateTime(detalleCierre.cierre.rango_hasta)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Ventas netas</p>
                              <p className="mt-1 font-semibold tabular-nums text-foreground">
                                {formatCurrency(detalleCierre.cierre.ventas_netas)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Ordenes</p>
                              <p className="mt-1 font-semibold tabular-nums text-foreground">
                                {detalleCierre.ordenes.length}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Comprobantes</p>
                              <p className="mt-1 font-semibold tabular-nums text-foreground">
                                {detalleCierre.cierre.total_comprobantes}
                              </p>
                            </div>
                          </div>

                          {detalleCierre.medios.length ? (
                            <ul className="flex flex-wrap gap-2 text-xs" aria-label="Medios del resumen del cierre">
                              {detalleCierre.medios.map((m) => (
                                <li
                                  key={`${c.id}-det-${m.metodo_pago}`}
                                  className="rounded-full border border-border bg-background px-2 py-1"
                                >
                                  {etiquetaMetodoPagoCierre(m.metodo_pago)}:{' '}
                                  {formatCurrency(Number(m.monto_neto))} ({m.cantidad_comprobantes})
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {detalleCierre.ordenes.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No hay ordenes procesadas dentro del rango guardado para este cierre.
                            </p>
                          ) : (
                            <div className="overflow-x-auto rounded-md border border-border bg-background">
                              <table className="min-w-full text-sm">
                                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                                  <tr>
                                    <th className="px-3 py-2 font-medium">Hora AR</th>
                                    <th className="px-3 py-2 font-medium">Orden</th>
                                    <th className="px-3 py-2 font-medium">Cliente</th>
                                    <th className="px-3 py-2 font-medium">Pago</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 text-right font-medium">Detalle</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {detalleCierre.ordenes.map((orden) => (
                                    <tr key={orden.id}>
                                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                                        {formatDateTime(orden.created_at)}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2">
                                        <span className="font-medium">
                                          {orden.numero_orden != null ? `#${orden.numero_orden}` : orden.numero_visible}
                                        </span>
                                        <span className="ml-2 text-xs text-muted-foreground">{orden.tipo}</span>
                                      </td>
                                      <td className="px-3 py-2">{orden.cliente}</td>
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {orden.metodo_pago ? etiquetaMetodoPagoCierre(orden.metodo_pago) : 'Sin definir'}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                        {formatCurrency(Number(orden.total))}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2 text-right">
                                        <Link
                                          href={orden.url_detalle}
                                          className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                          Ver
                                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                        </Link>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
