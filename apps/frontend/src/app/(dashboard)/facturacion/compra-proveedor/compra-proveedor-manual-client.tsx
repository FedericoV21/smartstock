'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { calcularVencimientoDia, proveedorTieneCondicionPagoCargada, vencimientoDefaultPersonalizado } from '@/lib/cuenta-corriente/pago-proveedor-vencimiento';
import { calcularImportes } from '@/lib/facturacion/calcular-importes';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { parsearMontoInputUsuario } from '@/lib/ui/monto-argentino';
import { formatCurrency, hoyEnAR } from '@/lib/utils/formatters';

type Proveedor = {
  id: string;
  nombre: string;
  cuit: string | null;
  activo?: boolean;
  condicion_pago_default?: 'contado' | 'dias';
  plazo_pago_dias?: number | null;
};

type PagoModoC = 'ya_pagada' | 'pendiente_condicion' | 'pendiente_fecha_custom';

type Producto = {
  id: string;
  codigo: string | null;
  nombre: string;
  precio_costo: number;
  precio_venta: number;
  iva_porcentaje?: number | null;
  codigo_barras?: string | null;
  categoria?: { id: string; nombre: string } | null;
  rubro?: string | null;
  subrubro?: string | null;
};

type LineaCatalogo = {
  kind: 'catalogo';
  producto: Producto;
  cantidad: number;
  precio_unitario: number;
};

type LineaNueva = {
  kind: 'nuevo';
  nombre: string;
  codigo: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
  unidad_factura: string;
};

type Linea = LineaCatalogo | LineaNueva;

const TIPO_OPTS = [
  { value: 'factura_a', label: 'Factura A' },
  { value: 'factura_b', label: 'Factura B' },
  { value: 'factura_c', label: 'Factura C' },
  { value: 'remito', label: 'Remito' },
] as const;

const UNIDAD_OPTS = ['unidad', 'kg', 'litro', 'metro', 'caja', 'pack', 'gramo', 'ml'];
const TOLERANCIA_IMPORTES_MANUALES = 0.02;

