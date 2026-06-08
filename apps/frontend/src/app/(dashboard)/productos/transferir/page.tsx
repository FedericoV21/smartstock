'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mensajeErrorBusquedaAmigable } from '@/lib/listados/error-amigable';
import { ordenarResultadosBusquedaTransferencia } from '@/lib/listados/transferencia-productos-busqueda';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils/formatters';

type Sucursal = { id: string; codigo: string; nombre: string; activa: boolean; es_principal: boolean };

type ProductoRes = {
  id: string;
  codigo: string;
  nombre: string;
  stock_actual: number;
  unidad: string;
};

type PareoOk = {
  ok: true;
  estado: 'listo' | 'creara_deposito';
  producto: { id: string; nombre: string; codigo: string; activo: boolean };
  stock_origen: { sucursal_id: string; stock_actual: number };
  stock_destino: { sucursal_id: string; stock_actual: number };
  mensaje?: string;
};

type TransferenciaPendiente = {
  id: string;
  cantidad: number;
  motivo: string | null;
  estado: 'pendiente';
  enviado_at: string;
  producto: { id: string; codigo: string; nombre: string; unidad: string } | null;
  variante: { id: string; codigo: string | null; etiqueta: string | null; atributos: Record<string, unknown> } | null;
  sucursal_origen: { id: string; codigo: string; nombre: string } | null;
  sucursal_destino: { id: string; codigo: string; nombre: string } | null;
  usuario_envio: { nombre: string | null; apellido: string | null } | null;
};

function etiquetaVariante(v: TransferenciaPendiente['variante']) {
  if (!v) return null;
  if (v.etiqueta?.trim()) return v.etiqueta.trim();
  const attrs = v.atributos ?? {};
  const partes = ['talle', 'color', 'material', 'medida']
    .map((k) => (typeof attrs[k] === 'string' ? String(attrs[k]).trim() : ''))
    .filter(Boolean);
  return partes.length > 0 ? partes.join(' / ') : 'Variante';
}

