'use client';

import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { cn } from '@/lib/utils';

/** Valor de `sucursal_id` en reportes; debe coincidir con `SUCURSAL_SCOPE_TODO_NEGOCIO` en el servidor. */
export const REPORTE_ALCANCE_TODO_NEGOCIO = 'todas';

export type SucursalReporteOption = {
  id: string;
  nombre: string;
  codigo: string;
  es_principal: boolean;
};

/**
 * Para admin / super admin: carga sucursales activas y expone `sucursal_id` para reportes.
 * Operadores no envían parámetro; el backend usa su alcance habitual.
 */
export function useReporteFiltroSucursalAdmin() {
  const { puedeElegirSucursalReporte } = useDashboardRole();
  const [hidrato, setHidrato] = useState(!puedeElegirSucursalReporte);
  const [opciones, setOpciones] = useState<SucursalReporteOption[]>([]);
  const [sucursalId, setSucursalId] = useState('');

  useEffect(() => {
    if (!puedeElegirSucursalReporte) return;
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch('/api/configuracion/sucursales');
        const json = (await res.json()) as {
          sucursales?: {
            id: string;
            nombre: string;
            codigo: string;
            activa: boolean;
            es_principal: boolean;
          }[];
        };
        if (cancel) return;
        const act = (json.sucursales ?? [])
          .filter((s) => s.activa)
          .map((s) => ({
            id: s.id,
            nombre: s.nombre,
            codigo: s.codigo,
            es_principal: Boolean(s.es_principal),
          }))
          .sort((a, b) => {
            if (a.es_principal !== b.es_principal) return a.es_principal ? -1 : 1;
            return a.nombre.localeCompare(b.nombre, 'es');
          });
        setOpciones(act);
        setSucursalId((prev) => prev || REPORTE_ALCANCE_TODO_NEGOCIO);
      } finally {
        if (!cancel) setHidrato(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [puedeElegirSucursalReporte]);

  const aplicarASearchParams = useCallback(
    (sp: URLSearchParams) => {
      if (!puedeElegirSucursalReporte || !sucursalId) return;
      sp.set('sucursal_id', sucursalId);
    },
    [puedeElegirSucursalReporte, sucursalId],
  );

  const mostrarSelector = puedeElegirSucursalReporte && opciones.length >= 1;

  return {
    hidrato,
    aplicarASearchParams,
    mostrarSelector,
    opciones,
    sucursalId,
    setSucursalId,
  };
}

type FiltroProps = {
  opciones: SucursalReporteOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
};

export function ReporteFiltroSucursalSelect({ opciones, value, onChange, className }: FiltroProps) {
  if (opciones.length < 1) return null;
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">Alcance</span>
      <select
        className="h-9 w-full min-w-[200px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={REPORTE_ALCANCE_TODO_NEGOCIO}>Todo el negocio</option>
        {opciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
            {s.codigo ? ` (${s.codigo})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
