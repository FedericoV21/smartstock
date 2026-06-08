'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/hooks/use-confirm';
import {
  DEFAULT_FUSIONAR_PRODUCTO_CAMPOS,
  type FusionarProductoCamposInput,
} from '@/lib/productos/fusionar-producto-campos';

type ProductoOpt = {
  id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  sucursal?: { id: string } | null;
};

type CamposState = Record<string, string>;

type DryJson = {
  dry_run?: boolean;
  preview_maestro?: Record<string, unknown>;
  unicidad_problemas?: unknown[];
  counts?: Record<string, number>;
};

const ROWS_ORIGEN: { key: keyof FusionarProductoCamposInput; label: string }[] = [
  { key: 'codigo', label: 'Código interno' },
  { key: 'nombre', label: 'Nombre' },
  { key: 'precio_costo', label: 'Precio costo' },
  { key: 'precio_venta', label: 'Precio venta' },
  { key: 'codigo_barras', label: 'Código de barras' },
  { key: 'plu', label: 'PLU' },
  { key: 'es_pesable', label: 'Pesable / balanza' },
  { key: 'descripcion', label: 'Descripción' },
  { key: 'rubro', label: 'Rubro' },
  { key: 'subrubro', label: 'Subrubro' },
  { key: 'ubicacion', label: 'Ubicación' },
  { key: 'imagen_url', label: 'URL imagen' },
  { key: 'iva_porcentaje', label: 'IVA %' },
  { key: 'porcentaje_ganancia', label: 'Ganancia %' },
  { key: 'presentacion_compra', label: 'Presentación compra' },
  { key: 'fecha_vencimiento', label: 'Vencimiento (ficha)' },
];

function SelectOrigen({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <select
      id={id}
      className="border-input h-8 rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="survivor">Este producto</option>
      <option value="loser">El otro (se elimina)</option>
    </select>
  );
}

