'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatCurrency } from '@/lib/utils/formatters';

type Props = {
  tenantName: string;
  showPos: boolean;
  showArca: boolean;
};

type SucursalActiva = {
  id: string;
  nombre: string;
  codigo: string;
};

type EstadoResumen = {
  cajaLabel: string | null;
  stockBajoCount: number;
  arcaErrorCount: number;
};

export function DashboardExecutiveHeader({ tenantName, showPos, showArca }: Props) {
  const [sucursalActiva, setSucursalActiva] = useState<SucursalActiva | null>(null);
  const [estado, setEstado] = useState<EstadoResumen | null>(null);

  const loadEstado = useCallback(async () => {
    setEstado(null);

    let sucursalId: string | null = null;

    try {
      const sucRes = await fetch('/api/configuracion/sucursal-activa', { cache: 'no-store' });
      if (sucRes.ok) {
        const sucJson = (await sucRes.json()) as {
          sucursal_default_id?: string | null;
          sucursales?: { id: string; nombre: string; codigo: string }[];
        };
        const rows = sucJson.sucursales ?? [];
        const activeId =
          sucJson.sucursal_default_id && rows.some((s) => s.id === sucJson.sucursal_default_id)
            ? sucJson.sucursal_default_id
            : (rows[0]?.id ?? null);
        if (activeId) {
          sucursalId = activeId;
          const row = rows.find((s) => s.id === activeId);
          setSucursalActiva(
            row ? { id: row.id, nombre: row.nombre, codigo: row.codigo } : null,
          );
        }
      }
    } catch {
      setSucursalActiva(null);
    }

    const qs = sucursalId ? `?sucursal_id=${encodeURIComponent(sucursalId)}` : '';
    const next: EstadoResumen = {
      cajaLabel: null,
      stockBajoCount: 0,
      arcaErrorCount: 0,
    };

    const tasks: Promise<void>[] = [
      fetch(`/api/alertas/stock-bajo${qs}`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) return;
          const json = (await res.json()) as { productos?: unknown[]; total?: number };
          next.stockBajoCount = json.total ?? json.productos?.length ?? 0;
        })
        .catch(() => undefined),
    ];

    if (showPos) {
      tasks.push(
        fetch(`/api/caja/turno/actual${qs}`, { cache: 'no-store' })
          .then(async (res) => {
            if (!res.ok) return;
            const json = (await res.json()) as {
              turno?: {
                monto_inicial?: number;
                caja?: { nombre?: string; numero?: number } | null;
              } | null;
            };
            const turno = json.turno;
            if (!turno) return;
            const cajaNombre =
              turno.caja?.nombre?.trim() ||
              (turno.caja?.numero != null ? `Caja ${turno.caja.numero}` : 'Caja');
            const monto =
              typeof turno.monto_inicial === 'number'
                ? formatCurrency(turno.monto_inicial)
                : null;
            next.cajaLabel = monto ? `${cajaNombre} abierta · ${monto}` : `${cajaNombre} abierta`;
          })
          .catch(() => undefined),
      );
    }

    if (showArca) {
      tasks.push(
        fetch('/api/facturacion/bandeja-arca/alerta', { cache: 'no-store' })
          .then(async (res) => {
            if (!res.ok) return;
            const json = (await res.json()) as { count?: number; disabled?: boolean };
            if (!json.disabled && typeof json.count === 'number') {
              next.arcaErrorCount = json.count;
            }
          })
          .catch(() => undefined),
      );
    }

    await Promise.all(tasks);
    setEstado(next);
  }, [showArca, showPos]);

  useEffect(() => {
    void loadEstado();
  }, [loadEstado]);

  const titulo =
    sucursalActiva && sucursalActiva.nombre !== tenantName
      ? `${tenantName} · ${sucursalActiva.nombre}`
      : tenantName;

  const partes: string[] = [];
  if (estado?.cajaLabel) partes.push(estado.cajaLabel);
  if (estado && estado.stockBajoCount > 0) {
    partes.push(
      `${estado.stockBajoCount} producto${estado.stockBajoCount === 1 ? '' : 's'} con stock crítico`,
    );
  }
  if (estado && estado.arcaErrorCount > 0) {
    partes.push(
      `${estado.arcaErrorCount} factura${estado.arcaErrorCount === 1 ? '' : 's'} con error ARCA/AFIP`,
    );
  }

  const subtitulo =
    partes.length > 0
      ? partes.join(' · ')
      : sucursalActiva
        ? `Operando en ${sucursalActiva.nombre}. Todo al día por ahora.`
        : `Operando en ${tenantName}. Todo al día por ahora.`;

  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{titulo}</h1>
      <p className="mt-2 text-sm text-muted-foreground md:text-base" aria-live="polite">
        {estado === null ? 'Actualizando estado del negocio…' : subtitulo}
      </p>
    </header>
  );
}
