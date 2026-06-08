'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { PromocionTipo, RangoVolumen } from '@/types/promociones';
import { PROMOCION_TIPO_LABELS } from '@/types/promociones';

const TIPOS: PromocionTipo[] = [
  'porcentaje_off',
  'n_x_m',
  'porcentaje_unidad_n',
  'descuento_volumen',
  'combo_precio_fijo',
];

const DIAS: { n: number; label: string }[] = [
  { n: 1, label: 'Lun' },
  { n: 2, label: 'Mar' },
  { n: 3, label: 'Mié' },
  { n: 4, label: 'Jue' },
  { n: 5, label: 'Vie' },
  { n: 6, label: 'Sáb' },
  { n: 7, label: 'Dom' },
];

export type ComboLinea = {
  producto_id: string;
  producto_variante_id?: string | null;
  variante_etiqueta?: string | null;
  cantidad: number;
  nombre: string;
  codigo: string;
};

export type PromocionFormInitial = {
  nombre: string;
  tipo: PromocionTipo;
  siempre_vigente: boolean;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
  cantidad_lleva: number | null;
  cantidad_paga: number | null;
  unidad_descuento: number | null;
  porcentaje: number | null;
  cantidad_minima: number | null;
  rangos_volumen: RangoVolumen[] | null;
  precio_combo: number | null;
  combo_items: ComboLinea[];
  sucursal_ids?: string[];
  productos: { id: string; nombre: string; codigo: string; producto_variante_id?: string | null; variante_etiqueta?: string | null }[];
};

type Conflicto = {
  producto_id: string;
  producto_variante_id?: string | null;
  promocion_existente: { id: string; nombre: string };
};

type ProductoHit = { id: string; nombre: string; codigo: string; producto_variante_id?: string | null; variante_etiqueta?: string | null };

type SucursalOption = {
  id: string;
  codigo?: string | null;
  nombre?: string | null;
  activa?: boolean | null;
  es_principal?: boolean | null;
};

function claveProductoPromo(p: { id?: string; producto_id?: string; producto_variante_id?: string | null }): string {
  return `${p.id ?? p.producto_id}:${p.producto_variante_id ?? 'base'}`;
}

function expandirProductosPromo(rows: Array<ProductoHit & {
  usa_variantes?: boolean;
  variantes?: Array<{ id: string; etiqueta?: string | null; codigo?: string | null; codigo_barras?: string | null }>;
}>): ProductoHit[] {
  const out: ProductoHit[] = [];
  for (const row of rows) {
    if (row.usa_variantes && row.variantes?.length) {
      for (const v of row.variantes) {
        const etiqueta = v.etiqueta?.trim() || 'Variante';
        out.push({
          id: row.id,
          producto_variante_id: v.id,
          variante_etiqueta: etiqueta,
          nombre: `${row.nombre} · ${etiqueta}`,
          codigo: v.codigo || row.codigo,
        });
      }
      continue;
    }
    out.push(row);
  }
  return out;
}

function ymdSlice(s: string | null | undefined): string {
  if (!s) return '';
  return s.slice(0, 10);
}

function rangosDefault(): RangoVolumen[] {
  return [
    { cantidad_desde: 1, cantidad_hasta: 6, porcentaje: 10 },
    { cantidad_desde: 7, cantidad_hasta: null, porcentaje: 15 },
  ];
}

const MIN_CANT_COMBO_UI = 1e-5;

/** Misma convención que el servidor (kg/con gramos grandes / raciones decimales). */
function comboCantidadDesdeInput(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '' || t === '-') return null;
  const v = parseFloat(t);
  if (!Number.isFinite(v) || v <= 0) return null;
  const r = Math.round(v * 1e6) / 1e6;
  return r >= MIN_CANT_COMBO_UI ? r : null;
}