export function FusionarProductoEnDestino({
  survivorId,
  survivorNombre,
  survivorCodigo,
  survivorUnidad,
  proveedorId,
  sucursalId,
  canEdit,
  onMerged,
  variant = 'standalone',
}: {
  survivorId: string;
  survivorNombre: string;
  survivorCodigo: string;
  survivorUnidad: string;
  proveedorId: string;
  sucursalId: string;
  canEdit: boolean;
  onMerged: () => void;
  /** `embedded`: sin caja propia ni título (p. ej. dentro de un &lt;details&gt;). */
  variant?: 'standalone' | 'embedded';
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<ProductoOpt[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [selectedLoser, setSelectedLoser] = useState<ProductoOpt | null>(null);
  const loserId = selectedLoser?.id ?? '';
  const [campos, setCampos] = useState<CamposState>(() => ({ ...DEFAULT_FUSIONAR_PRODUCTO_CAMPOS }));
  const [simPayload, setSimPayload] = useState<DryJson | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);

  const searchUrl = useMemo(() => {
    const params = new URLSearchParams();
    const q = searchQ.trim();
    if (q) params.set('q', q);
    params.set('proveedor_id', proveedorId);
    params.set('sucursal_id', sucursalId);
    params.set('por_pagina', '25');
    params.set('pagina', '1');
    return `/api/productos?${params.toString()}`;
  }, [searchQ, proveedorId, sucursalId]);

  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]);
      setSearchErr(null);
      return;
    }
    setSearchLoading(true);
    setSearchErr(null);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(searchUrl);
          const json = (await res.json()) as { productos?: ProductoOpt[]; error?: string };
          if (!res.ok) {
            setSearchResults([]);
            setSearchErr(json.error ?? 'No se pudo buscar');
            return;
          }
          const list = (json.productos ?? [])
            .filter(
              (p) =>
                p.id !== survivorId &&
                p.sucursal?.id === sucursalId &&
                p.unidad === survivorUnidad,
            )
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
          setSearchResults(list);
        } finally {
          setSearchLoading(false);
        }
      })();
    }, 320);
    return () => clearTimeout(t);
  }, [searchUrl, searchQ, survivorId, sucursalId, survivorUnidad]);

  const pickLoser = useCallback((p: ProductoOpt) => {
    setSelectedLoser(p);
    setSearchQ('');
    setSearchResults([]);
    setSimPayload(null);
    setSimErr(null);
  }, []);

  const clearLoser = useCallback(() => {
    setSelectedLoser(null);
    setSimPayload(null);
    setSimErr(null);
  }, []);

  const bodyCampos = useMemo((): FusionarProductoCamposInput => {
    const out: FusionarProductoCamposInput = {};
    for (const { key } of ROWS_ORIGEN) {
      const v = campos[key];
      if (v === 'survivor' || v === 'loser') {
        out[key] = v;
      }
    }
    const sm = campos.stock_minimo;
    if (sm === 'survivor' || sm === 'loser' || sm === 'max') out.stock_minimo = sm;
    const ps = campos.precio_sucursal_override;
    if (ps === 'survivor' || ps === 'loser' || ps === 'merge') out.precio_sucursal_override = ps;
    return out;
  }, [campos]);

  async function simular() {
    if (!loserId) return;
    setSimLoading(true);
    setSimErr(null);
    setSimPayload(null);
    try {
      const res = await fetch('/api/productos/fusionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivor_id: survivorId,
          loser_ids: [loserId],
          campos: bodyCampos,
          dry_run: true,
        }),
      });
      const json = (await res.json()) as DryJson & { error?: string };
      if (!res.ok) {
        setSimErr(json.error ?? 'Error en simulación');
        return;
      }
      setSimPayload(json);
    } finally {
      setSimLoading(false);
    }
  }

  async function ejecutarFusion() {
    if (!loserId || !selectedLoser) return;
    const loser = selectedLoser;
    const ok = await confirm({
      title: 'Fusionar productos',
      description: (
        <div className="space-y-2 text-sm">
          <p>
            Los movimientos, ventas e historial del artículo <strong>{loser?.nombre ?? 'elegido'}</strong> pasarán a{' '}
            <strong>{survivorNombre}</strong>. El duplicado se elimina y el stock en este depósito se suma.
          </p>
          <p className="font-medium text-destructive">Esta acción no se puede deshacer.</p>
        </div>
      ),
      confirmLabel: 'Fusionar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;

    setMergeLoading(true);
    setSimErr(null);
    try {
      const res = await fetch('/api/productos/fusionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivor_id: survivorId,
          loser_ids: [loserId],
          campos: bodyCampos,
          dry_run: false,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSimErr(json.error ?? 'No se pudo fusionar');
        return;
      }
      setSelectedLoser(null);
      setSearchQ('');
      setSearchResults([]);
      setSimPayload(null);
      setCampos({ ...DEFAULT_FUSIONAR_PRODUCTO_CAMPOS });
      onMerged();
    } finally {
      setMergeLoading(false);
    }
  }

  const problemaUnicidad = useMemo(() => {
    const u = simPayload?.unicidad_problemas;
    return Array.isArray(u) && u.length > 0;
  }, [simPayload]);

  if (!canEdit) return null;

  const Shell = variant === 'embedded' ? 'div' : 'section';
  const shellClass =
    variant === 'embedded'
      ? 'space-y-4'
      : 'rounded-xl border border-amber-200/80 bg-amber-50/50 p-5 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20';

  return (
    <>
      {ConfirmDialog}
      <Shell className={shellClass}>
        {variant === 'standalone' ? (
          <h2 className="font-medium text-foreground">Unificar con otro producto</h2>
        ) : null}
        <p className={variant === 'standalone' ? 'mt-1 text-sm text-muted-foreground' : 'text-sm text-muted-foreground'}>
          Buscá por nombre o código (igual que al armar una promoción). Solo aparecen artículos del mismo proveedor,
          mismo depósito y misma unidad (<span className="text-foreground">{survivorUnidad}</span>). Elegí qué datos
          conservar en <span className="text-foreground">{survivorNombre}</span> (
          <span className="font-mono">{survivorCodigo}</span>). El stock en este depósito se suma automáticamente.
        </p>

        {searchErr ? <p className="mt-2 text-sm text-destructive">{searchErr}</p> : null}

        <div className="mt-4 grid gap-2">
          <span className="text-sm text-muted-foreground">Producto duplicado a absorber</span>
          {selectedLoser ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/80 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{selectedLoser.nombre}</span>{' '}
                <span className="font-mono text-muted-foreground">{selectedLoser.codigo}</span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={clearLoser}>
                Elegir otro
              </Button>
            </div>
          ) : (
            <>
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Nombre o código…"
                className="max-w-md"
                autoComplete="off"
              />
              {searchLoading ? (
                <p className="text-xs text-muted-foreground">Buscando…</p>
              ) : searchQ.trim() && searchResults.length > 0 ? (
                <ul className="max-h-40 max-w-2xl overflow-auto rounded-md border bg-background text-sm">
                  {searchResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/80"
                        onClick={() => pickLoser(p)}
                      >
                        <span className="min-w-0 truncate">{p.nombre}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.codigo}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : searchQ.trim() && !searchLoading ? (
                <p className="text-xs text-muted-foreground">
                  Sin resultados en este depósito con la misma unidad, o probá otra palabra clave.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Escribí para buscar en el catálogo del proveedor.</p>
              )}
            </>
          )}
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card/60">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-2 font-medium">Campo</th>
                <th className="p-2 font-medium">Origen del valor final</th>
              </tr>
            </thead>
            <tbody>
              {ROWS_ORIGEN.map(({ key, label }) => (
                <tr key={key} className="border-b border-border/80">
                  <td className="p-2">{label}</td>
                  <td className="p-2">
                    <SelectOrigen
                      id={`fus-${key}`}
                      value={campos[key] ?? 'survivor'}
                      onChange={(v) =>
                        setCampos((c) => {
                          const n = { ...c, [key]: v };
                          return n;
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
              <tr className="border-b border-border/80">
                <td className="p-2">Stock mínimo (ficha)</td>
                <td className="p-2">
                  <select
                    className="border-input h-8 rounded-md border bg-background px-2 text-xs"
                    value={campos.stock_minimo}
                    onChange={(e) =>
                      setCampos((c) => ({ ...c, stock_minimo: e.target.value }))
                    }
                  >
                    <option value="max">Máximo entre ambos</option>
                    <option value="survivor">Este producto</option>
                    <option value="loser">El otro</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td className="p-2">Precio por sucursal (override)</td>
                <td className="p-2">
                  <select
                    className="border-input h-8 rounded-md border bg-background px-2 text-xs"
                    value={campos.precio_sucursal_override}
                    onChange={(e) =>
                      setCampos((c) => ({ ...c, precio_sucursal_override: e.target.value }))
                    }
                  >
                    <option value="merge">Combinar (priorizar este; completar vacíos)</option>
                    <option value="survivor">Solo este producto</option>
                    <option value="loser">Solo el otro</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!loserId || simLoading} onClick={() => void simular()}>
            {simLoading ? 'Simulando…' : 'Simular impacto'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!loserId || mergeLoading || simPayload?.dry_run !== true || problemaUnicidad}
            onClick={() => void ejecutarFusion()}
          >
            {mergeLoading ? 'Fusionando…' : 'Fusionar ahora'}
          </Button>
        </div>

        {simErr ? <p className="mt-3 text-sm text-destructive">{simErr}</p> : null}

        {simPayload?.dry_run === true ? (
          <div className="mt-4 space-y-3 rounded-lg border border-border bg-card/80 p-3 text-sm">
            <p className="font-medium text-foreground">Simulación</p>
            {problemaUnicidad ? (
              <p className="text-destructive">
                Hay conflicto de código único (PLU o código de barras). Ajustá las preferencias o el catálogo antes de
                fusionar.
              </p>
            ) : null}
            {simPayload.preview_maestro ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Vista previa del maestro</p>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-xs">
                  {JSON.stringify(simPayload.preview_maestro, null, 2)}
                </pre>
              </div>
            ) : null}
            {simPayload.counts ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Registros a repuntar</p>
                <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
                  {Object.entries(simPayload.counts).map(([k, v]) => (
                    <li key={k} className="tabular-nums">
                      <span className="text-muted-foreground">{k}</span>: {v}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Shell>
    </>
  );
}
