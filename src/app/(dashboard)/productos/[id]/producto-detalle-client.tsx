'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { MovimientoRapido } from '@/components/stock/movimiento-rapido';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useModulos } from '@/hooks/useModulos';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import { formatCurrency, formatDateTime } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

type Unidad = Database['public']['Enums']['unidad_medida'];
type MovRow = {
  id: string;
  tipo: Database['public']['Enums']['tipo_movimiento'];
  cantidad: number;
  stock_anterior: number;
  stock_posterior: number;
  motivo: string | null;
  referencia_tipo: Database['public']['Enums']['referencia_tipo'] | null;
  created_at: string;
};

type ProductoDetail = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: string | null;
  proveedor_id: string | null;
  unidad: Unidad;
  precio_costo: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  comprometido?: number;
  disponible?: number;
  fecha_vencimiento: string | null;
  activo: boolean;
  codigo_barras: string | null;
  plu: string | null;
  es_pesable: boolean;
  rubro: string | null;
  subrubro: string | null;
  iva_porcentaje: number | null;
  porcentaje_ganancia: number | null;
  ubicacion: string | null;
  moneda: string;
  categoria: { id: string; nombre: string } | null;
  proveedor: { id: string; nombre: string } | null;
  movimientos: MovRow[];
};

const UNIDADES: Unidad[] = [
  'unidad',
  'kg',
  'litro',
  'metro',
  'caja',
  'pack',
  'gramo',
  'ml',
];

const UNIDADES_PESABLE: Unidad[] = ['kg', 'gramo'];

