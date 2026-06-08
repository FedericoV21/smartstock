type Db = {
  from: (table: string) => any;
};

function agendaProductName(nombre: string): string {
  const n = nombre.trim() || 'Agenda';
  return `Turno - ${n}`.slice(0, 200);
}

export async function ensureAgendaServiceProduct(
  db: Db,
  opts: {
    tenantId: string;
    sucursalId: string;
    agendaId: string;
    productoId?: string | null;
    nombre: string;
    precio: number;
    ivaPorcentaje?: number | null;
  },
): Promise<{ ok: true; productoId: string } | { ok: false; error: string }> {
  const precio = Number.isFinite(opts.precio) && opts.precio >= 0 ? Math.round(opts.precio * 100) / 100 : 0;
  const payload = {
    tenant_id: opts.tenantId,
    sucursal_id: opts.sucursalId,
    codigo: `TURNO-${opts.agendaId.slice(0, 8).toUpperCase()}`,
    nombre: agendaProductName(opts.nombre),
    descripcion: 'Servicio interno generado por el modulo de turnos',
    unidad: 'unidad',
    precio_costo: 0,
    precio_venta: precio,
    stock_actual: 0,
    stock_minimo: 0,
    iva_porcentaje: opts.ivaPorcentaje ?? 21,
    porcentaje_ganancia: 0,
    activo: true,
    es_servicio: true,
  };

  if (opts.productoId) {
    const { data, error } = await db
      .from('producto')
      .update(payload)
      .eq('id', opts.productoId)
      .eq('tenant_id', opts.tenantId)
      .select('id')
      .maybeSingle();
    if (!error && data?.id) return { ok: true, productoId: data.id };
  }

  const { data, error } = await db
    .from('producto')
    .insert(payload)
    .select('id')
    .single();
  if (error || !data?.id) {
    return { ok: false, error: error?.message ?? 'No se pudo crear el servicio de la agenda' };
  }
  return { ok: true, productoId: data.id };
}
