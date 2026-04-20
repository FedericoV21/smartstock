'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { MapeoColumnas } from '@/components/importar/mapeo-columnas';
import { readImportDraft, writeImportDraft } from '@/lib/importar/draft';
import { guardarPerfilMapeo } from '@/lib/normalizador/guardar-perfil';
import type { MapeoColumna } from '@/lib/normalizador/mapear';

export default function ImportarMapeoPage() {
  const router = useRouter();
  const [mapeo, setMapeo] = useState<MapeoColumna[] | null>(null);
  const [filasMuestra, setFilasMuestra] = useState<Record<string, string | number | null>[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const d = await readImportDraft();
      if (cancelled) return;
      if (!d) {
        router.replace('/importar');
        return;
      }
      if (d.saltoMapeoPorPerfil) {
        router.replace('/importar/preview');
        return;
      }
      setMapeo(d.mapeo);
      setFilasMuestra(d.archivo.filas);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!mapeo) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/importar" className="underline underline-offset-4">
          ← Volver al paso anterior
        </Link>
      </p>
      <MapeoColumnas
        mapeo={mapeo}
        onMapeoChange={setMapeo}
        filasMuestra={filasMuestra}
        onConfirmar={() => {
          void (async () => {
            const d = await readImportDraft();
            if (!d) {
              router.replace('/importar');
              return;
            }
            await writeImportDraft({ ...d, mapeo });
            if (d.guardarPerfil && d.proveedorId) {
              const { error } = await guardarPerfilMapeo(
                d.proveedorId,
                mapeo,
                d.archivo.nombreArchivo,
                1
              );
              if (error) console.error(error);
            }
            router.push('/importar/preview');
          })();
        }}
      />
    </div>
  );
}
