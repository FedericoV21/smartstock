'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type LogRow = {
  id: string;
  created_at: string;
  updated_at: string;
  estado: string;
  direccion: string;
  archivo_nombre: string;
  comprobante_id: string | null;
  error_mensaje: string | null;
};

export function LectorHistorialClient() {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/lector-facturas/logs');
      const j = (await res.json()) as { logs?: LogRow[]; error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Error al cargar');
        setLogs([]);
        return;
      }
      setLogs(j.logs ?? []);
    } catch {
      setError('Error de conexión');
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (logs === null) {
    return <div className="text-muted-foreground animate-pulse text-sm">Cargando…</div>;
  }

  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }

  if (logs.length === 0) {
    return <p className="text-muted-foreground text-sm">Todavía no hay extracciones registradas.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Fecha</th>
            <th className="px-3 py-2 text-left font-medium">Archivo</th>
            <th className="px-3 py-2 text-left font-medium">Estado</th>
            <th className="px-3 py-2 text-left font-medium">Dirección</th>
            <th className="px-3 py-2 text-left font-medium">Comprobante</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                {new Date(r.created_at).toLocaleString('es-AR')}
              </td>
              <td className="max-w-[200px] truncate px-3 py-2">{r.archivo_nombre}</td>
              <td className="px-3 py-2 capitalize">{r.estado}</td>
              <td className="px-3 py-2 capitalize">{r.direccion}</td>
              <td className="px-3 py-2">
                {r.comprobante_id ? (
                  <Link
                    href="/facturacion"
                    className="text-purple-700 underline underline-offset-2 hover:text-purple-900"
                  >
                    Ver en facturación
                  </Link>
                ) : r.error_mensaje ? (
                  <span className="text-destructive text-xs" title={r.error_mensaje}>
                    Error
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
