'use client';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';

/** Modo soporte: muestra identificadores internos (UUID, slug técnico) solo a superadmin. */
export function useSupportMode(): boolean {
  const { isSuperAdmin } = useDashboardRole();
  return isSuperAdmin;
}

/** Genera slug de workflow a partir del nombre visible (dueño no tipea slugs). */
export function slugifyWorkflowNombre(nombre: string): string {
  const base = nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || 'estado';
}