export function ProductoDetalleClient({
  productoId,
  canEdit,
  ivaDefault,
}: {
  productoId: string;
  canEdit: boolean;
  ivaDefault: number;
}) {
  const router = useRouter();
  const [data, setData] = useState<ProductoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [unidad, setUnidad] = useState<Unidad>('unidad');
  const [precioCosto, setPrecioCosto] = useState('0');
  const [precioVenta, setPrecioVenta] = useState('0');
  const [stockMinimo, setStockMinimo] = useState('0');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');
  const [plu, setPlu] = useState('');
  const [esPesable, setEsPesable] = useState(false);
  const [rubro, setRubro] = useState('');
  const [subrubro, setSubrubro] = useState('');
  const [ivaPorcentaje, setIvaPorcentaje] = useState('');
  const [porcentajeGanancia, setPorcentajeGanancia] = useState('');
  const [ubicacionField, setUbicacionField] = useState('');
  const [moneda, setMoneda] = useState('$');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeMsg, setBarcodeMsg] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const { modulos, loading: modulosLoading } = useModulos();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/productos/${productoId}`);
    const json = await res.json();
    if (!res.ok) {
      setData(null);
      setLoading(false);
      return;
    }
    const p = json as ProductoDetail;
    setData(p);
    setCodigo(p.codigo);
    setNombre(p.nombre);
    setDescripcion(p.descripcion ?? '');
    setCategoriaId(p.categoria_id ?? '');
    setProveedorId(p.proveedor_id ?? '');
    setUnidad(p.unidad);
    setPrecioCosto(String(p.precio_costo));
    setPrecioVenta(String(p.precio_venta));
    setStockMinimo(String(p.stock_minimo));
    setFechaVencimiento(p.fecha_vencimiento ? p.fecha_vencimiento.slice(0, 10) : '');
    setCodigoBarras(p.codigo_barras ?? '');
    setPlu(p.plu ?? '');
    setEsPesable(p.es_pesable ?? false);
    setRubro(p.rubro ?? '');
    setSubrubro(p.subrubro ?? '');
    setIvaPorcentaje(p.iva_porcentaje != null ? String(p.iva_porcentaje) : '');
    setPorcentajeGanancia(p.porcentaje_ganancia != null ? String(p.porcentaje_ganancia) : '');
    setUbicacionField(p.ubicacion ?? '');
    setMoneda(p.moneda ?? '$');
    setBarcodeMsg(null);
    setLoading(false);
  }, [productoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadOpts = useCallback(async () => {
    const [cRes, pRes] = await Promise.all([fetch('/api/categorias'), fetch('/api/proveedores')]);
    const cJson = await cRes.json();
    const pJson = await pRes.json();
    if (cRes.ok) {
      setCategorias(
        (cJson.categorias as { id: string; nombre: string; activa: boolean }[])
          .filter((x) => x.activa)
          .map((x) => ({ id: x.id, nombre: x.nombre }))
      );
    }
    if (pRes.ok) {
      setProveedores(
        (pJson.proveedores as { id: string; nombre: string; activo: boolean }[])
          .filter((x) => x.activo)
          .map((x) => ({ id: x.id, nombre: x.nombre }))
      );
    }
  }, []);

  useEffect(() => {
    void loadOpts();
  }, [loadOpts]);

  // Recalcular precio de venta cuando cambia costo, ganancia o IVA en modo edición.
  // Fórmula: precio_venta = costo * (1 + ganancia/100) * (1 + iva/100)
  useEffect(() => {
    if (!editMode) return;
    const costo = parseFloat(precioCosto);
    if (!Number.isFinite(costo) || costo <= 0) {
      setPrecioVenta('0');
      return;
    }
    const ganancia = porcentajeGanancia === '' ? 0 : parseFloat(porcentajeGanancia);
    const iva = ivaPorcentaje === '' ? null : parseFloat(ivaPorcentaje);
    const venta = calcularPrecioVenta(costo, ganancia, iva, ivaDefault);
    setPrecioVenta(String(venta));
  }, [editMode, precioCosto, porcentajeGanancia, ivaPorcentaje, ivaDefault]);

  useEffect(() => {
    if (esPesable && unidad !== 'kg' && unidad !== 'gramo') {
      setUnidad('kg');
    }
  }, [esPesable, unidad]);

  useEffect(() => {
    if (esPesable) setCodigoBarras('');
  }, [esPesable]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/productos/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        categoria_id: categoriaId || null,
        proveedor_id: proveedorId || null,
        unidad,
        precio_costo: parseFloat(precioCosto) || 0,
        precio_venta: parseFloat(precioVenta) || 0,
        stock_minimo: parseFloat(stockMinimo) || 0,
        fecha_vencimiento: fechaVencimiento || null,
        codigo_barras: esPesable ? null : codigoBarras.trim() || null,
        plu: esPesable && plu.trim() ? plu.trim() : null,
        es_pesable: esPesable,
        rubro: rubro.trim() || null,
        subrubro: subrubro.trim() || null,
        iva_porcentaje: ivaPorcentaje ? parseFloat(ivaPorcentaje) : null,
        porcentaje_ganancia: porcentajeGanancia ? parseFloat(porcentajeGanancia) : null,
        ubicacion: ubicacionField.trim() || null,
        moneda: moneda.trim() || '$',
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'Error al guardar');
      return;
    }
    setEditMode(false);
    await load();
    router.refresh();
  }

  async function generarCodigo() {
    setBarcodeLoading(true);
    setBarcodeMsg(null);
    const res = await fetch(`/api/productos/${productoId}/generar-codigo`, { method: 'POST' });
    const json = await res.json();
    setBarcodeLoading(false);
    if (!res.ok) {
      setBarcodeMsg({ type: 'err', text: json.error ?? 'Error al generar' });
      return;
    }
    setCodigoBarras(json.codigo_generado);
    setBarcodeMsg({ type: 'ok', text: `Código generado: ${json.codigo_generado}` });
    await load();
  }

  async function softDelete() {
    if (!confirm('¿Dar de baja este producto?')) return;
    const res = await fetch(`/api/productos/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: false }),
    });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? 'Error');
      return;
    }
    router.push('/productos');
  }

  if (loading || !data) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/productos" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            ← Lista
          </Link>
          {!modulosLoading && modulos.facturador_pos ? (
            <Link
              href={`/productos/${productoId}/etiquetas`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Etiquetas
            </Link>
          ) : null}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{data.nombre}</h1>
            <p className="text-sm text-muted-foreground font-mono">{data.codigo}</p>
          </div>
        </div>
        {canEdit && !editMode ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setEditMode(true)}>
              Editar
            </Button>
            <Button type="button" variant="destructive" onClick={() => void softDelete()}>
              Dar de baja
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        {editMode ? (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Código</span>
              <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Nombre</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Descripción</span>
              <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Categoría</span>
                <Select
                  value={categoriaId || '__none__'}
                  onValueChange={(v) => setCategoriaId(v == null || v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Proveedor</span>
                <Select
                  value={proveedorId || '__none__'}
                  onValueChange={(v) => setProveedorId(v == null || v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {proveedores.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            {!esPesable ? (
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Unidad</span>
                <Select
                  value={unidad}
                  onValueChange={(v) => v && setUnidad(v as Unidad)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIDADES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Rubro</span>
                <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: Ferretería" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Subrubro</span>
                <Input value={subrubro} onChange={(e) => setSubrubro(e.target.value)} placeholder="Ej: Tornillería" />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Precio costo</span>
                <Input
                  type="number"
                  step="0.01"
                  value={precioCosto}
                  onChange={(e) => setPrecioCosto(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">
                  Precio venta{' '}
                  <span className="text-xs text-muted-foreground">(calculado, IVA incluido)</span>
                </span>
                <Input
                  type="number"
                  step="0.01"
                  value={precioVenta}
                  readOnly
                  disabled
                  className="bg-muted/50 cursor-not-allowed"
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Precio venta = costo × (1 + ganancia%) × (1 + IVA%). Modificá ganancia o IVA para
              actualizarlo.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Ganancia %</span>
                <Input
                  type="number"
                  step="0.01"
                  value={porcentajeGanancia}
                  onChange={(e) => setPorcentajeGanancia(e.target.value)}
                  placeholder="Ej: 30"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">IVA %</span>
                <Input
                  type="number"
                  step="0.01"
                  value={ivaPorcentaje}
                  onChange={(e) => setIvaPorcentaje(e.target.value)}
                  placeholder={`Default del tenant (${ivaDefault}%)`}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Moneda</span>
                <Input value={moneda} onChange={(e) => setMoneda(e.target.value)} placeholder="$" />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Ubicación</span>
              <Input value={ubicacionField} onChange={(e) => setUbicacionField(e.target.value)} placeholder="Ej: Estante A3" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Stock mínimo</span>
              <Input
                type="number"
                value={stockMinimo}
                onChange={(e) => setStockMinimo(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Vencimiento</span>
              <Input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
              />
            </label>

            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-medium">Códigos y escaneo</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={esPesable}
                  onChange={(e) => {
                    setEsPesable(e.target.checked);
                    if (!e.target.checked) setPlu('');
                  }}
                  className="size-4 rounded border-input"
                />
                Producto pesable (balanza)
              </label>
              {!esPesable ? (
                <>
                  <div className="flex items-end gap-2">
                    <label className="grid flex-1 gap-1 text-sm">
                      <span className="text-muted-foreground">Código de barras</span>
                      <Input
                        value={codigoBarras}
                        onChange={(e) => setCodigoBarras(e.target.value)}
                        placeholder="EAN-13 o escaneá con la pistola"
                        maxLength={14}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={barcodeLoading || !!codigoBarras}
                      onClick={() => void generarCodigo()}
                    >
                      {barcodeLoading ? '…' : 'Generar'}
                    </Button>
                  </div>
                  {barcodeMsg && (
                    <p className={`text-xs ${barcodeMsg.type === 'err' ? 'text-destructive' : barcodeMsg.type === 'warn' ? 'text-yellow-600' : 'text-green-600'}`}>
                      {barcodeMsg.text}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Los productos pesables se identifican con el PLU en balanza, no con código de barras.
                </p>
              )}
              {esPesable && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Unidad de venta (pesable)</span>
                    <span className="text-xs text-muted-foreground">
                      Solo kg o gramo según cómo cargás el precio en balanza.
                    </span>
                    <Select
                      value={unidad}
                      onValueChange={(v) => v && setUnidad(v as Unidad)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIDADES_PESABLE.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">PLU (código de balanza, hasta 5 dígitos)</span>
                    <Input
                      value={plu}
                      onChange={(e) => setPlu(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="Ej: 00123"
                      maxLength={5}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditMode(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Stock</dt>
              <dd className="mt-1 text-sm">
                <span className="font-semibold">Actual:</span> {data.stock_actual}
                <span className="mx-2 text-muted-foreground">|</span>
                <span className="font-semibold">Comprometido:</span>{' '}
                {data.comprometido ?? 0}
                <span className="mx-2 text-muted-foreground">|</span>
                <span className="font-semibold">Disponible:</span>{' '}
                {data.disponible ?? data.stock_actual}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Stock mínimo</dt>
              <dd>{data.stock_minimo}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Categoría</dt>
              <dd>{data.categoria?.nombre ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Proveedor</dt>
              <dd>{data.proveedor?.nombre ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Costo / Venta</dt>
              <dd>
                {formatCurrency(data.precio_costo)} / {formatCurrency(data.precio_venta)}
                {data.porcentaje_ganancia != null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({data.porcentaje_ganancia}% ganancia)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">IVA</dt>
              <dd>{data.iva_porcentaje != null ? `${data.iva_porcentaje}%` : 'Default del tenant'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Moneda</dt>
              <dd>{data.moneda}</dd>
            </div>
            {(data.rubro || data.subrubro) && (
              <>
                <div>
                  <dt className="text-muted-foreground">Rubro</dt>
                  <dd>{data.rubro ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Subrubro</dt>
                  <dd>{data.subrubro ?? '—'}</dd>
                </div>
              </>
            )}
            {data.ubicacion && (
              <div>
                <dt className="text-muted-foreground">Ubicación</dt>
                <dd>{data.ubicacion}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Vencimiento</dt>
              <dd>{data.fecha_vencimiento ?? '—'}</dd>
            </div>
            {data.descripcion ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Descripción</dt>
                <dd>{data.descripcion}</dd>
              </div>
            ) : null}
            {(data.codigo_barras || data.plu || data.es_pesable) && (
              <>
                {!data.es_pesable ? (
                  <div>
                    <dt className="text-muted-foreground">Código de barras</dt>
                    <dd className="font-mono">{data.codigo_barras ?? '—'}</dd>
                  </div>
                ) : null}
                {data.es_pesable && (
                  <div>
                    <dt className="text-muted-foreground">PLU (balanza)</dt>
                    <dd className="font-mono">{data.plu ?? '—'}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Pesable</dt>
                  <dd>{data.es_pesable ? 'Sí' : 'No'}</dd>
                </div>
              </>
            )}
          </dl>
        )}
      </section>

      {canEdit ? (
        <MovimientoRapido
          productoId={data.id}
          productoNombre={data.nombre}
          stockActual={data.stock_actual}
          onSuccess={() => void load()}
        />
      ) : null}

      <section>
        <h2 className="mb-3 font-medium">Últimos movimientos</h2>
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cant.</TableHead>
                <TableHead className="text-right">Ant.</TableHead>
                <TableHead className="text-right">Post.</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.movimientos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Sin movimientos
                  </TableCell>
                </TableRow>
              ) : (
                data.movimientos.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell>{m.tipo}</TableCell>
                    <TableCell className="text-right font-mono">{m.cantidad}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {m.stock_anterior}
                    </TableCell>
                    <TableCell className="text-right font-mono">{m.stock_posterior}</TableCell>
                    <TableCell className="max-w-[12rem] truncate text-muted-foreground">
                      {m.motivo ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