function montoInput(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

function parseMontoInput(v: string): number | null {
  const n = parsearMontoInputUsuario(v);
  if (n === null || n < 0) return null;
  return n;
}

/** Porcentaje de IVA (0–100+); admite coma decimal. */
function parsePorcentajeIva(v: string): number | null {
  const n = Number(v.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function CompraProveedorManualClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoQ, setProductoQ] = useState('');
  const [categoriaFiltroId, setCategoriaFiltroId] = useState('');
  const [proveedorFiltroCatalogoId, setProveedorFiltroCatalogoId] = useState('');
  const [productosBuscando, setProductosBuscando] = useState(false);
  const [ivaDefault, setIvaDefault] = useState(21);
  const primeraCargaProductos = useRef(true);
  const busquedaInputRef = useRef<HTMLInputElement>(null);
  const panelBusquedaCatalogoRef = useRef<HTMLDivElement>(null);
  const [panelOpcionesCerrado, setPanelOpcionesCerrado] = useState(false);

  const [proveedorId, setProveedorId] = useState('');
  const [nuevoProvRazon, setNuevoProvRazon] = useState('');
  const [nuevoProvCuit, setNuevoProvCuit] = useState('');

  const [tipo, setTipo] = useState<string>('factura_c');
  const [fecha, setFecha] = useState(() => hoyEnAR());
  const [puntoVenta, setPuntoVenta] = useState('');
  const [numeroDoc, setNumeroDoc] = useState('');
  const [cae, setCae] = useState('');
  const [caeVenc, setCaeVenc] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [usarImportesManuales, setUsarImportesManuales] = useState(false);
  const [subtotalManual, setSubtotalManual] = useState('');
  const [ivaPctManual, setIvaPctManual] = useState('');
  const [ivaManual, setIvaManual] = useState('');
  const [percepcionIibb, setPercepcionIibb] = useState('');
  const [percepcionIva, setPercepcionIva] = useState('');
  const [impuestoInterno, setImpuestoInterno] = useState('');
  const [totalManual, setTotalManual] = useState('');

  const [actualizarCostos, setActualizarCostos] = useState(true);
  const [afectaStock, setAfectaStock] = useState(true);
  const [afectaCC, setAfectaCC] = useState(true);
  const [pagoModo, setPagoModo] = useState<PagoModoC>('pendiente_condicion');
  const [fechaPagoYa, setFechaPagoYa] = useState(() => hoyEnAR());
  const [tipoPagoYa, setTipoPagoYa] = useState<'efectivo' | 'transferencia' | 'cheque'>('efectivo');
  const [vencCustom, setVencCustom] = useState(() => hoyEnAR());

  const load = useCallback(async () => {
    setLoading(true);
    const [prRes, catRes, perfilRes] = await Promise.all([
      fetch('/api/proveedores'),
      fetch('/api/categorias'),
      fetch('/api/perfil'),
    ]);
    if (prRes.ok) {
      const j = await prRes.json();
      setProveedores((j.proveedores ?? []).filter((p: Proveedor) => p.activo !== false));
    }
    if (catRes.ok) {
      const j = await catRes.json();
      setCategorias(j.categorias ?? []);
    }
    if (perfilRes.ok) {
      const j = await perfilRes.json();
      if (j.ivaDefault != null) setIvaDefault(Number(j.ivaDefault));
    }
    setLoading(false);
  }, []);

  const buscarProductos = useCallback(async () => {
    setProductosBuscando(true);
    const params = new URLSearchParams();
    const q = productoQ.trim();
    if (q) params.set('q', q);
    if (categoriaFiltroId) params.set('categoria_id', categoriaFiltroId);
    if (proveedorFiltroCatalogoId) params.set('proveedor_id', proveedorFiltroCatalogoId);
    // Catálogo con alcance tenant = sucursales operables del negocio (mismo criterio que otros listados «todo el negocio»).
    params.set('alcance', 'tenant');
    params.set('por_pagina', '100');
    params.set('pagina', '1');
    const res = await fetch(`/api/productos?${params.toString()}`);
    const j = (await res.json()) as { productos?: Producto[]; error?: string };
    if (res.ok) {
      setProductos(j.productos ?? []);
    }
    setProductosBuscando(false);
  }, [productoQ, categoriaFiltroId, proveedorFiltroCatalogoId]);

  const hayFiltroBusqueda = useMemo(
    () =>
      productoQ.trim() !== '' || categoriaFiltroId !== '' || proveedorFiltroCatalogoId !== '',
    [productoQ, categoriaFiltroId, proveedorFiltroCatalogoId],
  );
  const mostrarPanelOpciones = hayFiltroBusqueda && !panelOpcionesCerrado;

  useEffect(() => {
    const debounce = primeraCargaProductos.current ? 0 : 300;
    primeraCargaProductos.current = false;
    const t = setTimeout(() => {
      void buscarProductos();
    }, debounce);
    return () => clearTimeout(t);
  }, [buscarProductos]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPanelOpcionesCerrado(false);
  }, [productoQ, categoriaFiltroId, proveedorFiltroCatalogoId]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const el = panelBusquedaCatalogoRef.current;
      if (!el || el.contains(e.target as Node)) return;
      if (hayFiltroBusqueda) {
        setPanelOpcionesCerrado(true);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [hayFiltroBusqueda]);

  /** Items reales para calcularImportes (sin líneas nuevas vacías). */
  const itemsParaTotales = useMemo(() => {
    const out: { producto_id: string; cantidad: number; precio_unitario: number; iva_porcentaje?: number | null }[] =
      [];
    for (const ln of lineas) {
      if (ln.kind === 'catalogo') {
        out.push({
          producto_id: ln.producto.id,
          cantidad: ln.cantidad,
          precio_unitario: ln.precio_unitario,
          iva_porcentaje: ln.producto.iva_porcentaje ?? ivaDefault,
        });
      } else if (ln.nombre.trim()) {
        out.push({
          producto_id: `tmp-${ln.nombre}`,
          cantidad: ln.cantidad,
          precio_unitario: ln.precio_unitario,
          iva_porcentaje: ln.iva_porcentaje,
        });
      }
    }
    return out;
  }, [lineas, ivaDefault]);

  const importes = useMemo(
    () => calcularImportes(itemsParaTotales, tipo, ivaDefault, true),
    [itemsParaTotales, tipo, ivaDefault],
  );

  const importesManuales = useMemo(() => {
    if (!usarImportesManuales) return null;
    const subtotal = parseMontoInput(subtotalManual);
    const iva_monto = parseMontoInput(ivaManual);
    const total = parseMontoInput(totalManual);
    if (subtotal == null || iva_monto == null || total == null) return null;
    return { subtotal, iva_monto, total };
  }, [usarImportesManuales, subtotalManual, ivaManual, totalManual]);

  const percepcionesFactura = useMemo(() => {
    const iibb = parseMontoInput(percepcionIibb) ?? 0;
    const iva = parseMontoInput(percepcionIva) ?? 0;
    const interno = parseMontoInput(impuestoInterno) ?? 0;
    return {
      iibb,
      iva,
      interno,
      total: Math.round((iibb + iva + interno) * 100) / 100,
    };
  }, [percepcionIibb, percepcionIva, impuestoInterno]);

  const diferenciaImportesManuales = useMemo(() => {
    if (!importesManuales) return 0;
    return Math.round(
      (
        importesManuales.subtotal +
        importesManuales.iva_monto +
        percepcionesFactura.total -
        importesManuales.total
      ) * 100,
    ) / 100;
  }, [importesManuales, percepcionesFactura.total]);

  const importesFactura = useMemo(() => {
    if (!importesManuales) {
      return {
        ...importes,
        total: Math.round((importes.total + percepcionesFactura.total) * 100) / 100,
      };
    }
    const pctExplicito = parsePorcentajeIva(ivaPctManual);
    let iva_porcentaje: number;
    if (pctExplicito != null && importesManuales.subtotal > 0) {
      const ivaEsperadoPct =
        Math.round(importesManuales.subtotal * (pctExplicito / 100) * 100) / 100;
      if (
        Math.abs(ivaEsperadoPct - importesManuales.iva_monto) <= TOLERANCIA_IMPORTES_MANUALES
      ) {
        iva_porcentaje = pctExplicito;
      } else if (importesManuales.iva_monto > 0) {
        iva_porcentaje =
          Math.round((importesManuales.iva_monto * 10000) / importesManuales.subtotal) / 100;
      } else {
        iva_porcentaje = 0;
      }
    } else if (importesManuales.subtotal > 0 && importesManuales.iva_monto > 0) {
      iva_porcentaje =
        Math.round((importesManuales.iva_monto * 10000) / importesManuales.subtotal) / 100;
    } else if (importesManuales.subtotal > 0 && importesManuales.iva_monto <= 0) {
      iva_porcentaje = 0;
    } else {
      iva_porcentaje = importes.iva_porcentaje;
    }
    return {
      ...importes,
      subtotal: importesManuales.subtotal,
      iva_monto: importesManuales.iva_monto,
      iva_porcentaje,
      total: importesManuales.total,
    };
  }, [importes, importesManuales, ivaPctManual, percepcionesFactura.total]);

  const provSel = useMemo(
    () => proveedores.find((p) => p.id === proveedorId) ?? null,
    [proveedores, proveedorId],
  );

  const fechaFactYmd = useMemo(() => {
    const t = fecha.trim();
    if (t.length >= 10) return t.slice(0, 10);
    return hoyEnAR();
  }, [fecha]);

  const canUseCond = useMemo(() => {
    if (!provSel) return false;
    return proveedorTieneCondicionPagoCargada({
      condicion_pago_default: provSel.condicion_pago_default === 'dias' ? 'dias' : 'contado',
      plazo_pago_dias: provSel.plazo_pago_dias ?? null,
    });
  }, [provSel]);

  const textoVencCond = useMemo(() => {
    if (!provSel || !canUseCond) return '';
    try {
      const { vencimientoDiaYmd } = calcularVencimientoDia({
        estado: 'pendiente_condicion',
        fechaFacturaYmd: fechaFactYmd,
        proveedor: {
          condicion_pago_default: provSel.condicion_pago_default === 'dias' ? 'dias' : 'contado',
          plazo_pago_dias: provSel.plazo_pago_dias ?? null,
        },
      });
      const ar = vencimientoDiaYmd.split('-');
      const label = `${ar[2]}/${ar[1]}/${ar[0]}`;
      if (provSel.condicion_pago_default === 'dias' && provSel.plazo_pago_dias) {
        return `${provSel.nombre} · ${provSel.plazo_pago_dias} días → vence ${label}`;
      }
      return `${provSel.nombre} · contado → vence ${label}`;
    } catch {
      return '';
    }
  }, [provSel, canUseCond, fechaFactYmd]);

  const mostrarPago = afectaCC && importesFactura.total > 0;

  useEffect(() => {
    setVencCustom(vencimientoDefaultPersonalizado(fechaFactYmd, null));
  }, [fechaFactYmd]);

  useEffect(() => {
    if (!provSel) return;
    if (
      proveedorTieneCondicionPagoCargada({
        condicion_pago_default: provSel.condicion_pago_default === 'dias' ? 'dias' : 'contado',
        plazo_pago_dias: provSel.plazo_pago_dias ?? null,
      })
    ) {
      setPagoModo('pendiente_condicion');
    } else {
      setPagoModo('pendiente_fecha_custom');
    }
  }, [provSel]);

  const pagoFormOk =
    !mostrarPago ||
    (pagoModo === 'pendiente_condicion' && canUseCond) ||
    (pagoModo === 'pendiente_fecha_custom' && /^\d{4}-\d{2}-\d{2}$/.test(vencCustom)) ||
    (pagoModo === 'ya_pagada' && /^\d{4}-\d{2}-\d{2}$/.test(fechaPagoYa));

  function agregarProductoDelCatalogo(prod: Producto) {
    if (lineas.some((l) => l.kind === 'catalogo' && l.producto.id === prod.id)) return;
    const precio = prod.precio_costo > 0 ? prod.precio_costo : prod.precio_venta;
    setLineas((prev) => [
      ...prev,
      { kind: 'catalogo', producto: prod, cantidad: 1, precio_unitario: precio },
    ]);
  }

  function agregarLineaNueva() {
    setLineas((prev) => [
      ...prev,
      {
        kind: 'nuevo',
        nombre: '',
        codigo: '',
        cantidad: 1,
        precio_unitario: 0,
        iva_porcentaje: ivaDefault,
        unidad_factura: 'unidad',
      },
    ]);
  }

  function onProductoSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (productosBuscando || productos.length === 0) return;
    const primero = productos.find(
      (p) => !lineas.some((l) => l.kind === 'catalogo' && l.producto.id === p.id),
    );
    if (primero) {
      agregarProductoDelCatalogo(primero);
      busquedaInputRef.current?.focus();
    }
  }

  function actualizarLinea(i: number, patch: Partial<LineaCatalogo> | Partial<LineaNueva>) {
    setLineas((prev) => {
      const next = [...prev];
      const cur = next[i];
      if (!cur) return prev;
      next[i] = { ...cur, ...patch } as Linea;
      return next;
    });
  }

  function quitarLinea(i: number) {
    setLineas((prev) => prev.filter((_, j) => j !== i));
  }

  function recalcularTotalManualDesdePartes(
    subStr: string,
    ivaStr: string,
    iibbStr: string,
    ivaPercStr: string,
    internoStr: string,
  ) {
    const sub = parseMontoInput(subStr);
    const iva = parseMontoInput(ivaStr);
    if (sub == null || iva == null) return;
    const pIibb = parseMontoInput(iibbStr) ?? 0;
    const pIva = parseMontoInput(ivaPercStr) ?? 0;
    const interno = parseMontoInput(internoStr) ?? 0;
    setTotalManual(montoInput(sub + iva + pIibb + pIva + interno));
  }

  function recalcularIvaYTotalDesdeSubtotalYPct(subStr: string, pctStr: string) {
    const sub = parseMontoInput(subStr);
    const pct = parsePorcentajeIva(pctStr);
    if (sub == null || pct == null) return;
    const iva = Math.round((sub * (pct / 100)) * 100) / 100;
    const total = Math.round((sub + iva + percepcionesFactura.total) * 100) / 100;
    setIvaManual(montoInput(iva));
    setTotalManual(montoInput(total));
  }

  function cargarImportesCalculados() {
    setSubtotalManual(montoInput(importes.subtotal));
    setIvaManual(montoInput(importes.iva_monto));
    setTotalManual(montoInput(importes.total + percepcionesFactura.total));
    if (importes.subtotal > 0) {
      const implied =
        Math.round((importes.iva_monto * 10000) / importes.subtotal) / 100;
      setIvaPctManual(String(implied));
    } else {
      setIvaPctManual(String(ivaDefault));
    }
  }

  function cambiarImportesManuales(checked: boolean) {
    setUsarImportesManuales(checked);
    if (checked) cargarImportesCalculados();
  }

  const crearProveedorActivo = nuevoProvRazon.trim().length > 0 && nuevoProvCuit.replace(/\D/g, '').length === 11;

  async function enviar() {
    setError(null);
    if (usarImportesManuales) {
      if (!importesManuales) {
        setError('Completá subtotal sin IVA, IVA, percepciones, impuesto interno y total con importes válidos.');
        return;
      }
      if (Math.abs(diferenciaImportesManuales) > TOLERANCIA_IMPORTES_MANUALES) {
        setError('El total debe coincidir con subtotal sin IVA + IVA + percepciones + impuesto interno.');
        return;
      }
    }
    if (mostrarPago && !pagoFormOk) {
      setError('Revisá las condiciones de pago a proveedor (fecha, plazo o proveedor con condición cargada).');
      return;
    }
    if (!crearProveedorActivo && !proveedorId) {
      setError('Elegí un proveedor o completá razón social y CUIT para darlo de alta.');
      return;
    }
    if (crearProveedorActivo && proveedorId) {
      setError('Quitá el proveedor elegido o borrá los datos del alta rápido (no ambos).');
      return;
    }
    const itemsPayload: Record<string, unknown>[] = [];
    for (const ln of lineas) {
      if (ln.kind === 'catalogo') {
        itemsPayload.push({
          producto_id: ln.producto.id,
          cantidad: ln.cantidad,
          precio_unitario: ln.precio_unitario,
          precio_costo: ln.precio_unitario,
        });
      } else {
        const nom = ln.nombre.trim();
        if (!nom) continue;
        itemsPayload.push({
          crear_desde_factura: {
            nombre: nom,
            codigo: ln.codigo.trim() || null,
          },
          cantidad: ln.cantidad,
          precio_unitario: ln.precio_unitario,
          precio_costo: ln.precio_unitario,
          iva_porcentaje: ln.iva_porcentaje,
          unidad_factura: ln.unidad_factura,
        });
      }
    }
    if (itemsPayload.length === 0) {
      setError('Agregá al menos un producto o una línea con nombre.');
      return;
    }

    const pv = puntoVenta.trim() === '' ? null : Number(puntoVenta.replace(',', '.'));
    const nd = numeroDoc.trim() === '' ? null : Number(numeroDoc.replace(',', '.'));
    if (pv != null && !Number.isFinite(pv)) {
      setError('Punto de venta inválido');
      return;
    }
    if (nd != null && !Number.isFinite(nd)) {
      setError('Número de comprobante inválido');
      return;
    }

    const body: Record<string, unknown> = {
      tipo_comprobante: tipo,
      fecha: fecha.trim(),
      proveedor_id: crearProveedorActivo ? null : proveedorId || null,
      crear_proveedor: crearProveedorActivo
        ? {
            razon_social: nuevoProvRazon.trim(),
            cuit: nuevoProvCuit.replace(/\D/g, ''),
          }
        : null,
      punto_venta: pv,
      numero_documento: nd,
      cae: cae.trim() || null,
      cae_vencimiento: caeVenc.trim() || null,
      observaciones: observaciones.trim() || null,
      items: itemsPayload,
      subtotal: importesFactura.subtotal,
      iva_monto: importesFactura.iva_monto,
      percepcion_iibb_monto: percepcionesFactura.iibb,
      percepcion_iva_monto: percepcionesFactura.iva,
      impuesto_interno_monto: percepcionesFactura.interno,
      total: importesFactura.total,
      importes_manuales: usarImportesManuales,
      actualizar_costos: actualizarCostos,
      afecta_stock: afectaStock,
      afecta_cuenta_corriente: afectaCC,
      fecha_vencimiento_sugerida: null,
      pago: mostrarPago
        ? pagoModo === 'ya_pagada'
          ? { estado: 'ya_pagada', fecha_pago: fechaPagoYa, tipo_pago: tipoPagoYa }
          : pagoModo === 'pendiente_condicion'
            ? { estado: 'pendiente_condicion' }
            : { estado: 'pendiente_fecha_custom', vencimiento_at: vencCustom }
        : null,
    };

    setBusy(true);
    try {
      const res = await fetch('/api/facturacion/compra-proveedor-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'No se pudo registrar');
        return;
      }
      const id = typeof json.comprobante_id === 'string' ? json.comprobante_id : null;
      if (id) router.push(`/facturacion/${id}`);
      else router.push('/facturacion');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/facturacion"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Facturación
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compra a proveedor (manual)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registrá una factura o remito que te emitió un proveedor, con impacto opcional en stock,
          costos y cuenta corriente del proveedor — sin usar el lector de facturas.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2">
        <div className="space-y-3 sm:col-span-2">
          <p className="text-sm font-medium">Proveedor</p>
          <select
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            disabled={crearProveedorActivo}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="">— Elegir —</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.cuit ? ` · ${p.cuit}` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            O alta rápida (11 dígitos CUIT, sin guiones):
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="Razón social"
              value={nuevoProvRazon}
              onChange={(e) => setNuevoProvRazon(e.target.value)}
              disabled={!!proveedorId}
            />
            <Input
              placeholder="CUIT"
              value={nuevoProvCuit}
              onChange={(e) => setNuevoProvCuit(e.target.value)}
              disabled={!!proveedorId}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Tipo de documento</p>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            {TIPO_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Fecha del comprobante</p>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Punto de venta (proveedor)</p>
          <Input
            inputMode="numeric"
            placeholder="Ej. 0005"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Número de comprobante</p>
          <Input
            inputMode="numeric"
            placeholder="Ej. 12345678"
            value={numeroDoc}
            onChange={(e) => setNumeroDoc(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            PV y número sirven para evitar duplicados. Si los dejás vacíos, el sistema igual genera
            un registro único interno.
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">CAE (opcional)</p>
          <Input value={cae} onChange={(e) => setCae(e.target.value)} placeholder="—" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Vencimiento CAE</p>
          <Input type="date" value={caeVenc} onChange={(e) => setCaeVenc(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium">Observaciones</p>
          <Input
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Nota interna"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Agregar del catálogo</p>
            <p className="text-xs text-muted-foreground">
              Buscá en el catálogo de todo el negocio (sucursales que operás): nombre o palabra
              clave, código interno, rubro, código de barra o categoría. Podés acotar por categoría
              o, si querés, por proveedor del artículo en catálogo — independiente del proveedor del
              comprobante de arriba.
            </p>
            <div ref={panelBusquedaCatalogoRef} className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="relative min-w-0 flex-1 space-y-1">
                <Input
                  ref={busquedaInputRef}
                  placeholder="Buscar: nombre, código, barra, palabra clave…"
                  value={productoQ}
                  onChange={(e) => setProductoQ(e.target.value)}
                  onFocus={() => {
                    if (hayFiltroBusqueda) setPanelOpcionesCerrado(false);
                  }}
                  onKeyDown={onProductoSearchKeyDown}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={mostrarPanelOpciones}
                />
                {mostrarPanelOpciones ? (
                  <div
                    className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg"
                    role="listbox"
                    aria-label="Resultados de búsqueda de productos"
                  >
                    {productosBuscando ? (
                      <p className="px-3 py-2.5 text-sm text-muted-foreground">Buscando…</p>
                    ) : productos.length === 0 ? (
                      <p className="px-3 py-2.5 text-sm text-muted-foreground">Sin resultados</p>
                    ) : (
                      productos.map((p) => {
                        const barra = p.codigo_barras?.trim();
                        const cat = p.categoria?.nombre;
                        const disabledLine = lineas.some(
                          (l) => l.kind === 'catalogo' && l.producto.id === p.id,
                        );
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            disabled={disabledLine}
                            className={cn(
                              'flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0',
                              disabledLine
                                ? 'cursor-not-allowed opacity-50'
                                : 'hover:bg-muted/80',
                            )}
                            onClick={() => {
                              if (disabledLine) return;
                              agregarProductoDelCatalogo(p);
                              busquedaInputRef.current?.focus();
                            }}
                          >
                            <span className="font-medium leading-tight">{p.nombre}</span>
                            <span className="text-xs text-muted-foreground">
                              {[
                                p.codigo && `Cód. ${p.codigo}`,
                                barra && `EAN ${barra}`,
                                cat,
                                p.rubro,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
              <div className="w-full min-w-[11rem] space-y-1 sm:w-52">
                <p className="text-[0.7rem] text-muted-foreground">Categoría</p>
                <select
                  value={categoriaFiltroId}
                  onChange={(e) => setCategoriaFiltroId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">Todas</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full min-w-[11rem] space-y-1 sm:w-52">
                <p className="text-[0.7rem] text-muted-foreground">Proveedor (catálogo)</p>
                <select
                  value={proveedorFiltroCatalogoId}
                  onChange={(e) => setProveedorFiltroCatalogoId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">Todos</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              </div>
            {hayFiltroBusqueda && !productosBuscando && productos.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Tocá un resultado o pulsá Entrar para agregar el primero disponible.
              </p>
            ) : null}
            </div>
          </div>
          <Button type="button" variant="outline" onClick={agregarLineaNueva}>
            Línea nueva (sin catálogo)
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="w-24">Cant.</TableHead>
                <TableHead className="w-36 text-right">Precio costo u. (sin IVA)</TableHead>
                <TableHead className="w-28 text-right">Subt.</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Sin ítems. El precio unitario es el costo neto (sin IVA); en Factura A/B el IVA se suma
                    en el resumen según el % de cada producto o línea nueva.
                  </TableCell>
                </TableRow>
              ) : (
                lineas.map((ln, i) => {
                  const sub =
                    ln.kind === 'catalogo'
                      ? ln.cantidad * ln.precio_unitario
                      : ln.nombre.trim()
                        ? ln.cantidad * ln.precio_unitario
                        : 0;
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        {ln.kind === 'catalogo' ? (
                          <span>
                            {ln.producto.nombre}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({ln.producto.codigo || '—'})
                            </span>
                          </span>
                        ) : (
                          <div className="space-y-2">
                            <Input
                              placeholder="Nombre según factura"
                              value={ln.nombre}
                              onChange={(e) => actualizarLinea(i, { nombre: e.target.value })}
                            />
                            <div className="flex flex-wrap gap-2">
                              <Input
                                placeholder="Código (opc.)"
                                className="max-w-[140px]"
                                value={ln.codigo}
                                onChange={(e) => actualizarLinea(i, { codigo: e.target.value })}
                              />
                              <select
                                value={ln.unidad_factura}
                                onChange={(e) =>
                                  actualizarLinea(i, { unidad_factura: e.target.value })
                                }
                                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                              >
                                {UNIDAD_OPTS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                              <Input
                                type="number"
                                className="max-w-[80px]"
                                min={0}
                                step={0.01}
                                value={ln.iva_porcentaje}
                                onChange={(e) =>
                                  actualizarLinea(i, {
                                    iva_porcentaje: Number(e.target.value) || 0,
                                  })
                                }
                                title="% IVA"
                              />
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0.001}
                          step={0.001}
                          value={ln.cantidad}
                          onChange={(e) =>
                            actualizarLinea(i, { cantidad: Number(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          className="text-right"
                          value={ln.precio_unitario}
                          onChange={(e) =>
                            actualizarLinea(i, { precio_unitario: Number(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Math.round(sub * 100) / 100)}
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="sm" onClick={() => quitarLinea(i)}>
                          Quitar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t pt-3 text-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={usarImportesManuales}
                  onChange={(e) => cambiarImportesManuales(e.target.checked)}
                />
                <span>Ingresar importes de la factura</span>
              </label>
              {usarImportesManuales ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Con subtotal sin IVA y % IVA válidos, se completan IVA y total. Podés ajustar
                    IVA, percepciones, impuesto interno o total a mano si la factura redondea distinto.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Subtotal sin IVA
                      </span>
                      <Input
                        inputMode="decimal"
                        className="text-right font-mono"
                        value={subtotalManual}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSubtotalManual(v);
                          recalcularIvaYTotalDesdeSubtotalYPct(v, ivaPctManual);
                        }}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">% IVA</span>
                      <Input
                        inputMode="decimal"
                        className="text-right font-mono"
                        placeholder="Ej. 21"
                        value={ivaPctManual}
                        onChange={(e) => {
                          const v = e.target.value;
                          setIvaPctManual(v);
                          recalcularIvaYTotalDesdeSubtotalYPct(subtotalManual, v);
                        }}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">IVA</span>
                      <Input
                        inputMode="decimal"
                        className="text-right font-mono"
                        value={ivaManual}
                        onChange={(e) => {
                          const v = e.target.value;
                          setIvaManual(v);
                          recalcularTotalManualDesdePartes(
                            subtotalManual,
                            v,
                            percepcionIibb,
                            percepcionIva,
                            impuestoInterno,
                          );
                        }}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Total factura
                      </span>
                      <Input
                        inputMode="decimal"
                        className="text-right font-mono"
                        value={totalManual}
                        onChange={(e) => setTotalManual(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cargarImportesCalculados}
                    >
                      Usar calculado
                    </Button>
                    {importesManuales &&
                    Math.abs(diferenciaImportesManuales) > TOLERANCIA_IMPORTES_MANUALES ? (
                      <p className="text-xs text-amber-700">
                        Subtotal + IVA + percepciones + impuesto interno no coincide con el total.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Percepciones e impuestos opcionales
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Percep. IIBB
                    </span>
                    <Input
                      inputMode="decimal"
                      className="text-right font-mono"
                      placeholder="0,00"
                      value={percepcionIibb}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPercepcionIibb(v);
                        if (usarImportesManuales) {
                          recalcularTotalManualDesdePartes(
                            subtotalManual,
                            ivaManual,
                            v,
                            percepcionIva,
                            impuestoInterno,
                          );
                        }
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Percep. IVA
                    </span>
                    <Input
                      inputMode="decimal"
                      className="text-right font-mono"
                      placeholder="0,00"
                      value={percepcionIva}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPercepcionIva(v);
                        if (usarImportesManuales) {
                          recalcularTotalManualDesdePartes(
                            subtotalManual,
                            ivaManual,
                            percepcionIibb,
                            v,
                            impuestoInterno,
                          );
                        }
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Imp. interno
                    </span>
                    <Input
                      inputMode="decimal"
                      className="text-right font-mono"
                      placeholder="0,00"
                      value={impuestoInterno}
                      onChange={(e) => {
                        const v = e.target.value;
                        setImpuestoInterno(v);
                        if (usarImportesManuales) {
                          recalcularTotalManualDesdePartes(
                            subtotalManual,
                            ivaManual,
                            percepcionIibb,
                            percepcionIva,
                            v,
                          );
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="space-y-1 text-right">
              {usarImportesManuales || tipo === 'factura_a' || tipo === 'factura_b' ? (
                <>
                  <p>
                    Subtotal sin IVA:{' '}
                    <span className="font-mono">{formatCurrency(importesFactura.subtotal)}</span>
                  </p>
                  <p>
                    IVA:{' '}
                    <span className="font-mono">{formatCurrency(importesFactura.iva_monto)}</span>
                  </p>
                </>
              ) : null}
              {percepcionesFactura.iibb > 0 ? (
                <p>
                  Percep. IIBB:{' '}
                  <span className="font-mono">{formatCurrency(percepcionesFactura.iibb)}</span>
                </p>
              ) : null}
              {percepcionesFactura.iva > 0 ? (
                <p>
                  Percep. IVA:{' '}
                  <span className="font-mono">{formatCurrency(percepcionesFactura.iva)}</span>
                </p>
              ) : null}
              {percepcionesFactura.interno > 0 ? (
                <p>
                  Imp. interno:{' '}
                  <span className="font-mono">{formatCurrency(percepcionesFactura.interno)}</span>
                </p>
              ) : null}
              <p className="font-medium">
                Total:{' '}
                <span className="font-mono">{formatCurrency(importesFactura.total)}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={afectaStock}
            onChange={(e) => setAfectaStock(e.target.checked)}
          />
          Registrar entrada de stock por cada ítem
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={actualizarCostos}
            onChange={(e) => setActualizarCostos(e.target.checked)}
          />
          Actualizar precio de costo de los productos del catálogo con el precio de esta compra
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={afectaCC}
            onChange={(e) => setAfectaCC(e.target.checked)}
          />
          Sumar el total en cuenta corriente del proveedor
        </label>
        {mostrarPago ? (
          <div className="mt-3 w-full space-y-3 rounded-md border border-border bg-background/80 p-3">
            <p className="text-sm font-medium">Condiciones de pago</p>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1"
                name="pagoModoM"
                checked={pagoModo === 'ya_pagada'}
                onChange={() => setPagoModo('ya_pagada')}
              />
              <span>
                Ya la pagué
                {pagoModo === 'ya_pagada' ? (
                  <span className="mt-1 flex flex-wrap gap-2 text-xs">
                    <select
                      className="rounded border px-2 py-1"
                      value={tipoPagoYa}
                      onChange={(e) =>
                        setTipoPagoYa(e.target.value as 'efectivo' | 'transferencia' | 'cheque')
                      }
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="cheque">Cheque</option>
                    </select>
                    <input
                      type="date"
                      className="rounded border px-2 py-1"
                      value={fechaPagoYa}
                      onChange={(e) => setFechaPagoYa(e.target.value)}
                    />
                  </span>
                ) : null}
              </span>
            </label>
            <label
              className={cn('flex cursor-pointer items-start gap-2 text-sm', !canUseCond && 'opacity-60')}
              title={!canUseCond ? 'Cargá la condición de pago en la ficha del proveedor' : undefined}
            >
              <input
                type="radio"
                className="mt-1"
                name="pagoModoM"
                disabled={!canUseCond}
                checked={pagoModo === 'pendiente_condicion'}
                onChange={() => setPagoModo('pendiente_condicion')}
              />
              <span>
                Condición del proveedor
                {pagoModo === 'pendiente_condicion' && textoVencCond ? (
                  <p className="text-muted-foreground mt-1 text-xs">{textoVencCond}</p>
                ) : null}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1"
                name="pagoModoM"
                checked={pagoModo === 'pendiente_fecha_custom'}
                onChange={() => setPagoModo('pendiente_fecha_custom')}
              />
              <span>
                Fecha personalizada
                {pagoModo === 'pendiente_fecha_custom' ? (
                  <input
                    type="date"
                    className="ml-2 rounded border px-2 py-1 text-xs"
                    value={vencCustom}
                    onChange={(e) => setVencCustom(e.target.value)}
                  />
                ) : null}
              </span>
            </label>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void enviar()}>
          {busy ? 'Guardando…' : 'Registrar compra'}
        </Button>
        <Link
          href="/facturacion"
          className={cn(buttonVariants({ variant: 'outline' }), 'inline-flex')}
        >
          Cancelar
        </Link>
      </div>
    </div>
  );
}
