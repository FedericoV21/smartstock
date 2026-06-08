import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

type CategoriaActiva = {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  sucursal_id: string;
};

export function claveNombreCategoria(nombre: string): string {
  return nombre.trim().toLowerCase();
}

async function listarCategoriasActivas(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalIds: string[],
): Promise<CategoriaActiva[]> {
  if (sucursalIds.length === 0) return [];

  const { data, error } = await supabase
    .from('categoria')
    .select('id, nombre, descripcion, activa, sucursal_id')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .in('sucursal_id', sucursalIds)
    .order('nombre');

  if (error) throw new Error(error.message);
  return (data ?? []) as CategoriaActiva[];
}

/**
 * Replica categorías faltantes en cada sucursal operable (mismo nombre, case-insensitive).
 * Idempotente: no duplica si ya existe la categoría en la sucursal destino.
 */
export async function sincronizarCategoriasEnSucursales(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalIds: string[],
): Promise<{ creadas: number }> {
  if (sucursalIds.length <= 1) return { creadas: 0 };

  const existentes = await listarCategoriasActivas(supabase, tenantId, sucursalIds);
  const plantillas = new Map<string, { nombre: string; descripcion: string | null }>();
  const porSucursal = new Map<string, Set<string>>();

  for (const sucursalId of sucursalIds) {
    porSucursal.set(sucursalId, new Set());
  }

  for (const cat of existentes) {
    const clave = claveNombreCategoria(cat.nombre);
    if (!plantillas.has(clave)) {
      plantillas.set(clave, { nombre: cat.nombre.trim(), descripcion: cat.descripcion });
    }
    porSucursal.get(cat.sucursal_id)?.add(clave);
  }

  let creadas = 0;
  for (const sucursalId of sucursalIds) {
    const presentes = porSucursal.get(sucursalId) ?? new Set<string>();
    for (const [clave, plantilla] of plantillas) {
      if (presentes.has(clave)) continue;

      const { error } = await supabase.from('categoria').insert({
        tenant_id: tenantId,
        sucursal_id: sucursalId,
        nombre: plantilla.nombre,
        descripcion: plantilla.descripcion,
      });

      if (error && error.code !== '23505') {
        throw new Error(error.message);
      }
      if (!error) creadas += 1;
      presentes.add(clave);
    }
  }

  return { creadas };
}

/** Listado deduplicado por nombre para filtros cross-sucursal (prefiere la sucursal indicada). */
export async function listarCategoriasUnificadasTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalIds: string[],
  preferSucursalId?: string | null,
): Promise<{ id: string; nombre: string; activa: boolean }[]> {
  const rows = await listarCategoriasActivas(supabase, tenantId, sucursalIds);
  const porClave = new Map<string, { id: string; nombre: string; sucursal_id: string }>();

  for (const row of rows) {
    const clave = claveNombreCategoria(row.nombre);
    const actual = porClave.get(clave);
    if (!actual) {
      porClave.set(clave, row);
      continue;
    }
    if (preferSucursalId && row.sucursal_id === preferSucursalId) {
      porClave.set(clave, row);
    }
  }

  return [...porClave.values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
    .map(({ id, nombre }) => ({ id, nombre, activa: true }));
}

/** Expande IDs de categoría a todos los equivalentes por nombre en el tenant. */
export async function expandirCategoriaIdsPorNombre(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  categoriaIds: string[],
): Promise<string[]> {
  const ids = [...new Set(categoriaIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data: refs, error: refsErr } = await supabase
    .from('categoria')
    .select('id, nombre')
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (refsErr) throw new Error(refsErr.message);
  const nombres = [...new Set((refs ?? []).map((r) => claveNombreCategoria(r.nombre)))];
  if (nombres.length === 0) return ids;

  const { data: todas, error: todasErr } = await supabase
    .from('categoria')
    .select('id, nombre, activa')
    .eq('tenant_id', tenantId)
    .eq('activa', true);

  if (todasErr) throw new Error(todasErr.message);

  const expandidos = new Set<string>(ids);
  for (const cat of todas ?? []) {
    if (nombres.includes(claveNombreCategoria(cat.nombre))) {
      expandidos.add(cat.id);
    }
  }
  return [...expandidos];
}

/** Mapa sucursal → categoría equivalente a la referencia (por nombre). */
export async function mapaCategoriaIdPorSucursalDesdeReferencia(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  categoriaReferenciaId: string,
  sucursalIds: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!categoriaReferenciaId || sucursalIds.length === 0) return mapa;

  const { data: ref, error: refErr } = await supabase
    .from('categoria')
    .select('id, nombre, activa')
    .eq('tenant_id', tenantId)
    .eq('id', categoriaReferenciaId)
    .maybeSingle();

  if (refErr) throw new Error(refErr.message);
  if (!ref || ref.activa === false) return mapa;

  const clave = claveNombreCategoria(ref.nombre);
  const { data: equivalentes, error: eqErr } = await supabase
    .from('categoria')
    .select('id, nombre, sucursal_id, activa')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .in('sucursal_id', sucursalIds);

  if (eqErr) throw new Error(eqErr.message);

  for (const cat of equivalentes ?? []) {
    if (claveNombreCategoria(cat.nombre) === clave) {
      mapa.set(cat.sucursal_id, cat.id);
    }
  }
  return mapa;
}
