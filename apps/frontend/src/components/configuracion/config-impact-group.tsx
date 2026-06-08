'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ConfigImpact = 'operacion' | 'fiscal' | 'avanzado';

const IMPACT_META: Record<
  ConfigImpact,
  { label: string; description: string; borderClass: string }
> = {
  operacion: {
    label: 'Operación diaria',
    description: 'Afectan el mostrador, sucursales y la experiencia del equipo.',
    borderClass: 'border-emerald-500/50',
  },
  fiscal: {
    label: 'Datos fiscales',
    description: 'Impactan comprobantes, AFIP y obligaciones legales.',
    borderClass: 'border-sky-500/50',
  },
  avanzado: {
    label: 'Opciones avanzadas',
    description: 'Reglas de catálogo, importación e integraciones.',
    borderClass: 'border-amber-500/45',
  },
};

type Props = {
  impact: ConfigImpact;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function ConfigImpactGroup({ impact, title, description, children, className }: Props) {
  const meta = IMPACT_META[impact];
  return (
    <section className={cn('space-y-4', className)} aria-labelledby={`config-impact-${impact}`}>
      <div className={cn('border-l-4 pl-3', meta.borderClass)}>
        <p
          id={`config-impact-${impact}`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {meta.label}
        </p>
        {title ? <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2> : null}
        <p className="mt-0.5 text-sm text-muted-foreground">{description ?? meta.description}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}
