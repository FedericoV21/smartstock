import {
  formatCapabilitiesForWhatsApp,
  type WhatsAppCapabilitiesCatalog,
} from '@/lib/whatsapp/capabilities-catalog';

type ResponseTone = 'clarify' | 'resolve' | 'confirm' | 'report' | 'error';

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function composeNaturalReply(params: {
  tone: ResponseTone;
  title?: string | null;
  body: string;
  nextStep?: string | null;
  examples?: string[];
}): string {
  const { tone, title, body, nextStep, examples } = params;
  const lines: string[] = [];

  if (title) lines.push(compact(title));
  lines.push(compact(body));

  if (Array.isArray(examples) && examples.length > 0) {
    const clean = examples.map((x) => compact(x)).filter(Boolean).slice(0, 3);
    if (clean.length > 0) {
      if (tone === 'clarify') {
        lines.push(`Ejemplos: ${clean.join(' · ')}`);
      } else {
        lines.push(`Si querés, podés pedir: ${clean.join(' · ')}`);
      }
    }
  }

  if (nextStep) lines.push(compact(nextStep));
  return lines.filter(Boolean).join('\n');
}

export function composeUnknownCatalogReply(catalog?: WhatsAppCapabilitiesCatalog): string {
  if (catalog && catalog.sections.length > 0) {
    return formatCapabilitiesForWhatsApp(catalog);
  }
  return composeNaturalReply({
    tone: 'clarify',
    body:
      'Puedo ayudarte con stock y productos, deuda de clientes o proveedores, datos de contacto de clientes y reportes del negocio.',
    examples: [
      'ventas hoy',
      'resumen del mes',
      'vencimientos',
      'ventas POS hoy',
      'stock de Yerba Playadito 1kg',
    ],
  });
}

export function composeGreetingReply(catalog: WhatsAppCapabilitiesCatalog): string {
  return composeNaturalReply({
    tone: 'resolve',
    title: 'Hola, soy el asistente de SmartStock.',
    body: 'Puedo consultar tu negocio y, si tenés permisos, registrar pagos, cobros o cargar facturas.',
    nextStep: 'Escribí ayuda para ver todo lo que puedo hacer.',
    examples: catalog.sections[0]?.examples.slice(0, 2) ?? ['ventas hoy', 'ayuda'],
  });
}

export function composeHelpReply(catalog: WhatsAppCapabilitiesCatalog): string {
  return formatCapabilitiesForWhatsApp(catalog);
}

export function composeExamplesReply(catalog: WhatsAppCapabilitiesCatalog): string {
  const examples = catalog.sections.flatMap((s) => s.examples).slice(0, 6);
  return composeNaturalReply({
    tone: 'clarify',
    title: 'Ejemplos que podés probar:',
    body: examples.length > 0 ? examples.map((e) => `• ${e}`).join('\n') : '• ventas hoy\n• stock bajo',
    nextStep: catalog.footer,
  });
}

export function composeAmbiguousDebtScopeReply(targetName: string | null): string {
  if (targetName) {
    return composeNaturalReply({
      tone: 'clarify',
      body: `Para darte un dato exacto de "${targetName}", necesito saber si hablamos de clientes o proveedores.`,
      nextStep: 'Decime "cliente" o "proveedor" y sigo con eso.',
    });
  }
  return composeNaturalReply({
    tone: 'clarify',
    body: '¿Querés ver deuda de clientes (te deben) o deuda con proveedores (vos debés)?',
    nextStep: 'Si querés, también te paso un reporte general de cualquiera de los dos.',
  });
}

export function composeMissingTargetReply(intent: string): string {
  const n = normalize(intent);
  if (n === 'cliente_contacto') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Para consultar datos de contacto necesito el nombre exacto del cliente.',
      examples: ['telefono cliente Juan Perez', 'email de cliente Kiosco Centro'],
    });
  }
  if (n === 'proveedor_contacto') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Para consultar datos de contacto necesito el nombre exacto del proveedor.',
      examples: ['telefono proveedor Arcor', 'email de proveedor GinkGo'],
    });
  }
  if (n === 'proveedor_deuda') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Para consultar deuda de proveedores necesito el nombre exacto.',
      examples: ['cuánto le debo a proveedor Acme', 'deuda proveedor Arcor'],
    });
  }
  if (n === 'cliente_deuda') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Para consultar deuda de clientes necesito el nombre exacto.',
      examples: ['cuánto me debe cliente Juan', 'deuda cliente Kiosco Centro'],
    });
  }
  if (n === 'cliente_extracto_cc') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Para el extracto de cuenta corriente necesito el nombre exacto del cliente.',
      examples: [
        'extracto cuenta corriente Juan Perez',
        'movimientos cuenta corriente Kiosco Centro',
      ],
    });
  }
  return composeNaturalReply({
    tone: 'clarify',
    body: 'Para stock necesito un producto concreto por nombre o código.',
    examples: ['stock de Yerba Playadito 1kg', 'stock de PRD-1010'],
  });
}

export function composeGenericTargetReply(intent: string): string {
  const n = normalize(intent);
  if (n === 'cliente_contacto') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Entendi la consulta, pero me falta el cliente puntual para darte sus datos de contacto.',
      examples: ['telefono de cliente Juan Perez', 'datos de contacto de Kiosco Centro'],
    });
  }
  if (n === 'proveedor_contacto') {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Entendi la consulta, pero me falta el proveedor puntual para darte sus datos de contacto.',
      examples: ['telefono de proveedor Arcor', 'datos de contacto de GinkGo'],
    });
  }
  if (n.includes('proveedor')) {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Entendí la consulta, pero me falta el proveedor puntual para darte un monto real.',
      examples: ['deuda proveedor Acme', 'cuánto le debo a proveedor Arcor'],
    });
  }
  if (n.includes('extracto') || n.includes('movimientos') || n.includes('historial')) {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Entendi la consulta, pero me falta el cliente puntual para armar el extracto de cuenta corriente.',
      examples: [
        'extracto cuenta corriente Juan Perez',
        'movimientos cc Kiosco Centro',
      ],
    });
  }
  if (n.includes('cliente')) {
    return composeNaturalReply({
      tone: 'clarify',
      body: 'Entendí la consulta, pero me falta el cliente puntual para darte un saldo real.',
      examples: ['deuda cliente Juan Perez', 'cuánto me debe cliente Kiosco Centro'],
    });
  }
  return composeNaturalReply({
    tone: 'clarify',
    body: 'Para responder bien necesito el producto puntual (nombre o código).',
    examples: ['stock de Coca Cola 2.25L', 'stock de COD-1002'],
  });
}

export function composeReportScopeReply(): string {
  return composeNaturalReply({
    tone: 'clarify',
    body: 'Perfecto, ¿qué tipo de reporte querés que te pase?',
    examples: [
      'ventas de hoy',
      'resumen del mes',
      'recibos del mes',
      'libro IVA',
      'vencimientos',
    ],
  });
}
