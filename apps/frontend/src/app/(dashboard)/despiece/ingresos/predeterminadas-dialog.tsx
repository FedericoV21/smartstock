'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PLANTILLAS_DESPIECE_PREDETERMINADAS } from '@/lib/despiece/predeterminadas';

type PlantillaExistente = { nombre: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantillasExistentes: PlantillaExistente[];
  saving: boolean;
  onSeleccionar: (slug: string) => Promise<void>;
};

export function DialogPredeterminadas({
  open,
  onOpenChange,
  plantillasExistentes,
  saving,
  onSeleccionar,
}: Props) {
  const [slugCargando, setSlugCargando] = useState<string | null>(null);

  const slugsYaCargados = useMemo(() => {
    const nombresExistentes = new Set(plantillasExistentes.map((pl) => pl.nombre));
    return new Set(
      PLANTILLAS_DESPIECE_PREDETERMINADAS.filter((p) => nombresExistentes.has(p.nombre)).map((p) => p.slug),
    );
  }, [plantillasExistentes]);

  async function handleSeleccionar(slug: string) {
    setSlugCargando(slug);
    try {
      await onSeleccionar(slug);
    } finally {
      setSlugCargando(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cargar plantilla predeterminada</DialogTitle>
          <DialogDescription>
            Elegí una plantilla. Se crearán los productos padre/hijos y se enlazará a tu sucursal actual.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {PLANTILLAS_DESPIECE_PREDETERMINADAS.map((p) => {
            const yaCargada = slugsYaCargados.has(p.slug);
            const cargandoEsta = slugCargando === p.slug;
            return (
              <li
                key={p.slug}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="space-y-1">
                  <p className="font-medium">{p.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    Padre: {p.padre.nombre} · {p.cortes.length} cortes · {p.padre.pesoTotalKg} kg base
                  </p>
                  {p.unidadBase ? (
                    <p className="text-xs text-muted-foreground">
                      Unidad base: {p.unidadBase.cantidad} {p.unidadBase.nombre}
                    </p>
                  ) : null}
                </div>
                {yaCargada ? (
                  <Button type="button" size="sm" variant="outline" disabled>
                    Ya cargada
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSeleccionar(p.slug)}
                    disabled={saving}
                  >
                    {cargandoEsta ? 'Cargando...' : 'Cargar'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
