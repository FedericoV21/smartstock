'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { UploadArchivo } from '@/components/importar/upload-archivo';
import { writeImportDraft } from '@/lib/importar/draft';
import { aplicarPerfilProveedor, mapearHeaders } from '@/lib/normalizador/mapear';
import type { ArchivoParseado } from '@/lib/normalizador/parsear';

type ProveedorListItem = { id: string; nombre: string };

type MapeoExcelPerfil = {
  mapeo?: Record<string, string>;
};

export default function ImportarPage() {
  const router = useRouter();
  const { canEdit } = useDashboardRole();
  const [proveedores, setProveedores] = useState<ProveedorListItem[]>([]);
  const [proveedorId, setProveedorId] = useState<string>('');
  const [guardarPerfil, setGuardarPerfil] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/proveedores');
      if (!r.ok) return;
      const j = (await r.json()) as { proveedores: ProveedorListItem[] };
      setProveedores(j.proveedores ?? []);
    })();
  }, []);

  const onArchivoParsed = useCallback(
    async (data: ArchivoParseado) => {
      let mapeo = mapearHeaders(data.headers);
      let saltoMapeoPorPerfil = false;
      const draftId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      if (proveedorId) {
        const r = await fetch(`/api/proveedores/${proveedorId}`);
        if (r.ok) {
          const p = (await r.json()) as { mapeo_excel?: unknown };
          const perfil = p.mapeo_excel as MapeoExcelPerfil | null | undefined;
          if (perfil?.mapeo && typeof perfil.mapeo === 'object') {
            const mapeoPerfil = aplicarPerfilProveedor(data.headers, perfil.mapeo);
            const tieneNombre = mapeoPerfil.some(
              (m) => m.campoDetectado === 'nombre' && !m.ignorar
            );
            if (tieneNombre) {
              mapeo = mapeoPerfil;
              saltoMapeoPorPerfil = true;
            }
          }
        }
      }

      await writeImportDraft({
        version: 1,
        draftId,
        archivo: data,
        proveedorId: proveedorId || null,
        guardarPerfil,
        mapeo,
        saltoMapeoPorPerfil,
      });

      if (saltoMapeoPorPerfil) {
        router.push('/importar/preview');
      } else {
        router.push('/importar/mapeo');
      }
    },
    [proveedorId, guardarPerfil, router]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar productos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subí un Excel o CSV. El archivo se procesa en tu navegador; no se envía al servidor hasta
          que confirmes la importación.
        </p>
        <p className="mt-2 text-sm">
          <a
            href="/plantillas/plantilla_importacion.xlsx"
            className="text-primary underline underline-offset-4"
            download
          >
            Descargar plantilla
          </a>
        </p>
      </div>

      {!canEdit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Tu rol no permite importar datos. Solo podés revisar esta pantalla.
        </p>
      ) : null}

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <label className="block text-sm font-medium" htmlFor="proveedor-import">
          Proveedor (opcional)
        </label>
        <select
          id="proveedor-import"
          className="w-full max-w-md rounded border px-3 py-2 text-sm"
          value={proveedorId}
          disabled={!canEdit}
          onChange={(e) => setProveedorId(e.target.value)}
        >
          <option value="">— Sin proveedor —</option>
          {proveedores.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.nombre}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={guardarPerfil}
            disabled={!canEdit || !proveedorId}
            onChange={(e) => setGuardarPerfil(e.target.checked)}
          />
          Guardar este mapeo para futuras importaciones (requiere proveedor)
        </label>
      </div>

      <UploadArchivo onArchivoParsed={onArchivoParsed} disabled={!canEdit} />

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/productos" className="underline underline-offset-4">
          Volver a productos
        </Link>
      </p>
    </div>
  );
}
