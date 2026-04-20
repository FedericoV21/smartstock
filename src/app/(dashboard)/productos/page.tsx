'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { EtiquetasLoteModal } from '@/components/pos/etiquetas-lote-modal';
import { ProductosTable, type ProductoTabla } from '@/components/stock/productos-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModulos } from '@/hooks/useModulos';
import { cn } from '@/lib/utils';

type Opt = { id: string; nombre: string };

function tryParseJson<T>(raw: string): T | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function ProductosPageInner() {
  const { canEdit } = useDashboardRole();
  const { modulos } = useModulos();
  const searchParams = useSearchParams();
  const [q, setQ] = useState('');
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [proveedorId, setProveedorId] = useState<string>('');
  const [stockBajo, setStockBajo] = useState(
    () => searchParams.get('stock_bajo') === 'true'
  );
  const [vencidos, setVencidos] = useState(
    () => searchParams.get('vencidos') === 'true'
  );
  const [pagina, setPagina] = useState(1);
  const [productos, setProductos] = useState<ProductoTabla[]>([]);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [loading, setLoading] = useState(true);
  const [categorias, setCategorias] = useState<Opt[]>([]);
  const [proveedores, setProveedores] = useState<Opt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showLoteModal, setShowLoteModal] = useState(false);

  const selectedConBarcode = useMemo(
    () => productos.filter((p) => selected.has(p.id) && p.codigo_barras),
    [productos, selected],
  );

  const loadFilters = useCallback(async () => {
    const [cRes, pRes] = await Promise.all([fetch('/api/categorias'), fetch('/api/proveedores')]);
    const [cRaw, pRaw] = await Promise.all([cRes.text(), pRes.text()]);
    const cJson = tryParseJson<{ categorias?: { id: string; nombre: string; activa: boolean }[] }>(
      cRaw
    );
    const pJson = tryParseJson<{ proveedores?: { id: string; nombre: string; activo: boolean }[] }>(
      pRaw
    );
    if (cRes.ok && cJson?.categorias) {
      setCategorias(
        cJson.categorias.filter((x) => x.activa).map((x) => ({ id: x.id, nombre: x.nombre }))
      );
    }
    if (pRes.ok && pJson?.proveedores) {
      setProveedores(
        pJson.proveedores.filter((x) => x.activo).map((x) => ({ id: x.id, nombre: x.nombre }))
      );
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (categoriaId) params.set('categoria_id', categoriaId);
      if (proveedorId) params.set('proveedor_id', proveedorId);
      if (stockBajo) params.set('stock_bajo', 'true');
      if (vencidos) params.set('vencidos', 'true');
      params.set('pagina', String(pagina));
      params.set('por_pagina', '25');
      const res = await fetch(`/api/productos?${params.toString()}`);
      const raw = await res.text();
      const json = tryParseJson<{ productos?: ProductoTabla[]; total_paginas?: number }>(raw);
      if (res.ok && json) {
        setProductos(json.productos ?? []);
        setTotalPaginas(json.total_paginas ?? 1);
      }
    } finally {
      setLoading(false);
    }
  }, [q, categoriaId, proveedorId, stockBajo, vencidos, pagina]);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPagina(1);
  }, [q, categoriaId, proveedorId, stockBajo, vencidos]);

  useEffect(() => {
    setStockBajo(searchParams.get('stock_bajo') === 'true');
    setVencidos(searchParams.get('vencidos') === 'true');
  }, [searchParams]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Buscá, filtrá por categoría o proveedor y gestioná el stock.
          </p>
        </div>
        {canEdit ? (
          <Link href="/productos/nuevo" className={cn(buttonVariants())}>
            Nuevo producto
          </Link>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-brand-sm md:flex-row md:flex-wrap md:items-end">
        <label className="grid min-w-[12rem] flex-1 gap-1 text-sm">
          <span className="text-muted-foreground">Buscar</span>
          <Input
            placeholder="Nombre, código o código de barras…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="grid min-w-[10rem] gap-1 text-sm">
          <span className="text-muted-foreground">Categoría</span>
          <Select
            value={categoriaId || '__all__'}
            onValueChange={(v) => setCategoriaId(v == null || v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-full min-w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid min-w-[10rem] gap-1 text-sm">
          <span className="text-muted-foreground">Proveedor</span>
          <Select
            value={proveedorId || '__all__'}
            onValueChange={(v) => setProveedorId(v == null || v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-full min-w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {proveedores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={stockBajo}
            onChange={(e) => setStockBajo(e.target.checked)}
            className="size-4 rounded border-input"
          />
          Solo stock bajo
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={vencidos}
            onChange={(e) => setVencidos(e.target.checked)}
            className="size-4 rounded border-input"
          />
          Vencen en 30 días
        </label>
      </div>

      {modulos.facturador_pos && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-brand-sm">
          <span className="text-sm text-muted-foreground">
            {selected.size} seleccionado(s)
          </span>
          {selectedConBarcode.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowLoteModal(true)}
            >
              Imprimir etiquetas ({selectedConBarcode.length})
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Deseleccionar
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : productos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos con esos criterios.</p>
      ) : (
        <ProductosTable
          productos={productos}
          selectable={modulos.facturador_pos}
          selected={selected}
          onSelectionChange={setSelected}
        />
      )}

      {showLoteModal && (
        <EtiquetasLoteModal
          productos={productos.filter((p) => selected.has(p.id))}
          open={showLoteModal}
          onClose={() => setShowLoteModal(false)}
        />
      )}

      {totalPaginas > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {totalPaginas}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pagina >= totalPaginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function ProductosPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Cargando productos…</p>}>
      <ProductosPageInner />
    </Suspense>
  );
}