function TransferirStockPageInner() {
  const searchParams = useSearchParams();
  const { canEdit } = useDashboardRole();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalOrigen, setSucursalOrigen] = useState<string>('');
  const [sucursalDestino, setSucursalDestino] = useState<string>('');
  const [q, setQ] = useState('');
  const [productos, setProductos] = useState<ProductoRes[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(false);
  const [errorBusquedaProductos, setErrorBusquedaProductos] = useState<string | null>(null);
  const [busquedaProductosHecha, setBusquedaProductosHecha] = useState(false);
  const [productoOrigen, setProductoOrigen] = useState<ProductoRes | null>(null);
  const [pareo, setPareo] = useState<PareoOk | null>(null);
  const [cargandoPareo, setCargandoPareo] = useState(false);
  const [cantidad, setCantidad] = useState<string>('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<TransferenciaPendiente[]>([]);
  const [cargandoPendientes, setCargandoPendientes] = useState(false);
  const [errorPendientes, setErrorPendientes] = useState<string | null>(null);
  const [recibiendoId, setRecibiendoId] = useState<string | null>(null);
  const prefillDesdeUrlHecho = useRef(false);

  const destinos = useMemo(
    () => sucursales.filter((s) => s.id !== sucursalOrigen),
    [sucursales, sucursalOrigen],
  );

  const sucursalOperativaNombre =
    sucursales.find((s) => s.id === sucursalOrigen)?.nombre ?? 'la sucursal seleccionada';

  const cargarSucursales = useCallback(async () => {
    const res = await fetch('/api/configuracion/sucursal-activa');
    const json = (await res.json()) as { sucursales?: Sucursal[]; sucursal_default_id?: string | null };
    if (!res.ok) return;
    setSucursales(json.sucursales ?? []);
    const def = json.sucursal_default_id;
    if (def && (json.sucursales ?? []).some((s) => s.id === def)) {
      setSucursalOrigen(def);
    } else if ((json.sucursales ?? []).length > 0) {
      setSucursalOrigen(json.sucursales![0]!.id);
    }
  }, []);

  useEffect(() => {
    void cargarSucursales();
  }, [cargarSucursales]);

  useEffect(() => {
    if (prefillDesdeUrlHecho.current) return;
    const productoIdParam = (searchParams.get('producto_id') ?? '').trim();
    if (!productoIdParam || sucursales.length === 0) return;

    prefillDesdeUrlHecho.current = true;
    let cancelled = false;

    void (async () => {
      const res = await fetch(`/api/productos/${productoIdParam}`);
      const j = (await res.json().catch(() => ({}))) as {
        id?: string;
        codigo?: string;
        nombre?: string;
        stock_actual?: number;
        unidad?: string;
        sucursal_id?: string;
        error?: string;
      };
      if (cancelled) return;
      if (!res.ok || !j.id || !j.sucursal_id) {
        prefillDesdeUrlHecho.current = false;
        setError(
          j.error?.includes('encontrado') || res.status === 404
            ? 'No se encontró el producto. Si pertenece a otra sucursal, activá primero esa sucursal (menú o configuración) y abrí el traslado de nuevo.'
            : (j.error ?? 'No se pudo cargar el producto desde el enlace.'),
        );
        return;
      }
      if (!sucursales.some((s) => s.id === j.sucursal_id)) {
        setError('No tenés acceso a la sucursal de ese producto.');
        prefillDesdeUrlHecho.current = false;
        return;
      }
      setSucursalOrigen(j.sucursal_id);
      setProductoOrigen({
        id: j.id,
        codigo: j.codigo ?? '',
        nombre: j.nombre ?? '',
        stock_actual: j.stock_actual ?? 0,
        unidad: j.unidad ?? 'unidad',
      });
      const busqueda = [j.nombre, j.codigo].filter(Boolean).join(' ').trim() || (j.codigo ?? '');
      setQ(busqueda);
      setPareo(null);
      setError(null);
      const otraSuc = sucursales.find((s) => s.id !== j.sucursal_id);
      if (otraSuc) {
        setSucursalDestino(otraSuc.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, sucursales]);

  const buscarProductos = useCallback(async () => {
    if (!sucursalOrigen || !q.trim()) {
      setProductos([]);
      setErrorBusquedaProductos(null);
      setBusquedaProductosHecha(false);
      return;
    }
    const term = q.trim().slice(0, 120);
    setCargandoProductos(true);
    setErrorBusquedaProductos(null);
    setBusquedaProductosHecha(true);
    const p = new URLSearchParams();
    p.set('sucursal_id', sucursalOrigen);
    p.set('q', term);
    p.set('por_pagina', '30');
    p.set('pagina', '1');
    try {
      const res = await fetch(`/api/productos?${p.toString()}`);
      const raw = await res.text();
      let json: { productos?: ProductoRes[]; error?: string } | null = null;
      try {
        json = JSON.parse(raw) as { productos?: ProductoRes[]; error?: string };
      } catch {
        json = null;
      }
      if (res.ok) {
        const ordenados = ordenarResultadosBusquedaTransferencia(json?.productos ?? [], term);
        setProductos(ordenados);
      } else {
        setProductos([]);
        setErrorBusquedaProductos(
          mensajeErrorBusquedaAmigable(
            json?.error ?? raw,
            'No se pudo buscar productos. Reintentá en unos segundos.',
            { responseStatus: res.status, terminoChars: term.length },
          ),
        );
      }
    } catch {
      setProductos([]);
      setErrorBusquedaProductos('Error de red al buscar productos. Reintentá.');
    }
    setCargandoProductos(false);
  }, [sucursalOrigen, q]);

  useEffect(() => {
    const t = setTimeout(() => void buscarProductos(), 300);
    return () => clearTimeout(t);
  }, [buscarProductos]);

  const cargarPendientes = useCallback(async () => {
    if (!sucursalOrigen) {
      setPendientes([]);
      setErrorPendientes(null);
      setCargandoPendientes(false);
      return;
    }
    setCargandoPendientes(true);
    setErrorPendientes(null);
    const params = new URLSearchParams();
    params.set('estado', 'pendientes');
    params.set('sucursal_destino_id', sucursalOrigen);
    try {
      const res = await fetch(`/api/stock/transferencia-sucursal?${params.toString()}`);
      const json = (await res.json()) as { transferencias?: TransferenciaPendiente[]; error?: string };
      if (res.ok) {
        setPendientes(json.transferencias ?? []);
      } else {
        setPendientes([]);
        setErrorPendientes(json.error ?? 'No se pudieron cargar las transferencias pendientes.');
      }
    } catch {
      setPendientes([]);
      setErrorPendientes('Error de red al cargar recepciones pendientes.');
    }
    setCargandoPendientes(false);
  }, [sucursalOrigen]);

  useEffect(() => {
    void cargarPendientes();
  }, [cargarPendientes]);

  const elegirOrigen = (p: ProductoRes) => {
    setProductoOrigen(p);
    setPareo(null);
    setOkMsg(null);
    setError(null);
  };

  const resolverPareo = useCallback(async () => {
    if (!productoOrigen || !sucursalDestino) {
      setPareo(null);
      return;
    }
    if (sucursalOrigen === sucursalDestino) {
      setPareo(null);
      return;
    }
    setCargandoPareo(true);
    setError(null);
    const p = new URLSearchParams();
    p.set('producto_id', productoOrigen.id);
    p.set('sucursal_origen_id', sucursalOrigen);
    p.set('sucursal_destino_id', sucursalDestino);
    const res = await fetch(`/api/stock/transferencia-sucursal?${p.toString()}`);
    const json = await res.json();
    if (res.ok) {
      setPareo(json as PareoOk);
    } else {
      setPareo(null);
      setError(
        (json as { error?: string }).error ??
          'No se pudo vincular el producto en la sucursal de destino.',
      );
    }
    setCargandoPareo(false);
  }, [productoOrigen, sucursalDestino, sucursalOrigen]);

  useEffect(() => {
    void resolverPareo();
  }, [resolverPareo]);

  const recibirTransferencia = async (transferenciaId: string) => {
    if (recibiendoId) return;
    setRecibiendoId(transferenciaId);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/stock/transferencia-sucursal/${transferenciaId}/recibir`, {
        method: 'POST',
      });
      const json = (await res.json()) as { error?: string; deposito_destino_creado?: boolean };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo aceptar la recepcion.');
      } else {
        setOkMsg(
          json.deposito_destino_creado
            ? 'Recepcion aceptada. Se creo el deposito en destino y se sumo el stock.'
            : 'Recepcion aceptada. El stock ya ingreso en esta sucursal.',
        );
        await cargarPendientes();
        void resolverPareo();
      }
    } catch {
      setError('Error de red al aceptar la recepcion.');
    }
    setRecibiendoId(null);
  };

  const productoOperativo = pareo?.producto?.activo ?? true;
  const listo = pareo?.estado === 'listo';
  const seCrearaDeposito = pareo?.estado === 'creara_deposito';
  const puedeEnviar =
    canEdit &&
    productoOperativo &&
    (listo || seCrearaDeposito) &&
    !enviando &&
    Number(cantidad) > 0;

  const inputHabilitado = (listo || seCrearaDeposito) && productoOperativo;

  const enviar = async () => {
    if (!pareo || !productoOrigen || !sucursalDestino) return;
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    setOkMsg(null);
    const c = Number(cantidad);
    if (c > (productoOrigen.stock_actual ?? 0)) {
      setError('La cantidad supera el stock disponible en origen.');
      setEnviando(false);
      return;
    }
    const payload: {
      producto_id: string;
      sucursal_origen_id: string;
      sucursal_destino_id: string;
      cantidad: number;
      motivo: string | null;
    } = {
      producto_id: productoOrigen.id,
      sucursal_origen_id: sucursalOrigen,
      sucursal_destino_id: sucursalDestino,
      cantidad: c,
      motivo: motivo.trim() || null,
    };
    const res = await fetch('/api/stock/transferencia-sucursal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      error?: string;
      transfer_id?: string;
    };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo enviar la transferencia.');
    } else {
      setOkMsg('Transferencia enviada. La sucursal destino debe aceptar la recepción para sumar el stock.');
      setCantidad('');
      setMotivo('');
      setPareo(null);
      setProductoOrigen({ ...productoOrigen, stock_actual: productoOrigen.stock_actual - c });
    }
    setEnviando(false);
  };

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Transferir stock</h1>
        <p className="text-sm text-muted-foreground">Necesitás permisos de edición para realizar transferencias.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transferir stock entre sucursales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Se descuenta el saldo en la sucursal de origen y queda pendiente de recepción. La sucursal
          destino tiene que aceptar el ingreso para que el stock se sume allí.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link href="/movimientos" className="text-primary hover:underline">
            Ver movimientos
          </Link>{' '}
          (referencia: transferencia entre sucursales).
        </p>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Recepciones pendientes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ingresos enviados a {sucursalOperativaNombre} que todavía no impactaron en stock.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void cargarPendientes()}
            disabled={cargandoPendientes || !sucursalOrigen}
          >
            <RefreshCw className={cn('h-4 w-4', cargandoPendientes && 'animate-spin')} />
            Actualizar
          </Button>
        </div>

        {errorPendientes ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorPendientes}
          </p>
        ) : cargandoPendientes ? (
          <p className="text-sm text-muted-foreground">Cargando recepciones…</p>
        ) : pendientes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay transferencias pendientes para esta sucursal.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {pendientes.map((t) => {
              const variante = etiquetaVariante(t.variante);
              const usuario = [t.usuario_envio?.nombre, t.usuario_envio?.apellido]
                .filter(Boolean)
                .join(' ')
                .trim();
              return (
                <li key={t.id} className="grid gap-3 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      {t.producto?.nombre ?? 'Producto'} {variante ? `· ${variante}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Desde {t.sucursal_origen?.nombre ?? 'origen'} · {formatDateTime(t.enviado_at)}
                      {usuario ? ` · Enviado por ${usuario}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cantidad {t.cantidad} {t.producto?.unidad ?? ''} · Código {t.producto?.codigo ?? '—'}
                    </p>
                    {t.motivo ? <p className="text-xs text-muted-foreground">Nota: {t.motivo}</p> : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void recibirTransferencia(t.id)}
                    disabled={recibiendoId != null}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {recibiendoId === t.id ? 'Aceptando…' : 'Aceptar recepción'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <span className="text-xs text-muted-foreground">Sucursal de origen</span>
            <Select
              value={sucursalOrigen}
              onValueChange={(v) => setSucursalOrigen(v ?? '')}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Elegir…" />
              </SelectTrigger>
              <SelectContent>
                {sucursales.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre} ({s.codigo})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Sucursal de destino</span>
            <Select
              value={sucursalDestino}
              onValueChange={(v) => {
                setSucursalDestino(v ?? '');
                setPareo(null);
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Elegir…" />
              </SelectTrigger>
              <SelectContent>
                {destinos.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre} ({s.codigo})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Buscar producto (origen)</span>
          <Input
            className="mt-1"
            placeholder="Nombre, código, código de barras…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setProductoOrigen(null);
              setPareo(null);
              setErrorBusquedaProductos(null);
              if (!e.target.value.trim()) setBusquedaProductosHecha(false);
            }}
            disabled={!sucursalOrigen}
          />
        </div>

        {cargandoProductos ? (
          <p className="text-sm text-muted-foreground">Buscando…</p>
        ) : errorBusquedaProductos ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="text-destructive">{errorBusquedaProductos}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void buscarProductos()}
            >
              Reintentar búsqueda
            </Button>
          </div>
        ) : busquedaProductosHecha && productos.length === 0 && q.trim() ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            No encontramos productos para esa búsqueda en la sucursal de origen. Probá con código, nombre
            parcial o verificá la sucursal seleccionada.
          </div>
        ) : productos.length > 0 && q.trim() ? (
          <ul className="max-h-56 divide-y overflow-auto rounded-lg border text-sm">
            {productos.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60',
                    productoOrigen?.id === p.id && 'bg-muted/80',
                  )}
                  onClick={() => elegirOrigen(p)}
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-muted-foreground">{p.codigo}</span> — {p.nombre}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">Stock: {p.stock_actual}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {productoOrigen && (
        <div className="space-y-3 rounded-xl border border-dashed bg-muted/20 p-4">
          <div>
            <p className="text-sm font-medium">Origen: {productoOrigen.nombre}</p>
            <p className="text-xs text-muted-foreground">
              Código {productoOrigen.codigo} · {productoOrigen.unidad} · stock {productoOrigen.stock_actual}
            </p>
          </div>

          {cargandoPareo && <p className="text-sm text-muted-foreground">Vinculando con destino…</p>}

          {!cargandoPareo && pareo?.estado === 'listo' && (
            <div className="rounded-lg border bg-card p-3 text-sm">
              <p className="font-medium text-emerald-800">Destino listo</p>
              <p className="text-xs text-muted-foreground">
                Stock actual en destino: {pareo.stock_destino.stock_actual} · Código {pareo.producto.codigo}
              </p>
            </div>
          )}

          {!cargandoPareo && pareo?.estado === 'creara_deposito' ? (
            <p className="text-sm text-amber-800">{pareo.mensaje}</p>
          ) : null}

          {sucursalOrigen && sucursalDestino && sucursalOrigen === sucursalDestino && (
            <p className="text-sm text-destructive">Elegí otra sucursal de destino.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-xs text-muted-foreground">Cantidad</span>
              <Input
                className="mt-1"
                type="number"
                min="0.001"
                step="0.001"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                disabled={!inputHabilitado}
              />
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Nota (opcional)</span>
              <Input
                className="mt-1"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Remito, pedido, etc."
                disabled={!inputHabilitado}
              />
            </div>
          </div>

          <Button
            type="button"
            onClick={() => void enviar()}
            disabled={!puedeEnviar}
          >
            {enviando ? 'Enviando…' : 'Enviar transferencia'}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {okMsg}
        </div>
      )}
    </div>
  );
}

export default function TransferirStockPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Cargando…</p>}>
      <TransferirStockPageInner />
    </Suspense>
  );
}
