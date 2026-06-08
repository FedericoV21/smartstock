'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

/** Fila de `/api/productos` para búsqueda de catálogo (mismo contrato que presupuestos / emitir comprobante). */
export type ProductoCatalogoApiRow = {
  id: string;
  codigo: string;
  nombre: string;
  precio_venta: number;
  precio_costo: number;
  stock_actual: number;
  iva_porcentaje?: number | null;
  porcentaje_ganancia?: number | null;
  descuento_costo_pct?: number | null;
  precio_sucursal_ganancia_aplicada?: boolean;
  precio_sucursal_manual?: boolean;
  /** Tramos de ganancia por cantidad (unidad base); mismo criterio que POS. */
  ganancia_tramos?: { cantidad_desde: number; ganancia_pct: number }[];
  es_pesable?: boolean | null;
  codigo_barras?: string | null;
  categoria?: { id: string; nombre: string } | null;
  rubro?: string | null;
  subrubro?: string | null;
  usa_variantes?: boolean;
  producto_variante_id?: string | null;
  variante?: {
    id: string;
    etiqueta?: string | null;
    codigo?: string | null;
    codigo_barras?: string | null;
  } | null;
  variantes?: Array<{
    id: string;
    etiqueta?: string | null;
    codigo?: string | null;
    codigo_barras?: string | null;
    stock_actual?: number | null;
  }>;
};

function claveCatalogoProducto(p: Pick<ProductoCatalogoApiRow, 'id' | 'producto_variante_id'>): string {
  return `${p.id}:${p.producto_variante_id ?? 'base'}`;
}

function expandirVariantesCatalogo(productos: ProductoCatalogoApiRow[]): ProductoCatalogoApiRow[] {
  const out: ProductoCatalogoApiRow[] = [];
  for (const p of productos) {
    if (p.usa_variantes && p.variantes?.length) {
      for (const v of p.variantes) {
        const etiqueta = v.etiqueta?.trim() || 'Variante';
        out.push({
          ...p,
          nombre: `${p.nombre} · ${etiqueta}`,
          codigo: v.codigo || p.codigo,
          codigo_barras: v.codigo_barras || p.codigo_barras,
          stock_actual: Number(v.stock_actual ?? 0),
          producto_variante_id: v.id,
          variante: {
            id: v.id,
            etiqueta,
            codigo: v.codigo ?? null,
            codigo_barras: v.codigo_barras ?? null,
          },
          variantes: undefined,
        });
      }
      continue;
    }
    out.push(p);
  }
  return out;
}

const TITULO_DEFAULT = 'Agregar del catálogo';
const DESCRIPCION_DEFAULT =
  'Buscá por nombre o palabra clave (también en descripción), código interno, rubro o subrubro, código de barra, o el nombre de una categoría. Podés acotar con los desplegables de categoría y proveedor. Con un proveedor elegido, solo se listan productos vinculados a ese proveedor.';

type Props = {
  onElegir: (p: ProductoCatalogoApiRow) => void;
  /** Ids que ya están cargados: filas deshabilitadas; Enter agrega el primero libre (presupuestos / facturación). */
  productoIdsBloqueados?: Iterable<string> | null;
  /**
   * Permite agregar el primer resultado libre con Enter. Desactivarlo en pantallas donde
   * el lector de barras manda Enter y la confirmacion debe ser un click explicito.
   */
  agregarPrimeroConEnter?: boolean;
  className?: string;
  titulo?: string;
  descripcion?: string;
  /**
   * Si es true, `GET /api/productos` usa `alcance=tenant`: catálogo en todas las sucursales operables
   * (mismo criterio que el listado «todo el negocio»), no solo artículos visibles en la sucursal activa.
   */
  alcanceTenant?: boolean;
  /**
   * Solo con `alcanceTenant`: pide `contexto_pedidos` para incluir **todas** las sucursales activas del tenant
   * (como un admin con «ver todas»). Útil en Pedidos para que operadores encuentren cualquier artículo del negocio.
   */
  catalogoPedidosTenantCompleto?: boolean;
};

