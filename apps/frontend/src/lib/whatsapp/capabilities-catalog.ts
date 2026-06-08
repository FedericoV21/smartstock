export type WhatsAppCapabilityChannel = 'sandbox' | 'live';

export type WhatsAppModuleFlags = {
  facturador_simple?: boolean;
  stock?: boolean;
  facturador_pos?: boolean;
  analizador_rentabilidad?: boolean;
  lector_facturas?: boolean;
  importador_excel?: boolean;
};

export type WhatsAppCapabilitySection = {
  id: string;
  title: string;
  lines: string[];
  examples: string[];
};

export type WhatsAppCapabilitiesCatalog = {
  sections: WhatsAppCapabilitySection[];
  footer: string;
};

function canTransact(rolWhatsapp: string): boolean {
  const r = rolWhatsapp.trim().toLowerCase();
  return r !== 'readonly' && r !== 'visor';
}

function canAdjustStock(rolWhatsapp: string): boolean {
  const r = rolWhatsapp.trim().toLowerCase();
  return r === 'admin' || r === 'owner';
}

export function buildWhatsAppCapabilitiesCatalog(params: {
  modules: WhatsAppModuleFlags;
  rolWhatsapp: string;
  channel: WhatsAppCapabilityChannel;
}): WhatsAppCapabilitiesCatalog {
  const { modules, rolWhatsapp, channel } = params;
  const sections: WhatsAppCapabilitySection[] = [];
  const transact = canTransact(rolWhatsapp);

  const consultas: string[] = [];
  const consultaExamples: string[] = [];

  if (modules.facturador_simple) {
    consultas.push('Ventas, resumen, ganancias, medios de pago, comparativo vs mes anterior');
    consultas.push('Deuda y extracto de clientes; ranking de clientes');
    consultas.push('Recibos y libro IVA (si tenés rentabilidad)');
    consultaExamples.push('ventas hoy', 'resumen del mes', 'cuanto me debe Juan Perez');
  }
  if (modules.stock) {
    consultas.push('Stock por producto, stock bajo, vencimientos, deuda proveedores');
    consultaExamples.push('stock de yerba playadito', 'stock bajo', 'deuda proveedores');
  }
  if (modules.facturador_pos) {
    consultas.push('Ventas POS por caja u operador');
    consultaExamples.push('ventas POS hoy', 'tickets pos caja mostrador');
  }
  if (modules.facturador_simple) {
    consultas.push('Cierre de caja / arqueo (solo consulta)');
    consultaExamples.push('cierre de caja hoy');
  }

  if (consultas.length > 0) {
    sections.push({
      id: 'consultas',
      title: 'Consultas',
      lines: consultas,
      examples: consultaExamples.slice(0, 4),
    });
  }

  if (transact) {
    const actionLines: string[] = [];
    const actionExamples: string[] = [];
    if (modules.stock) {
      actionLines.push('Pago a proveedor en cuenta corriente');
      actionExamples.push('registrar pago proveedor Arcor 50000');
      if (canAdjustStock(rolWhatsapp)) {
        actionLines.push('Ajuste de stock (solo admin/owner)');
        actionExamples.push('ajustar stock Yerba Playadito +10');
      }
    }
    if (modules.facturador_simple) {
      actionLines.push('Cobro a cliente o cobro por factura');
      actionExamples.push('registrar cobro cliente Juan 15000', 'cobrar factura 42 cliente Juan 5000');
    }
    if (actionLines.length > 0) {
      sections.push({
        id: 'acciones',
        title: 'Acciones (confirmación SI + código)',
        lines: actionLines,
        examples: actionExamples.slice(0, 3),
      });
    }
  }

  const invoiceModule =
    modules.lector_facturas || modules.facturador_simple || modules.importador_excel;
  if (invoiceModule && transact) {
    sections.push({
      id: 'facturas',
      title: channel === 'live' ? 'Facturas (adjunto por WhatsApp)' : 'Facturas (sandbox)',
      lines: [
        'Enviá PDF o foto de factura de proveedor',
        'Revisá pendientes: revisar, buscar 1 texto, enlazar 1 2',
        'Confirmá con SI + código del resumen',
      ],
      examples: ['revisar', 'buscar 1 yerba', 'SI 1234'],
    });
  }

  if (channel === 'live') {
    sections.push({
      id: 'voz',
      title: 'Notas de voz',
      lines: ['Enviá un audio y lo transcribo para consultar o actuar como texto'],
      examples: ['ventas hoy', 'stock bajo'],
    });
  }

  const footer =
    sections.length > 0
      ? 'Escribí ayuda para ver este menú o un ejemplo concreto (ej. ventas hoy).'
      : 'No hay módulos activos para el asistente en este negocio.';

  return { sections, footer };
}

export async function loadWhatsAppCapabilitiesCatalog(params: {
  db: any;
  tenantId: string;
  rolWhatsapp?: string | null;
  channel?: WhatsAppCapabilityChannel;
}): Promise<WhatsAppCapabilitiesCatalog> {
  const { data, error } = await params.db
    .from('modulo_config')
    .select('stock, facturador_simple, facturador_pos, analizador_rentabilidad, lector_facturas, importador_excel')
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return buildWhatsAppCapabilitiesCatalog({
    modules: {
      facturador_simple: Boolean(row.facturador_simple),
      stock: Boolean(row.stock),
      facturador_pos: Boolean(row.facturador_pos),
      analizador_rentabilidad: Boolean(row.analizador_rentabilidad),
      lector_facturas: Boolean(row.lector_facturas),
      importador_excel: Boolean(row.importador_excel),
    },
    rolWhatsapp: params.rolWhatsapp ?? 'operador',
    channel: params.channel ?? 'live',
  });
}

export function formatCapabilitiesForWhatsApp(catalog: WhatsAppCapabilitiesCatalog): string {
  const lines: string[] = [];
  for (const section of catalog.sections) {
    lines.push(`${section.title}:`);
    for (const line of section.lines) {
      lines.push(`• ${line}`);
    }
    if (section.examples.length > 0) {
      lines.push(`Ej: ${section.examples.join(' · ')}`);
    }
    lines.push('');
  }
  lines.push(catalog.footer.trim());
  return lines.filter(Boolean).join('\n').trim();
}
