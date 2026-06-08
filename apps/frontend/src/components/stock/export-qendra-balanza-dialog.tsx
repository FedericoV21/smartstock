'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ExportQendraBalanzaBody } from '@/app/api/productos/export-qendra-balanza/route';

type CategoriaOpt = { id: string; nombre: string };

type ModoExport = 'categorias' | 'productos';

type SeleccionExport = {
  haySeleccion: boolean;
  count: number;
  resolveProductoIds: () => Promise<string[]>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialModo?: ModoExport;
  categorias: CategoriaOpt[];
  seleccion?: SeleccionExport;
  disabled?: boolean;
};

export function ExportQendraBalanzaDialog({
  open,
  onOpenChange,
  initialModo = 'categorias',
  categorias,
  seleccion,
  disabled,
}: Props) {
  const [modo, setModo] = useState<ModoExport>(initialModo);
  const [categoriasMarcadas, setCategoriasMarcadas] = useState<Set<string>>(new Set());
  const [sectorFijo, setSectorFijo] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setModo(initialModo);
      setError(null);
    }
  }, [open, initialModo]);

  const toggleCategoria = (id: string) => {
    setCategoriasMarcadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const puedeDescargar = useMemo(() => {
    if (modo === 'categorias') return categoriasMarcadas.size > 0;
    return seleccion?.haySeleccion === true;
  }, [modo, categoriasMarcadas.size, seleccion?.haySeleccion]);

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      const body: ExportQendraBalanzaBody = {};
      if (sectorFijo.trim()) {
        body.sector_fijo = sectorFijo.trim();
      }

      if (modo === 'categorias') {
        if (categoriasMarcadas.size === 0) {
          setError('Elegí al menos una categoría.');
          return;
        }
        body.categoria_ids = [...categoriasMarcadas];
      } else {
        if (!seleccion?.haySeleccion) {
          setError('Seleccioná productos en la lista o usá el modo por categorías.');
          return;
        }
        const ids = await seleccion.resolveProductoIds();
        if (ids.length === 0) {
          setError('No hay productos en la selección.');
          return;
        }
        body.producto_ids = ids;
      }

      const res = await fetch('/api/productos/export-qendra-balanza', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? 'No se pudo generar el CSV.');
        return;
      }

      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition');
      const match = dispo?.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'qendra.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } catch {
      setError('Error de red al exportar.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar para Qendra (balanza)</DialogTitle>
          <DialogDescription>
            CSV UTF-8 (Systel Max) sin encabezados: Sección, Código/Número de PLU,
            Descripción, precios, tipo <span className="font-medium text-foreground">u</span> o{' '}
            <span className="font-medium text-foreground">p</span>, vencimiento e ingredientes.
            Solo activos con PLU (pesables o por unidad).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={modo === 'categorias' ? 'default' : 'outline'}
              onClick={() => setModo('categorias')}
            >
              Por categorías
            </Button>
            <Button
              type="button"
              size="sm"
              variant={modo === 'productos' ? 'default' : 'outline'}
              disabled={!seleccion}
              onClick={() => setModo('productos')}
            >
              Por productos seleccionados
            </Button>
          </div>

          {modo === 'categorias' ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Categorías a exportar</p>
              {categorias.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay categorías activas.</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                  {categorias.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={categoriasMarcadas.has(c.id)}
                        onChange={() => toggleCategoria(c.id)}
                      />
                      {c.nombre}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                La columna <span className="font-medium text-foreground">Sector</span> usa el nombre
                de la categoría de cada producto, salvo que indiques un sector fijo abajo.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {seleccion?.haySeleccion ? (
                <>
                  Se exportarán los productos de tu selección actual (
                  <strong className="font-medium text-foreground">{seleccion.count}</strong>
                  ). Se omiten los que no tengan PLU o no sean pesables / por unidad con PLU.
                </>
              ) : (
                <>
                  Marcá productos en la tabla (o «toda la búsqueda») y volvé a abrir este diálogo.
                </>
              )}
            </p>
          )}

          <div className="space-y-2">
            <label htmlFor="qendra-sector-fijo" className="text-sm font-medium">
              Sector fijo en balanza (opcional)
            </label>
            <Input
              id="qendra-sector-fijo"
              placeholder="Ej. FRUTAS — dejá vacío para usar la categoría de cada producto"
              value={sectorFijo}
              onChange={(e) => setSectorFijo(e.target.value)}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            className={cn('inline-flex items-center gap-1.5')}
            disabled={disabled || !puedeDescargar || downloading}
            onClick={() => void handleDownload()}
          >
            <Download className="size-4" />
            {downloading ? 'Generando…' : 'Descargar CSV'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExportQendraBalanzaTrigger({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="inline-flex items-center gap-1.5"
      disabled={disabled}
      onClick={onClick}
      title={
        disabled
          ? 'La exportación Qendra solo incluye productos activos. Quitá «Solo dados de baja».'
          : 'CSV de productos con PLU para Qendra / balanza Systel'
      }
    >
      <Download className="size-4 shrink-0" />
      Qendra (balanza)
    </Button>
  );
}