export function PromocionForm({
  promocionId,
  initial,
  cancelHref,
}: {
  promocionId?: string;
  initial?: PromocionFormInitial | null;
  cancelHref: string;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<PromocionTipo>('porcentaje_off');
  const [siempreVigente, setSiempreVigente] = useState(true);
  const [vigenteDesde, setVigenteDesde] = useState('');
  const [vigenteHasta, setVigenteHasta] = useState('');
  const [diasMode, setDiasMode] = useState<'all' | 'some'>('all');
  const [diasSelected, setDiasSelected] = useState<Set<number>>(new Set());
  const [porcentaje, setPorcentaje] = useState('10');
  const [cantidadLleva, setCantidadLleva] = useState('3');
  const [cantidadPaga, setCantidadPaga] = useState('2');
  const [unidadDescuento, setUnidadDescuento] = useState('3');
  const [cantidadMinima, setCantidadMinima] = useState('3');
  const [volumenModo, setVolumenModo] = useState<'clasico' | 'rangos'>('clasico');
  const [rangosVolumen, setRangosVolumen] = useState<RangoVolumen[]>(() => rangosDefault());
  const [precioCombo, setPrecioCombo] = useState('0');
  const [comboLineas, setComboLineas] = useState<ComboLinea[]>([]);
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [sucursalesLoading, setSucursalesLoading] = useState(true);
  const [sucursalIds, setSucursalIds] = useState<Set<string>>(new Set());
  const [selectedProductos, setSelectedProductos] = useState<ProductoHit[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [proveedorId, setProveedorId] = useState<string>('');
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [searchResults, setSearchResults] = useState<ProductoHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictos, setConflictos] = useState<Conflicto[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSucursalesLoading(true);
        const [rc, rp, rs] = await Promise.all([
          fetch('/api/categorias?contexto_promociones=1'),
          fetch('/api/proveedores?contexto_promociones=1'),
          fetch('/api/configuracion/sucursal-activa'),
        ]);
        const jc = await rc.json();
        const jp = await rp.json();
        const js = await rs.json();
        if (rc.ok) setCategorias((jc.categorias ?? []) as { id: string; nombre: string }[]);
        if (rp.ok) setProveedores((jp.proveedores ?? []) as { id: string; nombre: string }[]);
        if (rs.ok) {
          const rows = ((js.sucursales ?? []) as SucursalOption[]).filter((s) => s.activa !== false);
          setSucursales(rows);
          if (!initial) {
            const def = typeof js.sucursal_default_id === 'string' ? js.sucursal_default_id : '';
            const defaultId = rows.some((s) => s.id === def) ? def : rows[0]?.id;
            if (defaultId) {
              setSucursalIds((prev) => (prev.size > 0 ? prev : new Set([defaultId])));
            }
          }
        }
      } catch {
        /* listas opcionales */
      } finally {
        setSucursalesLoading(false);
      }
    })();
  }, [initial]);

  const applyInitial = useCallback((v: PromocionFormInitial) => {
    setNombre(v.nombre);
    setTipo(v.tipo);
    setSiempreVigente(v.siempre_vigente);
    setVigenteDesde(ymdSlice(v.vigente_desde));
    setVigenteHasta(ymdSlice(v.vigente_hasta));
    const ds = v.dias_semana;
    if (ds != null && ds.length > 0) {
      setDiasMode('some');
      setDiasSelected(new Set(ds));
    } else {
      setDiasMode('all');
      setDiasSelected(new Set());
    }
    setPorcentaje(v.porcentaje != null ? String(v.porcentaje) : '10');
    setCantidadLleva(v.cantidad_lleva != null ? String(v.cantidad_lleva) : '3');
    setCantidadPaga(v.cantidad_paga != null ? String(v.cantidad_paga) : '2');
    setUnidadDescuento(v.unidad_descuento != null ? String(v.unidad_descuento) : '3');
    setCantidadMinima(v.cantidad_minima != null ? String(v.cantidad_minima) : '3');
    if (v.rangos_volumen != null && v.rangos_volumen.length > 0) {
      setVolumenModo('rangos');
      setRangosVolumen(v.rangos_volumen);
    } else {
      setVolumenModo('clasico');
      setRangosVolumen(rangosDefault());
    }
    setPrecioCombo(v.precio_combo != null ? String(v.precio_combo) : '0');
    setComboLineas(v.combo_items?.length ? v.combo_items : []);
    setSucursalIds(new Set(v.sucursal_ids ?? []));
    setSelectedProductos(v.productos);
  }, []);

  useEffect(() => {
    if (initial) {
      applyInitial(initial);
    }
  }, [initial, applyInitial]);

  const searchUrl = useMemo(() => {
    const params = new URLSearchParams();
    const q = searchQ.trim();
    if (q) params.set('q', q);
    // Promociones se definen a nivel negocio: buscar en todo el catálogo del tenant.
    params.set('alcance', 'tenant');
    params.set('contexto_promociones', '1');
    params.set('incluir_variantes', 'true');
    params.set('por_pagina', '15');
    params.set('pagina', '1');
    if (categoriaId) params.set('categoria_id', categoriaId);
    if (proveedorId) params.set('proveedor_id', proveedorId);
    return `/api/productos?${params.toString()}`;
  }, [searchQ, categoriaId, proveedorId]);

  const categoriaLabel = useMemo(() => {
    if (!categoriaId) return 'Todas las categorías';
    return categorias.find((c) => c.id === categoriaId)?.nombre ?? 'Categoría';
  }, [categoriaId, categorias]);

  const proveedorLabel = useMemo(() => {
    if (!proveedorId) return 'Todos los proveedores';
    return proveedores.find((p) => p.id === proveedorId)?.nombre ?? 'Proveedor';
  }, [proveedorId, proveedores]);

  useEffect(() => {
    if (!searchQ.trim() && !categoriaId && !proveedorId) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(searchUrl);
          const json = await res.json();
          if (!res.ok) {
            setSearchResults([]);
            return;
          }
          const rows = (json.productos ?? []) as {
            id: string;
            nombre: string;
            codigo: string;
            usa_variantes?: boolean;
            variantes?: Array<{ id: string; etiqueta?: string | null; codigo?: string | null; codigo_barras?: string | null }>;
          }[];
          setSearchResults(expandirProductosPromo(rows));
        } finally {
          setSearchLoading(false);
        }
      })();
    }, 320);
    return () => clearTimeout(t);
  }, [searchUrl, searchQ, categoriaId, proveedorId]);

  const selectedIds = useMemo(() => new Set(selectedProductos.map((p) => claveProductoPromo(p))), [selectedProductos]);
  const comboIds = useMemo(() => new Set(comboLineas.map((c) => claveProductoPromo(c))), [comboLineas]);

  function toggleDia(n: number) {
    setDiasSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function toggleSucursal(id: string) {
    setSucursalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildPayload(reemplazar: boolean): Record<string, unknown> {
    const dias_semana =
      diasMode === 'all' ? null : [...diasSelected].sort((a, b) => a - b);
    const base: Record<string, unknown> = {
      nombre: nombre.trim(),
      tipo,
      siempre_vigente: siempreVigente,
      vigente_desde: siempreVigente ? null : vigenteDesde.trim() || null,
      vigente_hasta: siempreVigente ? null : vigenteHasta.trim() || null,
      dias_semana,
      sucursal_ids: [...sucursalIds],
      reemplazar,
    };

    if (tipo === 'combo_precio_fijo') {
      base.precio_combo = parseFloat(precioCombo);
      base.combo_items = comboLineas.map((c) => ({
        producto_id: c.producto_id,
        producto_variante_id: c.producto_variante_id ?? null,
        cantidad: Math.round(c.cantidad * 1e6) / 1e6,
      }));
      base.producto_ids = [...new Set(comboLineas.map((c) => c.producto_id))];
      base.producto_targets = comboLineas.map((c) => ({
        producto_id: c.producto_id,
        producto_variante_id: c.producto_variante_id ?? null,
      }));
    } else {
      base.producto_ids = selectedProductos.map((p) => p.id);
      base.producto_targets = selectedProductos.map((p) => ({
        producto_id: p.id,
        producto_variante_id: p.producto_variante_id ?? null,
      }));
    }

    if (tipo === 'porcentaje_off') {
      base.porcentaje = parseFloat(porcentaje);
    } else if (tipo === 'n_x_m') {
      base.cantidad_lleva = parseInt(cantidadLleva, 10);
      base.cantidad_paga = parseInt(cantidadPaga, 10);
    } else if (tipo === 'porcentaje_unidad_n') {
      base.unidad_descuento = parseInt(unidadDescuento, 10);
      base.porcentaje = parseFloat(porcentaje);
    } else if (tipo === 'descuento_volumen') {
      if (volumenModo === 'rangos') {
        base.rangos_volumen = rangosVolumen.map((r) => ({
          cantidad_desde: r.cantidad_desde,
          cantidad_hasta: r.cantidad_hasta,
          porcentaje: r.porcentaje,
        }));
      } else {
        base.cantidad_minima = parseInt(cantidadMinima, 10);
        base.porcentaje = parseFloat(porcentaje);
      }
    }
    return base;
  }

  function validate(): string | null {
    const n = nombre.trim();
    if (n.length < 3 || n.length > 100) {
      return 'El nombre debe tener entre 3 y 100 caracteres';
    }
    if (!siempreVigente) {
      if (vigenteDesde.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde.trim())) {
        return 'Fecha «desde» inválida (usá YYYY-MM-DD)';
      }
      if (vigenteHasta.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(vigenteHasta.trim())) {
        return 'Fecha «hasta» inválida (usá YYYY-MM-DD)';
      }
    }
    if (diasMode === 'some' && diasSelected.size === 0) {
      return 'Elegí al menos un día o cambiá a «Todos los días»';
    }
    if (sucursalIds.size === 0) {
      return 'Selecciona al menos una sucursal donde aplica la promocion';
    }
    if (tipo === 'porcentaje_off') {
      const p = parseFloat(porcentaje);
      if (!Number.isFinite(p) || p <= 0 || p > 100) return 'Porcentaje inválido';
    } else if (tipo === 'n_x_m') {
      const l = parseInt(cantidadLleva, 10);
      const pa = parseInt(cantidadPaga, 10);
      if (!Number.isInteger(l) || !Number.isInteger(pa) || l <= pa || pa < 1) {
        return 'N×M: lleva y paga deben ser enteros con lleva > paga ≥ 1';
      }
    } else if (tipo === 'porcentaje_unidad_n') {
      const u = parseInt(unidadDescuento, 10);
      const p = parseFloat(porcentaje);
      if (!Number.isInteger(u) || u < 2) return 'Unidad N debe ser entero ≥ 2';
      if (!Number.isFinite(p) || p <= 0 || p > 100) return 'Porcentaje inválido';
    } else if (tipo === 'descuento_volumen') {
      if (volumenModo === 'rangos') {
        if (rangosVolumen.length < 1) return 'Agregá al menos un tramo';
        for (const r of rangosVolumen) {
          if (!Number.isInteger(r.cantidad_desde) || r.cantidad_desde < 1) {
            return 'Cada tramo: cantidad desde debe ser entero ≥ 1';
          }
          if (
            r.cantidad_hasta != null &&
            (!Number.isInteger(r.cantidad_hasta) || r.cantidad_hasta < r.cantidad_desde)
          ) {
            return 'Cantidad hasta debe ser ≥ desde (o vacío para «sin tope»)';
          }
          if (!Number.isFinite(r.porcentaje) || r.porcentaje <= 0 || r.porcentaje > 100) {
            return 'Porcentaje inválido en tramos';
          }
        }
        const sorted = [...rangosVolumen].sort((a, b) => a.cantidad_desde - b.cantidad_desde);
        let prevEnd: number | null = null;
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i];
          if (r.cantidad_hasta == null && i < sorted.length - 1) {
            return 'Sólo el último tramo puede dejarse abierto (sin tope)';
          }
          if (prevEnd != null && r.cantidad_desde <= prevEnd) {
            return 'Los tramos no deben solaparse; el siguiente debe empezar después del anterior';
          }
          prevEnd = r.cantidad_hasta;
        }
      } else {
        const m = parseInt(cantidadMinima, 10);
        const p = parseFloat(porcentaje);
        if (!Number.isInteger(m) || m < 2) return 'Cantidad mínima debe ser entero ≥ 2';
        if (!Number.isFinite(p) || p <= 0 || p > 100) return 'Porcentaje inválido';
      }
    } else if (tipo === 'combo_precio_fijo') {
      const pc = parseFloat(precioCombo);
      if (!Number.isFinite(pc) || pc <= 0) return 'Precio del combo debe ser mayor a 0';
      if (comboLineas.length < 1) return 'Agregá al menos un producto al combo';
      for (const c of comboLineas) {
        if (!Number.isFinite(c.cantidad) || !(c.cantidad >= MIN_CANT_COMBO_UI)) {
          return 'Cada línea del combo necesita cantidad mayor a 0 (unidad de venta del producto: gramos enteros o kg con decimales)';
        }
      }
    }
    return null;
  }

  async function submit(reemplazar: boolean) {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const body = buildPayload(reemplazar);
      const url = promocionId ? `/api/promociones/${promocionId}` : '/api/promociones';
      const res = await fetch(url, {
        method: promocionId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 409 && json.conflictos) {
        setConflictos(json.conflictos as Conflicto[]);
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? 'No se pudo guardar');
        setSaving(false);
        return;
      }
      setConflictos(null);
      const id = (json as { id?: string }).id ?? promocionId;
      router.push(id ? `/promociones/${id}` : '/promociones');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function addProducto(p: ProductoHit) {
    const key = claveProductoPromo(p);
    if (tipo === 'combo_precio_fijo') {
      if (comboIds.has(key)) return;
      setComboLineas((prev) => [
        ...prev,
        {
          producto_id: p.id,
          producto_variante_id: p.producto_variante_id ?? null,
          variante_etiqueta: p.variante_etiqueta ?? null,
          cantidad: 1,
          nombre: p.nombre,
          codigo: p.codigo,
        },
      ]);
    } else {
      if (selectedIds.has(key)) return;
      setSelectedProductos((prev) => [...prev, p]);
    }
    setSearchQ('');
    setSearchResults([]);
  }

  function removeProducto(id: string) {
    setSelectedProductos((prev) => prev.filter((x) => claveProductoPromo(x) !== id));
  }

  function removeComboLinea(key: string) {
    setComboLineas((prev) => prev.filter((x) => claveProductoPromo(x) !== key));
  }

  function setComboCantidad(key: string, raw: string) {
    const q = comboCantidadDesdeInput(raw);
    if (q == null) return;
    setComboLineas((prev) =>
      prev.map((x) => (claveProductoPromo(x) === key ? { ...x, cantidad: q } : x)),
    );
  }

  function addRango() {
    const last = rangosVolumen[rangosVolumen.length - 1];
    const desde = last ? (last.cantidad_hasta ?? last.cantidad_desde) + 1 : 1;
    setRangosVolumen((prev) => [
      ...prev,
      { cantidad_desde: desde, cantidad_hasta: desde + 5, porcentaje: 10 },
    ]);
  }

  function removeRango(i: number) {
    setRangosVolumen((prev) => prev.filter((_, j) => j !== i));
  }

  function updateRango(i: number, patch: Partial<RangoVolumen>) {
    setRangosVolumen((prev) =>
      prev.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  }

  function nombreConflicto(pid: string, varianteId?: string | null): string {
    const key = `${pid}:${varianteId ?? 'base'}`;
    const hit =
      selectedProductos.find((p) => claveProductoPromo(p) === key) ??
      comboLineas.find((c) => claveProductoPromo(c) === key);
    return hit ? `${hit.nombre} (${hit.codigo})` : pid.slice(0, 8) + '…';
  }

  const busquedaActiva = searchQ.trim().length > 0 || !!categoriaId || !!proveedorId;

  return (
    <div className="min-w-0 space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Nombre</span>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: 2×1 gaseosas" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Tipo</span>
            <Select value={tipo} onValueChange={(v) => v && setTipo(v as PromocionTipo)}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {PROMOCION_TIPO_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Sucursales donde aplica</span>
            {sucursalesLoading ? (
              <p className="text-xs text-muted-foreground">Cargando sucursales...</p>
            ) : sucursales.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hay sucursales disponibles.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sucursales.map((s) => {
                  const checked = sucursalIds.has(s.id);
                  const label = [s.codigo, s.nombre].filter(Boolean).join(' - ') || 'Sucursal';
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors select-none',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/25'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/70',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSucursal(s.id)}
                        className="size-3.5 rounded border-input accent-primary"
                      />
                      <span className="max-w-[14rem] truncate">{label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {tipo === 'porcentaje_off' ? (
            <label className="grid gap-1 text-sm max-w-xs">
              <span className="text-muted-foreground">% de descuento</span>
              <Input
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                value={porcentaje}
                onChange={(e) => setPorcentaje(e.target.value)}
              />
            </label>
          ) : null}

          {tipo === 'n_x_m' ? (
            <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Lleva (N)</span>
                <Input
                  type="number"
                  min={2}
                  step={1}
                  value={cantidadLleva}
                  onChange={(e) => setCantidadLleva(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Paga (M)</span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={cantidadPaga}
                  onChange={(e) => setCantidadPaga(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {tipo === 'porcentaje_unidad_n' ? (
            <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Cada N-ésima unidad (2 = 2ª, 4ª, 6ª…)</span>
                <Input
                  type="number"
                  min={2}
                  step={1}
                  value={unidadDescuento}
                  onChange={(e) => setUnidadDescuento(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">% en esas unidades</span>
                <Input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={porcentaje}
                  onChange={(e) => setPorcentaje(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {tipo === 'descuento_volumen' ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="vol_mode"
                    checked={volumenModo === 'clasico'}
                    onChange={() => setVolumenModo('clasico')}
                    className="size-4 border-input"
                  />
                  Un mínimo y un %
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="vol_mode"
                    checked={volumenModo === 'rangos'}
                    onChange={() => setVolumenModo('rangos')}
                    className="size-4 border-input"
                  />
                  Varios tramos (por rango de cantidad)
                </label>
              </div>
              {volumenModo === 'clasico' ? (
                <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Cantidad mínima (≥ 2)</span>
                    <Input
                      type="number"
                      min={2}
                      step={1}
                      value={cantidadMinima}
                      onChange={(e) => setCantidadMinima(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">% de descuento</span>
                    <Input
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={porcentaje}
                      onChange={(e) => setPorcentaje(e.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Definí cantidad desde / hasta por tramo. Dejá «hasta» vacío en el último tramo para «en
                    adelante».
                  </p>
                  <div className="space-y-2">
                    {rangosVolumen.map((r, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3 text-sm"
                      >
                        <label className="grid gap-1">
                          <span className="text-xs text-muted-foreground">Desde</span>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="w-24"
                            value={r.cantidad_desde}
                            onChange={(e) =>
                              updateRango(i, { cantidad_desde: parseInt(e.target.value, 10) || 1 })
                            }
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs text-muted-foreground">Hasta (vacío = ∞)</span>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="w-24"
                            placeholder="∞"
                            value={r.cantidad_hasta ?? ''}
                            onChange={(e) => {
                              const v = e.target.value.trim();
                              updateRango(i, {
                                cantidad_hasta: v === '' ? null : parseInt(v, 10),
                              });
                            }}
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs text-muted-foreground">%</span>
                          <Input
                            type="number"
                            min={0.01}
                            max={100}
                            step={0.01}
                            className="w-28"
                            value={r.porcentaje}
                            onChange={(e) =>
                              updateRango(i, { porcentaje: parseFloat(e.target.value) || 0 })
                            }
                          />
                        </label>
                        {rangosVolumen.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => removeRango(i)}
                          >
                            Quitar
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addRango}>
                    Agregar tramo
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {tipo === 'combo_precio_fijo' ? (
            <div className="grid gap-4 max-w-lg">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Precio del combo (total del paquete)</span>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={precioCombo}
                  onChange={(e) => setPrecioCombo(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                La cantidad es la misma unidad que usás para vender el producto: si vende por gramos, poné
                gramos enteros (ej. 350); si vende por kilo, kg con decimales (ej. 0.35).
              </p>
              {comboLineas.length > 0 ? (
                <ul className="space-y-2">
                  {comboLineas.map((c) => (
                    <li
                      key={claveProductoPromo(c)}
                      className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{c.nombre}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.codigo}</span>
                      <label className="flex items-center gap-1 text-xs">
                        Cant.
                        <Input
                          type="number"
                          min={MIN_CANT_COMBO_UI}
                          step="any"
                          inputMode="decimal"
                          className="h-8 w-28 font-mono text-xs"
                          value={c.cantidad}
                          onChange={(e) => setComboCantidad(claveProductoPromo(c), e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Quitar ${c.nombre}`}
                        onClick={() => removeComboLinea(claveProductoPromo(c))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Todavía no agregaste productos al combo.</p>
              )}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={siempreVigente}
              onChange={(e) => setSiempreVigente(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Sin tope de fechas (siempre vigente en el calendario)
          </label>

          {!siempreVigente ? (
            <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Vigente desde</span>
                <Input
                  type="date"
                  value={vigenteDesde}
                  onChange={(e) => setVigenteDesde(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Vigente hasta</span>
                <Input
                  type="date"
                  value={vigenteHasta}
                  onChange={(e) => setVigenteHasta(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Días de la semana</span>
            <p className="text-xs text-muted-foreground">
              Elegí si la promo corre todos los días o solo los que marques abajo (el resumen usa nombres
              de día claros).
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Alcance por día de la semana">
              <Button
                type="button"
                role="radio"
                aria-checked={diasMode === 'all'}
                variant={diasMode === 'all' ? 'default' : 'outline'}
                size="sm"
                className={cn(diasMode === 'all' && 'shadow-sm ring-2 ring-primary/30')}
                onClick={() => setDiasMode('all')}
              >
                Todos los días
              </Button>
              <Button
                type="button"
                role="radio"
                aria-checked={diasMode === 'some'}
                variant={diasMode === 'some' ? 'default' : 'outline'}
                size="sm"
                className={cn(diasMode === 'some' && 'shadow-sm ring-2 ring-primary/30')}
                onClick={() => setDiasMode('some')}
              >
                Solo días marcados…
              </Button>
            </div>
            {diasMode === 'some' ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {DIAS.map((d) => {
                  const on = diasSelected.has(d.n);
                  return (
                    <label
                      key={d.n}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors select-none',
                        on
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/25'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/70',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleDia(d.n)}
                        className="size-3.5 rounded border-input accent-primary"
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <span className="text-sm text-muted-foreground">
              {tipo === 'combo_precio_fijo' ? 'Productos del combo' : 'Productos incluidos'}
            </span>
            <p className="text-xs text-muted-foreground">
              Un mismo producto solo puede tener una promoción vigente a la vez; al guardar, el servidor avisa
              si hay conflicto.
            </p>
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Nombre o código…"
                className="min-w-0 sm:col-span-1"
              />
              <Select
                value={categoriaId || '__all__'}
                onValueChange={(v) => setCategoriaId(!v || v === '__all__' ? '' : v)}
              >
                <SelectTrigger className="min-w-0 w-full">
                  <SelectValue placeholder="Categoría">{categoriaLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las categorías</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={proveedorId || '__all__'}
                onValueChange={(v) => setProveedorId(!v || v === '__all__' ? '' : v)}
              >
                <SelectTrigger className="min-w-0 w-full">
                  <SelectValue placeholder="Proveedor">{proveedorLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los proveedores</SelectItem>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {searchLoading ? (
              <p className="text-xs text-muted-foreground">Buscando…</p>
            ) : busquedaActiva && searchResults.length > 0 ? (
              <ul className="max-h-40 overflow-auto rounded-md border bg-background text-sm">
                {searchResults.map((p) => {
                  const key = claveProductoPromo(p);
                  const disabled =
                    tipo === 'combo_precio_fijo' ? comboIds.has(key) : selectedIds.has(key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        disabled={disabled}
                        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/80 disabled:opacity-50"
                        onClick={() => addProducto(p)}
                      >
                        <span className="min-w-0 truncate">{p.nombre}</span>
                        <span className="font-mono text-xs text-muted-foreground">{p.codigo}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : busquedaActiva && !searchLoading ? (
              <p className="text-xs text-muted-foreground">Sin resultados.</p>
            ) : null}
            {tipo !== 'combo_precio_fijo' && selectedProductos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ninguno — la promoción no aplicará hasta agregar productos.
              </p>
            ) : null}
            {tipo !== 'combo_precio_fijo' && selectedProductos.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {selectedProductos.map((p) => (
                  <li
                    key={claveProductoPromo(p)}
                    className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="max-w-[10rem] truncate">{p.nombre}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Quitar ${p.nombre}`}
                      onClick={() => removeProducto(claveProductoPromo(p))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href={cancelHref} className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}>
          Cancelar
        </Link>
        <Button
          type="button"
          className="w-full sm:w-auto sm:min-w-[12rem]"
          disabled={saving}
          onClick={() => void submit(false)}
        >
          {saving ? 'Guardando…' : promocionId ? 'Guardar cambios' : 'Crear promoción'}
        </Button>
      </div>

      <Dialog open={conflictos != null && conflictos.length > 0} onOpenChange={(o) => !o && setConflictos(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conflicto con otra promoción</DialogTitle>
            <DialogDescription>
              Estos productos ya tienen una promoción vigente. Podés reemplazar el vínculo (la promo anterior
              dejará de aplicar a ese producto) o cancelar y ajustar la lista.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-4 text-sm">
            {(conflictos ?? []).map((c) => (
              <li key={c.producto_id}>
                <span className="font-medium">{nombreConflicto(c.producto_id, c.producto_variante_id)}</span>
                <span className="text-muted-foreground"> — {c.promocion_existente.nombre}</span>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConflictos(null)}>
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={() => {
                setConflictos(null);
                void submit(true);
              }}
            >
              Reemplazar vínculos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
