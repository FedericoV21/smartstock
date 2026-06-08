import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export const FACTURAS_IMPORTADAS_POR_PAGINA = 10;

export type FacturaImportadaProveedor = {
  id: string;
  tipo: Database['public']['Enums']['tipo_comprobante'];
  numero: number | null;
  numero_orden: number | null;
  fecha: string;
  total: number;
  estado: Database['public']['Enums']['estado_comprobante'];
  origen_importacion: 'lector' | 'manual' | null;
  estado_aplicacion: 'aplicada' | 'revertida' | null;
};

export type FacturasImportadasPaginaResult = {
  facturas: FacturaImportadaProveedor[];
  total: number;
  pagina: number;
  totalPaginas: number;
  porPagina: number;
};

export async function listarFacturasImportadasProveedor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  proveedorId: string,
  paginaSolicitada = 1,
): Promise<FacturasImportadasPaginaResult> {
  const { count: totalRaw } = await supabase
    .from('comprobante')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('proveedor_id', proveedorId)
    .eq('tipo_operacion', 'compra');

  const total = totalRaw ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / FACTURAS_IMPORTADAS_POR_PAGINA));
  const pagina = Math.min(Math.max(1, paginaSolicitada), totalPaginas);
  const desde = (pagina - 1) * FACTURAS_IMPORTADAS_POR_PAGINA;
  const hasta = desde + FACTURAS_IMPORTADAS_POR_PAGINA - 1;

  const { data: facturasRaw } = await supabase
    .from('comprobante')
    .select('id, tipo, numero, numero_orden, fecha, total, estado, created_at')
    .eq('tenant_id', tenantId)
    .eq('proveedor_id', proveedorId)
    .eq('tipo_operacion', 'compra')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .range(desde, hasta);

  const facturasIds = (facturasRaw ?? []).map((f) => f.id);
  let aplicacionesPorComprobante = new Map<
    string,
    { origen: 'lector' | 'manual'; estado: 'aplicada' | 'revertida' }
  >();

  if (facturasIds.length > 0) {
    const { data: aplicacionesRaw } = await supabase
      .from('factura_importada_aplicacion')
      .select('comprobante_id, origen, estado')
      .eq('tenant_id', tenantId)
      .in('comprobante_id', facturasIds);

    aplicacionesPorComprobante = new Map(
      (aplicacionesRaw ?? []).map((app) => [
        app.comprobante_id,
        { origen: app.origen, estado: app.estado },
      ]),
    );
  }

  const facturas: FacturaImportadaProveedor[] = (facturasRaw ?? []).map((f) => {
    const aplicacion = aplicacionesPorComprobante.get(f.id);
    return {
      id: f.id,
      tipo: f.tipo,
      numero: f.numero,
      numero_orden: f.numero_orden,
      fecha: f.fecha,
      total: Number(f.total),
      estado: f.estado,
      origen_importacion: aplicacion?.origen ?? null,
      estado_aplicacion: aplicacion?.estado ?? null,
    };
  });

  return {
    facturas,
    total,
    pagina,
    totalPaginas,
    porPagina: FACTURAS_IMPORTADAS_POR_PAGINA,
  };
}
