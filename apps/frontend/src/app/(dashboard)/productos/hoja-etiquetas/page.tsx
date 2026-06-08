'use client';

import Link from 'next/link';
import { Download, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { BarcodeLabel } from '@/components/pos/barcode-label';
import { EtiquetaPrintGlobalStyles } from '@/components/pos/etiqueta-print-styles';
import {
  BusquedaCatalogoProductos,
  type ProductoCatalogoApiRow,
} from '@/components/productos/busqueda-catalogo-productos';
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
import { descargarHojaEtiquetasPdf, type HojaEtiquetaPdfItem } from '@/lib/pos/hoja-etiquetas-pdf';
import { cn } from '@/lib/utils';

/** Mismo criterio que otros filtros por id en la API (UUID con guiones). */
const PRODUCTO_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LabelSize = '50x30' | '80x40' | 'a4';

type LineaEtiqueta = {
  key: string;
  producto: ProductoCatalogoApiRow;
  copias: number;
};

type ProductoSinCodigoBarras = {
  id: string;
  nombre: string;
};

function productoIdsDesdeAgregarParam(searchParams: { getAll(name: string): string[] }): string[] {
  const ids = searchParams
    .getAll('agregar')
    .flatMap((raw) => raw.split(','))
    .map((raw) => raw.trim())
    .filter((raw) => PRODUCTO_ID_UUID_RE.test(raw));
  return [...new Set(ids)];
}

function mapDetalleApiToCatalogoRow(json: Record<string, unknown>): ProductoCatalogoApiRow | null {
  const id = typeof json.id === 'string' ? json.id : null;
  const codigo = typeof json.codigo === 'string' ? json.codigo : '';
  const nombre = typeof json.nombre === 'string' ? json.nombre : '';
  if (!id) return null;
  return {
    id,
    codigo,
    nombre,
    precio_venta: typeof json.precio_venta === 'number' ? json.precio_venta : 0,
    precio_costo: typeof json.precio_costo === 'number' ? json.precio_costo : 0,
    stock_actual: typeof json.stock_actual === 'number' ? json.stock_actual : 0,
    codigo_barras:
      json.codigo_barras != null && String(json.codigo_barras).trim() !== ''
        ? String(json.codigo_barras)
        : null,
    iva_porcentaje:
      typeof json.iva_porcentaje === 'number' ? json.iva_porcentaje : undefined,
    categoria:
      json.categoria && typeof json.categoria === 'object' && json.categoria !== null
        ? (json.categoria as { id: string; nombre: string })
        : null,
    rubro: typeof json.rubro === 'string' ? json.rubro : undefined,
    subrubro: typeof json.subrubro === 'string' ? json.subrubro : undefined,
    es_pesable: typeof json.es_pesable === 'boolean' ? json.es_pesable : undefined,
  };
}

function HojaEtiquetasLoading({ cantidad }: { cantidad?: number }) {
  return (
    <div
      className="print-hidden rounded-md bg-muted/50 px-4 py-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Preparando hoja de etiquetas...</p>
          <p className="text-xs text-muted-foreground">
            {cantidad && cantidad > 0
              ? `Cargando ${cantidad} producto(s) seleccionados.`
              : 'Cargando productos seleccionados.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function HojaEtiquetasInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idsAgregar = productoIdsDesdeAgregarParam(searchParams);
  const idsAgregarKey = idsAgregar.join(',');
  const { modulos, loading: modulosLoading } = useModulos();
  const [lineas, setLineas] = useState<LineaEtiqueta[]>([]);
  const [size, setSize] = useState<LabelSize>('50x30');
  const [agregarError, setAgregarError] = useState<string | null>(null);
  const [sinCodigoBarras, setSinCodigoBarras] = useState<ProductoSinCodigoBarras[]>([]);
  const [descargandoHoja, setDescargandoHoja] = useState(false);

  useEffect(() => {
    const ids = idsAgregarKey ? idsAgregarKey.split(',') : [];
    if (ids.length === 0) return;
    let cancel = false;
    const controller = new AbortController();

    void (async () => {
      const productosConBarcode: ProductoCatalogoApiRow[] = [];
      const productosSinBarcode: ProductoSinCodigoBarras[] = [];

      const productos = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/productos/${id}`, { signal: controller.signal });
            if (!res.ok) return null;
            const json = (await res.json()) as Record<string, unknown>;
            if ('error' in json && json.error) return null;
            return mapDetalleApiToCatalogoRow(json);
          } catch {
            return null;
          }
        }),
      );

      if (cancel) return;

      for (let i = 0; i < productos.length; i++) {
        const mapped = productos[i];
        if (!mapped) continue;
        if (!mapped.codigo_barras?.trim()) {
          productosSinBarcode.push({
            id: mapped.id,
            nombre: mapped.nombre || mapped.codigo || ids[i] || mapped.id,
          });
          continue;
        }
        productosConBarcode.push(mapped);
      }

      if (productosSinBarcode.length > 0) {
        const visibles = productosSinBarcode.slice(0, 4).map((p) => p.nombre).join(', ');
        setAgregarError(
          `${productosSinBarcode.length} producto(s) no se agregaron porque no tienen código de barras: ${visibles}${productosSinBarcode.length > 4 ? '...' : ''}.`,
        );
        setSinCodigoBarras(productosSinBarcode);
      } else {
        setAgregarError(null);
        setSinCodigoBarras([]);
      }

      if (productosConBarcode.length > 0) {
        setLineas((prev) => {
          const existentes = new Set(prev.map((l) => l.producto.id));
          const nuevas = productosConBarcode
            .filter((p) => !existentes.has(p.id))
            .map((producto) => ({ key: crypto.randomUUID(), producto, copias: 1 }));
          return nuevas.length > 0 ? [...prev, ...nuevas] : prev;
        });
      }
      router.replace('/productos/hoja-etiquetas', { scroll: false });
    })();
    return () => {
      cancel = true;
      controller.abort();
    };
  }, [idsAgregarKey, router]);

  const onElegirProducto = useCallback((p: ProductoCatalogoApiRow) => {
    if (!p.codigo_barras?.trim()) {
      setAgregarError(
        'Este producto no tiene código de barras. Asignalo en el detalle del producto, sección «Códigos y escaneo».',
      );
      return;
    }
    setAgregarError(null);
    setLineas((prev) => [
      ...prev,
      { key: crypto.randomUUID(), producto: p, copias: 1 },
    ]);
  }, []);

  function setCopiasLinea(key: string, n: number) {
    const v = Math.max(1, Math.min(200, n));
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, copias: v } : l)));
  }

  function quitarLinea(key: string) {
    setLineas((prev) => prev.filter((l) => l.key !== key));
  }

  function handlePrint() {
    window.print();
  }

  async function handleDescargarHoja() {
    if (descargandoHoja) return;
    const items: HojaEtiquetaPdfItem[] = lineas
      .filter((l) => l.producto.codigo_barras?.trim())
      .map((l) => ({
        id: l.producto.id,
        codigo: l.producto.codigo,
        nombre: l.producto.nombre,
        codigoBarras: l.producto.codigo_barras ?? '',
        precioVenta: l.producto.precio_venta,
        copias: l.copias,
      }));
    if (items.length === 0) return;

    setDescargandoHoja(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      descargarHojaEtiquetasPdf(items, size);
    } finally {
      setDescargandoHoja(false);
    }
  }

  if (modulosLoading) {
    return (
      <div className="p-4">
        <HojaEtiquetasLoading />
      </div>
    );
  }

  if (!modulos.facturador_pos) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <Link href="/productos" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          ← Productos
        </Link>
        <p className="text-sm text-destructive">
          El módulo POS no está habilitado para tu plan. Contactá al soporte para activarlo.
        </p>
      </div>
    );
  }

  const filasImpresion: { lineKey: string; prod: ProductoCatalogoApiRow; idx: number }[] = [];
  for (const l of lineas) {
    if (!l.producto.codigo_barras?.trim()) continue;
    for (let i = 0; i < l.copias; i++) {
      filasImpresion.push({ lineKey: l.key, prod: l.producto, idx: i });
    }
  }

  const sizeMm: '50x30' | '80x40' = size === 'a4' ? '50x30' : size;
  const mostrandoCargaAgregados = idsAgregar.length > 0;

  return (
    <>
      <EtiquetaPrintGlobalStyles printZoneId="print-zone" />

      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 print-hidden">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/productos" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              ← Productos
            </Link>
            <h1 className="text-xl font-semibold">Hoja de etiquetas</h1>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm print-hidden space-y-4">
          <BusquedaCatalogoProductos
            onElegir={onElegirProducto}
            alcanceTenant
            titulo="Agregar producto a la hoja"
            descripcion="Buscás en el catálogo de todo el negocio (mismas sucursales operables que el listado con alcance tenant). Solo se pueden imprimir ítems con código de barras."
          />
          {agregarError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
              <p>{agregarError}</p>
              {sinCodigoBarras.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {sinCodigoBarras.map((p) => (
                    <Link
                      key={p.id}
                      href={`/productos/${p.id}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'bg-background')}
                    >
                      Cargar código: {p.nombre}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {mostrandoCargaAgregados ? <HojaEtiquetasLoading cantidad={idsAgregar.length} /> : null}

          <div className="flex flex-wrap items-end gap-4 border-t pt-4">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Tamaño</span>
              <Select value={size} onValueChange={(v) => setSize(v as LabelSize)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50x30">50×30 mm</SelectItem>
                  <SelectItem value="80x40">80×40 mm</SelectItem>
                  <SelectItem value="a4">A4 (grilla)</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <Button
              type="button"
              onClick={handlePrint}
              disabled={filasImpresion.length === 0 || mostrandoCargaAgregados}
            >
              {mostrandoCargaAgregados ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Cargando
                </>
              ) : (
                'Imprimir'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleDescargarHoja()}
              disabled={filasImpresion.length === 0 || mostrandoCargaAgregados || descargandoHoja}
            >
              {descargandoHoja ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Generando
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Descargar hoja
                </>
              )}
            </Button>
          </div>
        </div>

        {lineas.length > 0 ? (
          <div className="rounded-xl border bg-card p-4 shadow-sm print-hidden">
            <h2 className="text-sm font-medium mb-3">En esta hoja ({lineas.length} línea(s))</h2>
            <div className="max-h-[280px] overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground sticky top-0 bg-card">
                    <th className="px-3 py-2 font-medium">Producto</th>
                    <th className="px-3 py-2 font-medium">Código de barras</th>
                    <th className="px-3 py-2 text-right font-medium w-28">Copias</th>
                    <th className="px-3 py-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.key} className="border-b last:border-0">
                      <td className="px-3 py-2">{l.producto.nombre}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {l.producto.codigo_barras ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={l.copias}
                          onChange={(e) =>
                            setCopiasLinea(l.key, parseInt(e.target.value) || 1)
                          }
                          className="w-20 ml-auto text-right"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => quitarLinea(l.key)}
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Total a imprimir: {filasImpresion.length} etiqueta(s)
            </p>
          </div>
        ) : !mostrandoCargaAgregados ? (
          <p className="text-sm text-muted-foreground print-hidden">
            Agregá productos con el buscador para armar la hoja.
          </p>
        ) : null}

        <div
          id="print-zone"
          className="rounded-xl border bg-card p-4 shadow-sm print:border-0 print:shadow-none print:p-0"
        >
          <h2 className="text-sm font-medium mb-3 print-hidden">Vista previa</h2>
          {!mostrandoCargaAgregados && filasImpresion.length === 0 ? (
            <p className="text-sm text-muted-foreground print-hidden">
              No hay etiquetas para mostrar. Agregá productos con código de barras.
            </p>
          ) : !mostrandoCargaAgregados ? (
            <div
              className={cn(
                'flex flex-wrap gap-2 print:gap-0',
                size === 'a4' && 'grid grid-cols-4 gap-1 print:grid-cols-4',
              )}
            >
              {filasImpresion.map(({ lineKey, prod, idx }) => (
                <div key={`${lineKey}-${idx}`} className="print-label">
                  <BarcodeLabel
                    nombre={prod.nombre}
                    codigo={prod.codigo_barras!}
                    precio={prod.precio_venta}
                    sku={prod.codigo}
                    sizeMm={sizeMm}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function HojaEtiquetasPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <HojaEtiquetasLoading />
        </div>
      }
    >
      <HojaEtiquetasInner />
    </Suspense>
  );
}
