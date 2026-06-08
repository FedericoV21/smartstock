import { NextResponse } from 'next/server';

import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import { withTesoreriaApi } from '@/lib/tesoreria/api-context';

function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

function etiquetaObligacion(row: Record<string, unknown>): string {
  const comp = row.comprobante as { tipo: string; numero: number | null; fecha: string | null } | null;
  if (comp?.tipo) {
    const tipo = formatearTipoComprobante(comp.tipo);
    if (comp.numero != null) return `${tipo} ${comp.numero}`;
    if (comp.fecha) return `${tipo} · ${formatDate(comp.fecha)}`;
    return tipo;
  }

  const ref = typeof row.referencia === 'string' ? row.referencia.trim() : '';
  if (ref && !esUuid(ref)) return ref;

  if (row.origen === 'import_lista') return 'Importación de lista';

  const venc = typeof row.vencimiento_at === 'string' ? row.vencimiento_at : null;
  if (venc) return `Deuda · vence ${formatDate(venc)}`;

  return `Deuda · ${formatCurrency(Number(row.saldo_pendiente ?? 0))}`;
}

export async function GET(request: Request) {
  return withTesoreriaApi(request, async ({ session, db }) => {
    const url = new URL(request.url);
    const proveedorId = url.searchParams.get('proveedor_id')?.trim();
    if (!proveedorId) {
      return NextResponse.json({ error: 'proveedor_id es obligatorio' }, { status: 400 });
    }

    const { data, error } = await (db as any)
      .from('pago_proveedor_factura')
      .select(
        'id, saldo_pendiente, monto_original, vencimiento_at, estado, origen, referencia, comprobante:comprobante_id(tipo, numero, fecha)',
      )
      .eq('tenant_id', session.tenantId)
      .eq('proveedor_id', proveedorId)
      .gt('saldo_pendiente', 0.001)
      .order('vencimiento_at', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const obligaciones = ((data ?? []) as Array<Record<string, unknown>>).map((o) => {
      const etiqueta = etiquetaObligacion(o);
      return {
        id: String(o.id),
        saldo_pendiente: Number(o.saldo_pendiente),
        referencia: etiqueta,
      };
    });

    return NextResponse.json({ obligaciones });
  });
}
