'use client';

import Link from 'next/link';
import { Clipboard, Download, Package, Truck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { ReporteInfoDialog } from '@/components/reportes/reporte-info-dialog';
import { ReporteFiltroSucursalSelect, useReporteFiltroSucursalAdmin } from '@/components/reportes/use-reporte-filtro-sucursal-admin';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/formatters';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

type Fila = {
  producto_id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  categoria: string | null;
  proveedor_id: string | null;
  proveedor: string | null;
  unidades_periodo: number;
  consumo_diario: number | null;
  dias_cobertura: number | null;
  fecha_agot_estimada: string | null;
  stock_actual: number;
  stock_minimo: number;
  quiebre: boolean;
  dias_objetivo: number;
  cantidad_sugerida: number;
  motivos: string[];
};

type ApiResponse = {
  periodo: { key: Periodo; desde: string; hasta: string };
  parametros: {
    dias_analisis: number;
    dias_objetivo_cobertura: number;
    filtro: 'sugerencias' | 'todos';
    sin_proveedor: boolean;
    categoria_id: string | null;
    proveedor_id: string | null;
  };
  indicadores: { articulos: number; con_sugerencia_positiva: number };
  nota?: string;
  filas: Fila[];
  error?: string;
};

function textoListaProveedor(nombreProveedor: string, filas: Fila[]): string {
  const lineas = filas.map(
    (r) => `${r.codigo}\t${r.nombre}\t${r.cantidad_sugerida} ${r.unidad}`,
  );
  return `Pedido sugerido — ${nombreProveedor}\n${lineas.join('\n')}\n`;
}

function motivosLabel(m: string[]): string {
  if (m.length === 0) return '—';
  const map: Record<string, string> = {
    bajo_minimo: 'Bajo mín.',
    baja_cobertura: 'Baja cobertura',
    sin_ventas_periodo: 'Sin ventas (período)',
  };
  return m.map((x) => map[x] ?? x).join(' · ');
}

type Grupo = { key: string; nombre: string; filas: Fila[] };

export function ReporteReposicionProveedor() {
  const { hidrato, aplicarASearchParams, mostrarSelector, opciones, sucursalId, setSucursalId } =
    useReporteFiltroSucursalAdmin();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [diasObjetivo, setDiasObjetivo] = useState(14);
  const [filtro, setFiltro] = useState<'sugerencias' | 'todos'>('sugerencias');
  const [sinProveedor, setSinProveedor] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    async function loadOpts() {
      const [cRes, pRes] = await Promise.all([
        fetch('/api/categorias'),
        fetch('/api/proveedores?estado=todos'),
      ]);
      const cJson = (await cRes.json()) as { categorias?: { id: string; nombre: string }[] };
      const pJson = (await pRes.json()) as { proveedores?: { id: string; nombre: string }[] };
      if (cRes.ok && Array.isArray(cJson.categorias)) {
        setCategorias(cJson.categorias.map((x) => ({ id: x.id, nombre: x.nombre })));
      }
      if (pRes.ok && Array.isArray(pJson.proveedores)) {
        setProveedores(pJson.proveedores.map((x) => ({ id: x.id, nombre: x.nombre })));
      }
    }
    void loadOpts();
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams({
      periodo,
      dias_objetivo: String(diasObjetivo),
      filtro,
    });
    if (periodo === 'rango') {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    if (categoriaId) p.set('categoria_id', categoriaId);
    if (proveedorId) p.set('proveedor_id', proveedorId);
    p.set('sin_proveedor', sinProveedor ? '1' : '0');
    aplicarASearchParams(p);
    return p.toString();
  }, [periodo, desde, hasta, categoriaId, proveedorId, diasObjetivo, filtro, sinProveedor, aplicarASearchParams]);

  useEffect(() => {
    if (!hidrato) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reportes/reposicion-proveedor?${qs}`);
      const json = (await res.json()) as ApiResponse;
      if (!active) return;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el reporte');
        setData(null);
      } else {
        setData(json);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [qs, hidrato]);

  const csvHref = `/api/reportes/reposicion-proveedor?${qs}&export=csv`;

  const grupos = useMemo((): Grupo[] => {
    if (!data?.filas.length) return [];
    const m = new Map<string, Fila[]>();
    for (const f of data.filas) {
      const k = f.proveedor_id ?? '_sin';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    const out: Grupo[] = [];
    for (const [k, filasG] of m) {
      const nombre =
        k === '_sin' ? 'Sin proveedor asignado' : (filasG[0]?.proveedor ?? 'Proveedor');
      out.push({ key: k, nombre, filas: filasG });
    }
    out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return out;
  }, [data]);

  const copyTab = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopyFeedback('Copiado');
    window.setTimeout(() => setCopyFeedback(null), 2000);
  }, []);

  const onCopyAll = useCallback(() => {
    if (!grupos.length) return;
    const blocks = grupos.map((g) => textoListaProveedor(g.nombre, g.filas));
    copyTab(blocks.join('\n'));
  }, [grupos, copyTab]);

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Sugerencia de compra por proveedor</h2>
            <ReporteInfoDialog title="Sugerencia de compra por proveedor">
              <p>
                Usa el consumo neto del período con la misma base que Ventas por artículo, más los días de cobertura
                estimados y la fecha de agotamiento aproximada.
              </p>
              <p>
                La cantidad sugerida busca alcanzar el stock objetivo. Podés agrupar y copiar listas para enviar al
                proveedor.
              </p>
            </ReporteInfoDialog>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={csvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex')}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Exportar CSV
          </a>
          <button
            type="button"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            onClick={onCopyAll}
            disabled={!data?.filas.length}
          >
            <Clipboard className="mr-1 h-3.5 w-3.5" />
            Copiar todo
          </button>
        </div>
      </div>
      {copyFeedback ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{copyFeedback}</p> : null}

      {data?.nota ? (
        <ReporteInfoDialog title="Nota del reporte" buttonLabel="Nota del reporte">
          <p>{data.nota}</p>
        </ReporteInfoDialog>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['hoy', 'Hoy'],
            ['semana', 'Semana'],
            ['mes', 'Mes'],
            ['rango', 'Rango'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={cn(
              buttonVariants({ variant: periodo === key ? 'default' : 'outline', size: 'sm' }),
            )}
            onClick={() => setPeriodo(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {periodo === 'rango' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Categoría</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Proveedor</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Todos</option>
            {proveedores.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Días de cobertura objetivo</label>
          <Input
            type="number"
            min={1}
            max={120}
            value={diasObjetivo}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) setDiasObjetivo(Math.min(120, Math.max(1, n)));
            }}
            className="h-9"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Listado</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={filtro}
            onChange={(e) => {
              if (e.target.value === 'todos' || e.target.value === 'sugerencias') {
                setFiltro(e.target.value);
              }
            }}
          >
            <option value="sugerencias">Solo alertas y sugerencias</option>
            <option value="todos">Incluir filas sin alerta (hasta 500)</option>
          </select>
        </div>
      </div>

      {mostrarSelector ? (
        <div className="flex flex-wrap gap-3">
          <ReporteFiltroSucursalSelect opciones={opciones} value={sucursalId} onChange={setSucursalId} />
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sinProveedor}
          onChange={(e) => setSinProveedor(e.target.checked)}
        />
        Incluir productos sin proveedor asignado
      </label>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {data && !loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Días de análisis (calendario)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.parametros.dias_analisis}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Artículos listados</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.indicadores.articulos}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Con cantidad sugerida &gt; 0</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {data.indicadores.con_sugerencia_positiva}
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="h-20 animate-pulse rounded-lg border bg-muted/40" />
      ) : null}

      <div className="space-y-8">
        {grupos.map((g) => (
          <div key={g.key} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
                {g.nombre}
                <span className="text-muted-foreground">({g.filas.length})</span>
              </div>
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                onClick={() => copyTab(textoListaProveedor(g.nombre, g.filas))}
              >
                <Clipboard className="mr-1 h-3.5 w-3.5" />
                Copiar
              </button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artículo</TableHead>
                    <TableHead className="text-right">Uds. período</TableHead>
                    <TableHead className="text-right">Consumo / día</TableHead>
                    <TableHead className="text-right">Días cobertura</TableHead>
                    <TableHead>Agot. est.</TableHead>
                    <TableHead className="text-right">Stock / mín.</TableHead>
                    <TableHead className="text-right">Sugerido</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.filas.map((row) => (
                    <TableRow key={row.producto_id}>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div>
                            <Link
                              href={`/productos/${row.producto_id}`}
                              className="font-medium hover:underline"
                            >
                              {row.nombre}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {row.codigo} · {row.categoria ?? '—'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.unidades_periodo}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.consumo_diario != null ? row.consumo_diario : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.dias_cobertura != null ? row.dias_cobertura : '—'}
                      </TableCell>
                      <TableCell>
                        {row.fecha_agot_estimada ? formatDate(row.fecha_agot_estimada) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.stock_actual} / {row.stock_minimo}
                        {row.quiebre ? ' (!)' : ''}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {row.cantidad_sugerida} {row.unidad}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{motivosLabel(row.motivos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </div>

      {!loading && data && data.filas.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">No hay filas con los filtros actuales.</p>
      ) : null}
    </section>
  );
}
