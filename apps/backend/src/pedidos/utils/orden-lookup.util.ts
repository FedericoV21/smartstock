const PREFIJO_TIPO: Record<string, string> = {
  factura_a: 'FA',
  factura_b: 'FB',
  factura_c: 'FC',
  nota_credito_a: 'NCA',
  nota_credito_b: 'NCB',
  nota_credito_c: 'NCC',
  ticket: 'T',
  presupuesto: 'P',
  remito: 'R',
  devolucion_remito: 'DR',
  recibo: 'RC',
};

export type DocumentoOrden = {
  id: string;
  tipo: string;
  numero: number | null;
  numero_formateado: string;
  fecha: string;
  estado: string;
  total: number;
  url_detalle: string;
};

export function urlDetalleOrden(tipo: string, id: string): string {
  if (tipo === 'pedido') return `/pedidos/${id}`;
  if (tipo === 'presupuesto') return `/presupuestos/${id}`;
  return `/facturacion/${id}`;
}

export function numeroFormateadoDocumento(row: {
  tipo: string;
  numero?: number | null;
  id: string;
}): string {
  if (row.tipo === 'pedido') {
    return `PED-${row.id.slice(0, 8).toUpperCase()}`;
  }
  if (row.numero != null) {
    const pref = PREFIJO_TIPO[row.tipo] ?? '';
    return pref ? `${pref}-${String(row.numero).padStart(8, '0')}` : String(row.numero).padStart(8, '0');
  }
  return row.id.slice(0, 8).toUpperCase();
}

export function mapComprobanteADocumento(c: {
  id: string;
  tipo: string;
  numero: number | null;
  fecha: string;
  estado: string;
  total: string | number;
}): DocumentoOrden {
  return {
    id: c.id,
    tipo: c.tipo,
    numero: c.numero ?? null,
    numero_formateado: numeroFormateadoDocumento({
      tipo: c.tipo,
      numero: c.numero,
      id: c.id,
    }),
    fecha: c.fecha,
    estado: c.estado,
    total: Number(c.total ?? 0),
    url_detalle: urlDetalleOrden(c.tipo, c.id),
  };
}

export function mapPedidoADocumento(p: {
  id: string;
  estado: string;
  fecha: string;
  total: string | number;
}): DocumentoOrden {
  return {
    id: p.id,
    tipo: 'pedido',
    numero: null,
    numero_formateado: numeroFormateadoDocumento({ tipo: 'pedido', id: p.id }),
    fecha: p.fecha,
    estado: p.estado,
    total: Number(p.total ?? 0),
    url_detalle: urlDetalleOrden('pedido', p.id),
  };
}
