'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  filaRecomendadaUnificarMismoCodigo,
  type GrupoDuplicadoCodigo,
  type ResolucionDuplicadoGrupo,
} from '@/lib/importar/duplicados-codigo-preview';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grupos: GrupoDuplicadoCodigo[];
  onConfirm: (resolucion: Record<string, ResolucionDuplicadoGrupo>) => void;
};

type EstadoGrupo = {
  mode: 'separar' | 'unificar';
  filaElegidaFilaOriginal: number;
};

type FilaDup = GrupoDuplicadoCodigo['filas'][number];

type CampoDiscriminante =
  | 'stock_actual'
  | 'stock_minimo'
  | 'categoria'
  | 'unidad'
  | 'rubro'
  | 'subrubro';

const LABEL_CAMPO_DISCRIMINANTE: Record<CampoDiscriminante, string> = {
  stock_actual: 'Stock',
  stock_minimo: 'Mín.',
  categoria: 'Cat.',
  unidad: 'Ud.',
  rubro: 'Rubro',
  subrubro: 'Subrubro',
};

function textoCodigoBarrasFila(f: FilaDup): string {
  const raw = f.datos.codigo_barras;
  const s = raw != null ? String(raw).trim() : '';
  return s !== '' ? `Barras: ${s}` : 'Sin código de barras';
}

function textoStockFila(f: FilaDup): string {
  const v = f.datos.stock_actual;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '—';
}

function valorDiscriminanteDisplay(f: FilaDup, campo: CampoDiscriminante): string {
  const v = f.datos[campo];
  if (campo === 'stock_actual' || campo === 'stock_minimo') {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '—';
  }
  if (v == null) return '—';
  const s = String(v).trim();
  return s !== '' ? s : '—';
}

/** Campos extra a mostrar cuando no coinciden entre filas del grupo. `stock_actual` se muestra siempre en el resumen. */
function camposDiscriminantesEnGrupo(filas: FilaDup[]): CampoDiscriminante[] {
  const candidatos: CampoDiscriminante[] = [
    'stock_minimo',
    'categoria',
    'unidad',
    'rubro',
    'subrubro',
  ];
  const out: CampoDiscriminante[] = [];
  for (const campo of candidatos) {
    const vals = filas.map((row) => valorDiscriminanteDisplay(row, campo));
    if (new Set(vals).size > 1) out.push(campo);
  }
  return out;
}

function resumenFila(f: FilaDup, discriminantes: CampoDiscriminante[]): string {
  const nombre = String(f.datos.nombre ?? '—');
  const costo = f.datos.precio_costo;
  const costoTxt =
    costo != null && typeof costo === 'number' && Number.isFinite(costo) ? ` · $${costo}` : '';
  const stockTxt = ` · Stock: ${textoStockFila(f)}`;
  const barrasTxt = ` · ${textoCodigoBarrasFila(f)}`;
  let extraTxt = '';
  for (const c of discriminantes) {
    extraTxt += ` · ${LABEL_CAMPO_DISCRIMINANTE[c]}: ${valorDiscriminanteDisplay(f, c)}`;
  }
  return `Fila ${f.filaOriginal} · ${nombre}${costoTxt}${stockTxt}${barrasTxt}${extraTxt}`;
}

function estadoInicialGrupos(grupos: GrupoDuplicadoCodigo[]): Record<string, EstadoGrupo> {
  const out: Record<string, EstadoGrupo> = {};
  for (const g of grupos) {
    const recomendada = filaRecomendadaUnificarMismoCodigo(g.filas);
    if (g.puedeSeparar) {
      out[g.codigoClave] = { mode: 'separar', filaElegidaFilaOriginal: recomendada };
    } else {
      out[g.codigoClave] = { mode: 'unificar', filaElegidaFilaOriginal: recomendada };
    }
  }
  return out;
}

