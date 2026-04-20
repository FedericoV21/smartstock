'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, HelpCircle, Plus, Trash2, X } from 'lucide-react';

import { formatCurrency } from '@/lib/utils/formatters';
import { type CampoProducto } from '@/lib/normalizador/aliases';
import { type FilaValidada } from '@/lib/normalizador/validar';

const CAMPO_LABELS: Record<CampoProducto, string> = {
  codigo: 'Código',
  nombre: 'Nombre',
  precio_costo: 'Costo',
  precio_venta: 'Venta',
  stock_actual: 'Stock',
  stock_minimo: 'Mínimo',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  fecha_vencimiento: 'Vencimiento',
  unidad: 'Unidad',
  codigo_barras: 'Código de barras',
  rubro: 'Rubro',
  subrubro: 'Subrubro',
  iva_porcentaje: 'IVA %',
  porcentaje_ganancia: 'Ganancia %',
  ubicacion: 'Ubicación',
  moneda: 'Moneda',
};

const CAMPOS_AGREGABLES: { value: CampoProducto; label: string }[] = [
  { value: 'codigo', label: 'Código' },
  { value: 'nombre', label: 'Nombre / descripción' },
  { value: 'precio_costo', label: 'Precio de costo' },
  { value: 'precio_venta', label: 'Precio de venta' },
  { value: 'stock_actual', label: 'Stock actual' },
  { value: 'stock_minimo', label: 'Stock mínimo' },
  { value: 'categoria', label: 'Categoría' },
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'fecha_vencimiento', label: 'Fecha de vencimiento' },
  { value: 'unidad', label: 'Unidad de medida' },
  { value: 'rubro', label: 'Rubro' },
  { value: 'subrubro', label: 'Subrubro' },
  { value: 'iva_porcentaje', label: 'IVA %' },
  { value: 'porcentaje_ganancia', label: 'Ganancia %' },
  { value: 'ubicacion', label: 'Ubicación' },
  { value: 'moneda', label: 'Moneda' },
];

export type ColumnaPreview = {
  headerOriginal: string;
  campo: CampoProducto;
  sintetica?: boolean;
};

export type SugerenciaVentaFila = {
  precioSugerido: number;
  margenUsado: number;
  fuente: string;
};

interface Props {
  filas: FilaValidada[];
  filasRaw: Record<string, string | number | null>[];
  columnas: ColumnaPreview[];
  onFilaEdit: (index: number, headerOriginal: string, valor: string | number | null) => void;
  onFilaDescartar: (index: number) => void;
  onConfirmar: () => void;
  loading: boolean;
  onAgregarColumna: (campo: CampoProducto) => void;
  onQuitarColumna: (headerOriginal: string) => void;
  onBulkFill: (headerOriginal: string, valorTexto: string, filaIndices: number[]) => void;
  onCalcularVentaPorMargen: (
    headerPrecioVenta: string,
    porcentajeSobreCosto: number,
    filaIndices: number[]
  ) => void;
  sugerenciasVentaPorFila?: (SugerenciaVentaFila | null)[];
  statusText?: string | null;
}

const inputSm =
  'h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
const VIRTUALIZATION_THRESHOLD = 150;
const VIRTUAL_ROW_HEIGHT = 56;
const VIRTUAL_OVERSCAN = 8;