export function BusquedaCatalogoProductos({
  onElegir,
  productoIdsBloqueados,
  agregarPrimeroConEnter = true,
  className,
  titulo = TITULO_DEFAULT,
  descripcion = DESCRIPCION_DEFAULT,
  alcanceTenant = false,
  catalogoPedidosTenantCompleto = false,
}: Props) {
  const bloqueadosSet = useMemo(() => {
    if (productoIdsBloqueados == null) return null;
    return new Set(productoIdsBloqueados);
  }, [productoIdsBloqueados]);

  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [proveedores, setProveedores] = useState<
    { id: string; nombre: string; activo?: boolean }[]
  >([]);
  const [productoQ, setProductoQ] = useState('');
  const [categoriaFiltroId, setCategoriaFiltroId] = useState('');
  const [proveedorFiltroId, setProveedorFiltroId] = useState('');
  const [productosResultado, setProductosResultado] = useState<ProductoCatalogoApiRow[]>([]);
  const [productosBuscando, setProductosBuscando] = useState(false);
  const primeraCarga = useRef(true);
  const busquedaInputRef = useRef<HTMLInputElement>(null);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const [panelOpcionesCerrado, setPanelOpcionesCerrado] = useState(false);
  const resultadosListboxId = useId();

  useEffect(() => {
    void (async () => {
      const [catRes, prRes] = await Promise.all([
        fetch('/api/categorias'),
        fetch('/api/proveedores'),
      ]);
      if (catRes.ok) {
        const j = (await catRes.json()) as { categorias?: { id: string; nombre: string }[] };
        setCategorias(j.categorias ?? []);
      }
      if (prRes.ok) {
        const j = (await prRes.json()) as {
          proveedores?: { id: string; nombre: string; activo?: boolean }[];
        };
        setProveedores(
          (j.proveedores ?? []).filter((p) => p.activo !== false),
        );
      }
    })();
  }, []);

  const buscarProductos = useCallback(async (productoQOverride?: string) => {
    setProductosBuscando(true);
    const params = new URLSearchParams();
    const q = (productoQOverride ?? productoQ).trim();
    if (q) params.set('q', q);
    if (categoriaFiltroId) params.set('categoria_id', categoriaFiltroId);
    if (proveedorFiltroId) params.set('proveedor_id', proveedorFiltroId);
    if (alcanceTenant) params.set('alcance', 'tenant');
    if (alcanceTenant && catalogoPedidosTenantCompleto) params.set('contexto_pedidos', 'true');
    params.set('incluir_variantes', 'true');
    params.set('por_pagina', '100');
    params.set('pagina', '1');
    const res = await fetch(`/api/productos?${params.toString()}`);
    const j = (await res.json()) as { productos?: ProductoCatalogoApiRow[]; error?: string };
    if (res.ok) {
      setProductosResultado(expandirVariantesCatalogo(j.productos ?? []));
    }
    setProductosBuscando(false);
  }, [productoQ, categoriaFiltroId, proveedorFiltroId, alcanceTenant, catalogoPedidosTenantCompleto]);

  const hayFiltroBusqueda = useMemo(
    () =>
      productoQ.trim() !== '' || categoriaFiltroId !== '' || proveedorFiltroId !== '',
    [productoQ, categoriaFiltroId, proveedorFiltroId],
  );
  const mostrarPanelOpciones = hayFiltroBusqueda && !panelOpcionesCerrado;

  const labelCategoriaFiltro = categoriaFiltroId
    ? (categorias.find((c) => c.id === categoriaFiltroId)?.nombre ?? 'Categoría')
    : 'Todas';
  const labelProveedorFiltro = proveedorFiltroId
    ? (proveedores.find((p) => p.id === proveedorFiltroId)?.nombre ?? 'Proveedor')
    : 'Todos';

  useEffect(() => {
    const debounce = primeraCarga.current ? 0 : 300;
    primeraCarga.current = false;
    const t = setTimeout(() => {
      void buscarProductos();
    }, debounce);
    return () => clearTimeout(t);
  }, [buscarProductos]);

  useEffect(() => {
    queueMicrotask(() => setPanelOpcionesCerrado(false));
  }, [productoQ, categoriaFiltroId, proveedorFiltroId]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const el = panelRootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      if (hayFiltroBusqueda) {
        setPanelOpcionesCerrado(true);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [hayFiltroBusqueda]);

  const lineaDeshabilitada = useCallback(
    (p: ProductoCatalogoApiRow) => {
      if (bloqueadosSet == null) return false;
      return bloqueadosSet.has(claveCatalogoProducto(p)) || bloqueadosSet.has(p.id);
    },
    [bloqueadosSet],
  );

  function onProductoSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!agregarPrimeroConEnter) {
      setPanelOpcionesCerrado(false);
      void buscarProductos(e.currentTarget.value);
      return;
    }
    if (productosBuscando || productosResultado.length === 0) return;
    const primero = productosResultado.find((p) => !lineaDeshabilitada(p));
    if (primero) {
      onElegir(primero);
      busquedaInputRef.current?.focus();
    }
  }

  return (
    <div
      ref={panelRootRef}
      className={cn('space-y-2 rounded-xl border bg-card p-4 shadow-sm', className)}
    >
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-xs text-muted-foreground">{descripcion}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative min-w-0 flex-1 space-y-1">
          <input
            ref={busquedaInputRef}
            role="combobox"
            placeholder="Buscar: nombre, código, barra, palabra clave…"
            value={productoQ}
            onChange={(e) => setProductoQ(e.target.value)}
            onFocus={() => {
              if (hayFiltroBusqueda) setPanelOpcionesCerrado(false);
            }}
            onKeyDown={onProductoSearchKeyDown}
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={mostrarPanelOpciones ? resultadosListboxId : undefined}
            aria-expanded={mostrarPanelOpciones}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {mostrarPanelOpciones ? (
            <div
              id={resultadosListboxId}
              className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg"
              role="listbox"
              aria-label="Resultados de búsqueda de productos"
            >
              {productosBuscando ? (
                <p className="px-3 py-2.5 text-sm text-muted-foreground">Buscando…</p>
              ) : productosResultado.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-muted-foreground">Sin resultados</p>
              ) : (
                productosResultado.map((p) => {
                  const barra = p.codigo_barras?.trim();
                  const cat = p.categoria?.nombre;
                  const disabledLine = lineaDeshabilitada(p);
                  return (
                    <button
                      key={claveCatalogoProducto(p)}
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
                        onElegir(p);
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
                          `Stock ${p.stock_actual}`,
                          formatCurrency(p.precio_venta),
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
          <Select
            value={categoriaFiltroId || '__todas__'}
            onValueChange={(v) => setCategoriaFiltroId(v === '__todas__' || v == null ? '' : v)}
          >
            <SelectTrigger className="h-9 w-full min-w-0 max-w-full">
              <SelectValue placeholder="Todas">{labelCategoriaFiltro}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas__">Todas</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full min-w-[11rem] space-y-1 sm:w-52">
          <p className="text-[0.7rem] text-muted-foreground">Proveedor</p>
          <Select
            value={proveedorFiltroId || '__todos__'}
            onValueChange={(v) => setProveedorFiltroId(v === '__todos__' || v == null ? '' : v)}
          >
            <SelectTrigger className="h-9 w-full min-w-0 max-w-full">
              <SelectValue placeholder="Todos">{labelProveedorFiltro}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos</SelectItem>
              {proveedores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {hayFiltroBusqueda && !productosBuscando && productosResultado.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {agregarPrimeroConEnter
            ? 'Tocá un resultado o pulsá Entrar para agregar el primero disponible.'
            : 'Tocá un resultado para agregarlo.'}
        </p>
      ) : null}
    </div>
  );
}
