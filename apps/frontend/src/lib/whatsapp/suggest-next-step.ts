import type { WhatsAppCapabilitiesCatalog } from '@/lib/whatsapp/capabilities-catalog';

const REPORT_INTENTS = new Set([
  'cliente_deuda',
  'proveedor_deuda',
  'cliente_extracto_cc',
  'stock_producto',
  'stock_mas_bajo',
  'reporte_stock_general',
  'reporte_stock_bajo',
  'reporte_deuda_clientes',
  'reporte_deuda_proveedores',
  'reporte_ventas',
  'reporte_ventas_productos',
  'reporte_ventas_clientes',
  'reporte_ganancias',
  'reporte_medios_pago',
  'reporte_comparativo_ventas',
  'reporte_resumen',
]);

function catalogHasSection(catalog: WhatsAppCapabilitiesCatalog | undefined, id: string): boolean {
  return Boolean(catalog?.sections.some((s) => s.id === id));
}

/**
 * Sugiere un único siguiente paso tras reportes/consultas frecuentes (V2).
 * Máximo una línea; sin datos inventados.
 */
export function suggestNextStep(
  intent: string,
  catalog?: WhatsAppCapabilitiesCatalog | null,
): string | null {
  if (!REPORT_INTENTS.has(intent)) return null;

  switch (intent) {
    case 'cliente_deuda':
    case 'cliente_extracto_cc':
      return 'Tip: preguntame "y su saldo" del mismo cliente o "extracto cc de ...".';
    case 'proveedor_deuda':
      return 'Tip: preguntame "y su saldo" del mismo proveedor o "deuda proveedores".';
    case 'stock_producto':
    case 'stock_mas_bajo':
      if (catalogHasSection(catalog ?? undefined, 'consultas')) {
        return 'Tip: podes pedir "stock bajo" o "deuda proveedores".';
      }
      return null;
    case 'reporte_stock_bajo':
      return 'Tip: podes pedir stock de un producto por nombre.';
    case 'reporte_deuda_clientes':
      return 'Tip: decime el nombre del cliente para ver su deuda puntual.';
    case 'reporte_deuda_proveedores':
      return 'Tip: decime el proveedor para ver cuanto le debes.';
    case 'reporte_ventas':
    case 'reporte_resumen':
      return 'Tip: podes pedir "productos mas vendidos" o "ganancia este mes".';
    case 'reporte_ventas_productos':
      return 'Tip: podes pedir "clientes que mas compraron" o ventas por articulo.';
    case 'reporte_ventas_clientes':
      return 'Tip: podes pedir deuda de un cliente o "ventas hoy".';
    case 'reporte_ganancias':
      return 'Tip: podes pedir "medios de pago" o comparativo vs mes anterior.';
    case 'reporte_medios_pago':
      return 'Tip: podes pedir "ventas hoy" o resumen del mes.';
    case 'reporte_comparativo_ventas':
      return 'Tip: podes pedir ventas de un mes concreto, ej. "ventas mayo".';
    case 'reporte_stock_general':
      return 'Tip: podes pedir "stock bajo" o stock de un producto.';
    default:
      return null;
  }
}

export function appendSuggestNextStep(params: {
  reply: string;
  intent: string;
  catalog?: WhatsAppCapabilitiesCatalog | null;
  enabled?: boolean;
}): string {
  if (params.enabled === false) return params.reply;
  const body = params.reply.trim();
  if (!body || body.length > 700 || /pdf\s+completo:/i.test(body)) return params.reply;
  const hint = suggestNextStep(params.intent, params.catalog);
  if (!hint) return params.reply;
  if (body.toLowerCase().includes(hint.slice(0, 20).toLowerCase())) return params.reply;
  return `${body}\n\n${hint}`;
}
