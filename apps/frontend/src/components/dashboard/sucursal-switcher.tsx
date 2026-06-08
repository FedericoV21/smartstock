'use client';

import { Store } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type SucursalOption = {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  es_principal: boolean;
};

type SucursalResponse = {
  sucursal_default_id: string | null;
  sucursales: SucursalOption[];
  error?: string;
};

export function SucursalSwitcher({ onDarkBackground = false }: { onDarkBackground?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [activeSucursalId, setActiveSucursalId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracion/sucursal-activa');
      const json = (await res.json()) as SucursalResponse;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar sucursales');
        setSucursales([]);
        setActiveSucursalId(null);
        return;
      }
      const rows = json.sucursales ?? [];
      setSucursales(rows);
      if (json.sucursal_default_id && rows.some((s) => s.id === json.sucursal_default_id)) {
        setActiveSucursalId(json.sucursal_default_id);
      } else {
        setActiveSucursalId(rows[0]?.id ?? null);
      }
    } catch {
      setError('Error de red');
      setSucursales([]);
      setActiveSucursalId(null);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onSucursalesChanged() {
      void load();
    }
    window.addEventListener('sucursales:changed', onSucursalesChanged as EventListener);
    return () => window.removeEventListener('sucursales:changed', onSucursalesChanged as EventListener);
  }, [load]);

  const triggerLabel = useMemo(() => {
    if (!activeSucursalId) return 'Sin sucursal';
    const s = sucursales.find((it) => it.id === activeSucursalId);
    if (!s) return 'Sucursal';
    return `${s.nombre}`;
  }, [activeSucursalId, sucursales]);

  async function switchTo(sucursalId: string) {
    if (!sucursalId || sucursalId === activeSucursalId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracion/sucursal-activa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sucursal_id: sucursalId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cambiar sucursal');
        return;
      }
      setActiveSucursalId(sucursalId);
      window.location.reload();
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }

  if (!listLoading && sucursales.length <= 1) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
      <div className="flex items-center gap-2">
        <Store
          className={cn('h-4 w-4 shrink-0', onDarkBackground ? 'text-zinc-300' : 'text-muted-foreground')}
          aria-hidden
        />
        <Select
          value={activeSucursalId ?? ''}
          onValueChange={(v) => {
            if (!v || loading) return;
            void switchTo(v);
          }}
          disabled={loading || listLoading}
        >
          <SelectTrigger
            className={cn(
              'h-8 w-[min(14rem,70vw)] text-xs',
              onDarkBackground && 'border-zinc-600 bg-zinc-700 text-zinc-100 [&_svg]:text-zinc-300',
            )}
          >
            <SelectValue placeholder="Sucursal">{triggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sucursales.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.codigo} · {s.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <p className={cn('max-w-[14rem] text-[10px]', onDarkBackground ? 'text-red-400' : 'text-destructive')}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