function aResolucion(estado: Record<string, EstadoGrupo>): Record<string, ResolucionDuplicadoGrupo> {
  const out: Record<string, ResolucionDuplicadoGrupo> = {};
  for (const [k, v] of Object.entries(estado)) {
    if (v.mode === 'separar') out[k] = { mode: 'separar' };
    else out[k] = { mode: 'unificar', filaElegidaFilaOriginal: v.filaElegidaFilaOriginal };
  }
  return out;
}

export function ImportarCodigoDuplicadoDialog({ open, onOpenChange, grupos, onConfirm }: Props) {
  const [estado, setEstado] = useState<Record<string, EstadoGrupo>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setErr(null);
      return;
    }
    setEstado(estadoInicialGrupos(grupos));
  }, [open, grupos]);

  const actualizar = useCallback((codigoClave: string, parcial: Partial<EstadoGrupo>) => {
    setEstado((prev) => {
      const cur = prev[codigoClave];
      if (!cur) return prev;
      return { ...prev, [codigoClave]: { ...cur, ...parcial } };
    });
    setErr(null);
  }, []);

  const handleConfirmar = useCallback(() => {
    onConfirm(aResolucion(estado));
    onOpenChange(false);
  }, [estado, grupos, onConfirm, onOpenChange]);

  if (grupos.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,640px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mismo código en varias filas</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          El archivo repite al menos un código de artículo. Elegí si importás{' '}
          <span className="text-foreground">varios productos</span> (una fila = un producto) o{' '}
          <span className="text-foreground">un solo producto</span> (una fila gana; el resto se
          omite en esta importación).
        </p>

        <div className="space-y-6">
          {grupos.map((g) => {
            const e = estado[g.codigoClave];
            if (!e) return null;
            const discriminantes = camposDiscriminantesEnGrupo(g.filas);
            const filaRecomendada = filaRecomendadaUnificarMismoCodigo(g.filas);
            const nameSeparar = `modo-dup-${g.codigoClave}`;
            return (
              <div
                key={g.codigoClave}
                className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
              >
                <p className="text-sm font-medium">
                  Código <span className="text-foreground">{g.codigoDisplay}</span> · {g.filas.length}{' '}
                  filas
                </p>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {g.filas.map((f) => (
                    <li key={f.filaOriginal}>{resumenFila(f, discriminantes)}</li>
                  ))}
                </ul>

                <div className="space-y-2 text-sm">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      className="mt-1"
                      name={nameSeparar}
                      checked={e.mode === 'separar'}
                      onChange={() => actualizar(g.codigoClave, { mode: 'separar' })}
                    />
                    <span>
                      <span className="text-foreground">Productos distintos</span> (importar cada
                      fila)
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      className="mt-1"
                      name={nameSeparar}
                      checked={e.mode === 'unificar'}
                      onChange={() =>
                        actualizar(g.codigoClave, {
                          mode: 'unificar',
                          filaElegidaFilaOriginal: filaRecomendada,
                        })
                      }
                    />
                    <span className="text-foreground">Un solo producto — quedarse con la fila:</span>
                  </label>
                </div>

                {e.mode === 'unificar' ? (
                  <div className="space-y-1.5 pl-0 sm:pl-6">
                    <select
                      className="border-input bg-background w-full max-w-md rounded-md border px-2 py-1.5 text-sm"
                      value={e.filaElegidaFilaOriginal}
                      onChange={(ev) =>
                        actualizar(g.codigoClave, {
                          filaElegidaFilaOriginal: Number(ev.target.value),
                        })
                      }
                    >
                      {g.filas.map((f) => (
                        <option key={f.filaOriginal} value={f.filaOriginal}>
                          {f.filaOriginal === filaRecomendada ? 'Recomendada · ' : ''}
                          {resumenFila(f, discriminantes)}
                        </option>
                      ))}
                    </select>
                    <p className="text-muted-foreground max-w-md text-xs">
                      Recomendada: fila {filaRecomendada} (prioridad: código de barras, stock
                      positivo, mayor costo; si empata, la fila más arriba en el archivo).
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {err ? <p className="text-destructive text-sm">{err}</p> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button type="button" onClick={handleConfirmar}>
            Continuar importación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