export function PreviewTable({
  filas,
  filasRaw,
  columnas,
  onFilaEdit,
  onFilaDescartar,
  onConfirmar,
  loading,
  onAgregarColumna,
  onQuitarColumna,
  onBulkFill,
  onCalcularVentaPorMargen,
  sugerenciasVentaPorFila,
  statusText,
}: Props) {
  const filasValidas = useMemo(() => filas.filter((f) => f.valida), [filas]);
  const filasConError = useMemo(() => filas.filter((f) => !f.valida), [filas]);

  const camposYaMapeados = useMemo(() => new Set(columnas.map((c) => c.campo)), [columnas]);
  const camposDisponiblesParaAgregar = useMemo(
    () => CAMPOS_AGREGABLES.filter((c) => !camposYaMapeados.has(c.value)),
    [camposYaMapeados]
  );

  const [campoNuevo, setCampoNuevo] = useState<CampoProducto>('stock_actual');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkHeader, setBulkHeader] = useState<string>(() => columnas[0]?.headerOriginal ?? '');
  const [bulkValor, setBulkValor] = useState('');
  const [margenPct, setMargenPct] = useState('30');
  const [headerVentaMargen, setHeaderVentaMargen] = useState<string>(() => {
    const v = columnas.find((c) => c.campo === 'precio_venta');
    return v?.headerOriginal ?? '';
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  const headerSelectRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (camposDisponiblesParaAgregar.length === 0) return;
    if (!camposDisponiblesParaAgregar.some((c) => c.value === campoNuevo)) {
      setCampoNuevo(camposDisponiblesParaAgregar[0]!.value);
    }
  }, [camposDisponiblesParaAgregar, campoNuevo]);

  const columnasVenta = useMemo(
    () => columnas.filter((c) => c.campo === 'precio_venta'),
    [columnas]
  );

  const columnasOptions = useMemo(
    () =>
      columnas.map((c) => ({
        value: c.headerOriginal,
        label: `${CAMPO_LABELS[c.campo]}${c.sintetica ? ' · añadida' : ''}`,
      })),
    [columnas]
  );

  useEffect(() => {
    if (columnas.length === 0) return;
    setBulkHeader((h) =>
      columnas.some((c) => c.headerOriginal === h) ? h : columnas[0]!.headerOriginal
    );
  }, [columnas]);

  useEffect(() => {
    const ventas = columnas.filter((c) => c.campo === 'precio_venta');
    if (ventas.length === 0) {
      setHeaderVentaMargen('');
      return;
    }
    setHeaderVentaMargen((h) =>
      ventas.some((v) => v.headerOriginal === h) ? h : ventas[0]!.headerOriginal
    );
  }, [columnas]);

  useEffect(() => {
    const el = headerSelectRef.current;
    if (!el) return;
    el.indeterminate = selected.size > 0 && selected.size < filas.length;
  }, [selected, filas.length]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateHeight = () => setViewportHeight(el.clientHeight || 560);
    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectedArr = useMemo(() => Array.from(selected).sort((a, b) => a - b), [selected]);
  const nSel = selected.size;
  const canBulk = nSel > 0 && bulkHeader;
  const shouldVirtualize = filas.length > VIRTUALIZATION_THRESHOLD;
  const totalColumns = columnas.length + 4;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN)
    : 0;
  const visibleCount = shouldVirtualize
    ? Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2
    : filas.length;
  const endIndex = shouldVirtualize ? Math.min(filas.length, startIndex + visibleCount) : filas.length;
  const topSpacerHeight = shouldVirtualize ? startIndex * VIRTUAL_ROW_HEIGHT : 0;
  const bottomSpacerHeight = shouldVirtualize ? Math.max(0, (filas.length - endIndex) * VIRTUAL_ROW_HEIGHT) : 0;
  const filasVisibles = shouldVirtualize
    ? filas.slice(startIndex, endIndex).map((fila, offset) => ({
        fila,
        rowIndex: startIndex + offset,
      }))
    : filas.map((fila, rowIndex) => ({ fila, rowIndex }));

  function toggleRow(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (filas.length === 0) return;
    if (selected.size === filas.length) setSelected(new Set());
    else setSelected(new Set(filas.map((_, i) => i)));
  }

  function handleDescartar(i: number) {
    setSelected((s) => {
      const next = new Set<number>();
      for (const idx of s) {
        if (idx === i) continue;
        if (idx > i) next.add(idx - 1);
        else next.add(idx);
      }
      return next;
    });
    onFilaDescartar(i);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Preview de importación</h2>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 text-green-700">
            <Check className="h-3.5 w-3.5" /> {filasValidas.length} válidas
          </span>
          <span className="flex items-center gap-1 text-red-700">
            <AlertCircle className="h-3.5 w-3.5" /> {filasConError.length} con error
          </span>
        </div>
      </div>

      <div className="rounded-lg border bg-card px-3 py-2 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4 lg:gap-y-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 lg:border-b-0 lg:pb-0">
            <span className="text-xs font-medium text-muted-foreground">Columna</span>
            {camposDisponiblesParaAgregar.length === 0 ? (
              <span className="text-xs text-muted-foreground">Todas las columnas ya están en la tabla</span>
            ) : (
              <>
                <select
                  value={campoNuevo}
                  onChange={(e) => setCampoNuevo(e.target.value as CampoProducto)}
                  className={`${inputSm} min-w-[9rem]`}
                >
                  {camposDisponiblesParaAgregar.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onAgregarColumna(campoNuevo)}
                  className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Agregar
                </button>
              </>
            )}
          </div>

          <div className="hidden h-6 w-px bg-border lg:block" aria-hidden />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Selección</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${nSel ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
            >
              {nSel === 0 ? 'Ninguna fila' : `${nSel} fila${nSel !== 1 ? 's' : ''}`}
            </span>
            <select
              value={bulkHeader}
              onChange={(e) => setBulkHeader(e.target.value)}
              className={`${inputSm} max-w-[11rem]`}
              title="Columna a rellenar"
            >
              {columnasOptions.length === 0 ? (
                <option value="">—</option>
              ) : (
                columnasOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
            <input
              type="text"
              value={bulkValor}
              onChange={(e) => setBulkValor(e.target.value)}
              placeholder="Valor"
              className={`${inputSm} w-24`}
            />
            <button
              type="button"
              disabled={!canBulk}
              title={!nSel ? 'Marcá filas con la casilla de la izquierda' : undefined}
              onClick={() => {
                onBulkFill(bulkHeader, bulkValor, selectedArr);
                setBulkValor('');
              }}
              className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium disabled:pointer-events-none disabled:opacity-45"
            >
              Rellenar
            </button>
          </div>

          <div className="hidden h-6 w-px bg-border lg:block" aria-hidden />

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Venta desde costo</span>
            <span
              className="inline-flex text-muted-foreground"
              title="Venta = costo × (1 + margen÷100). Ej.: margen 30 → precio 30% mayor que el costo."
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={margenPct}
              onChange={(e) => setMargenPct(e.target.value)}
              className={`${inputSm} w-14 text-center`}
              title="Margen % sobre costo"
            />
            <span className="text-xs text-muted-foreground">%</span>
            <select
              value={headerVentaMargen}
              onChange={(e) => setHeaderVentaMargen(e.target.value)}
              className={`${inputSm} max-w-[9rem]`}
            >
              {columnasVenta.length === 0 ? (
                <option value="">Sin columna venta</option>
              ) : (
                columnasVenta.map((c) => (
                  <option key={c.headerOriginal} value={c.headerOriginal}>
                    {c.sintetica ? 'Venta (añadida)' : CAMPO_LABELS.precio_venta}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              disabled={!canBulk || !headerVentaMargen || columnasVenta.length === 0}
              title={!nSel ? 'Seleccioná filas primero' : undefined}
              onClick={() => {
                const n = parseFloat(String(margenPct).replace(',', '.'));
                if (Number.isNaN(n)) return;
                onCalcularVentaPorMargen(headerVentaMargen, n, selectedArr);
              }}
              className="h-8 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-45"
            >
              Calcular
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <div
          ref={scrollContainerRef}
          className="max-h-[68vh] overflow-auto"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/80">
              <th className="w-9 px-1 py-1.5">
                <input
                  ref={headerSelectRef}
                  type="checkbox"
                  checked={filas.length > 0 && selected.size === filas.length}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-input"
                  title="Seleccionar / limpiar todas"
                />
              </th>
              <th className="w-10 px-2 py-1.5 text-left text-xs font-medium">#</th>
              {columnas.map((col) => (
                <th key={col.headerOriginal} className="px-2 py-1.5 text-left text-xs font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span title={col.headerOriginal}>
                      {CAMPO_LABELS[col.campo]}
                      {col.sintetica ? (
                        <span className="ml-0.5 font-normal text-muted-foreground">·</span>
                      ) : null}
                    </span>
                    {col.sintetica ? (
                      <button
                        type="button"
                        onClick={() => onQuitarColumna(col.headerOriginal)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Quitar columna"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </span>
                </th>
              ))}
              <th className="w-14 px-1 py-1.5 text-xs font-medium">Ok</th>
              <th className="w-8 px-1 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 ? (
              <tr aria-hidden>
                <td colSpan={totalColumns} className="p-0" style={{ height: topSpacerHeight }} />
              </tr>
            ) : null}
            {filasVisibles.map(({ fila, rowIndex: i }) => (
              <tr
                key={`${fila.filaOriginal}-${i}`}
                className={`border-t ${!fila.valida ? 'bg-red-50/80' : 'hover:bg-muted/40'} ${selected.has(i) ? 'bg-primary/5' : ''}`}
              >
                <td className="px-1 py-1 align-middle">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleRow(i)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                </td>
                <td className="px-2 py-1 text-xs text-muted-foreground">{fila.filaOriginal}</td>
                {columnas.map((col) => {
                  const tieneError = fila.errores.some((e) => e.campo === col.campo);
                  const msg = fila.errores.find((e) => e.campo === col.campo)?.mensaje;
                  const rawVal = filasRaw[i]?.[col.headerOriginal];
                  const sug =
                    col.campo === 'precio_venta' ? sugerenciasVentaPorFila?.[i] : undefined;
                  return (
                    <td
                      key={col.headerOriginal}
                      className={`px-2 py-1 ${tieneError ? 'bg-red-100/90' : ''}`}
                      title={tieneError ? msg : undefined}
                    >
                      <input
                        type="text"
                        value={
                          rawVal === null || rawVal === undefined ? '' : String(rawVal)
                        }
                        onChange={(e) =>
                          onFilaEdit(
                            i,
                            col.headerOriginal,
                            e.target.value === '' ? null : e.target.value
                          )
                        }
                        className={`w-full min-w-[4.5rem] border-0 border-b border-transparent bg-transparent px-0.5 py-0.5 text-xs outline-none focus-visible:border-primary ${
                          tieneError ? 'text-red-800' : ''
                        }`}
                      />
                      {sug ? (
                        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                          Sug.:{' '}
                          <span className="font-medium text-purple-700">
                            {formatCurrency(sug.precioSugerido)}
                          </span>{' '}
                          <span className="opacity-80">
                            ~{sug.margenUsado.toFixed(0)}%
                          </span>
                        </p>
                      ) : null}
                    </td>
                  );
                })}
                <td className="px-1 py-1 text-center">
                  {fila.valida ? (
                    <Check className="mx-auto h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <AlertCircle className="mx-auto h-3.5 w-3.5 text-red-600" />
                  )}
                </td>
                <td className="px-1 py-1 text-center">
                  <button
                    type="button"
                    onClick={() => handleDescartar(i)}
                    className="text-muted-foreground hover:text-red-600"
                    title="Descartar fila"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {bottomSpacerHeight > 0 ? (
              <tr aria-hidden>
                <td
                  colSpan={totalColumns}
                  className="p-0"
                  style={{ height: bottomSpacerHeight }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          {shouldVirtualize ? (
            <p className="text-xs text-muted-foreground">
              Preview optimizado: se renderizan solo las filas visibles para mantener fluida la
              navegación.
            </p>
          ) : null}
          {statusText ? <p className="text-xs text-muted-foreground">{statusText}</p> : null}
        </div>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={loading || filasValidas.length === 0}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading
            ? 'Importando...'
            : `Importar ${filasValidas.length} producto${filasValidas.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
