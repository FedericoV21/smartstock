export type CopyModule = 'arca' | 'stock' | 'importador' | 'pos' | 'auth' | 'general';

type Rule = {
  test: RegExp;
  message: string;
};

const DEFAULT_COPY: Record<CopyModule, string> = {
  arca: 'No pudimos completar la gestión fiscal en este momento. Reintentá en unos minutos.',
  stock: 'No pudimos completar el movimiento de stock. Revisá los datos y probá de nuevo.',
  importador: 'No pudimos procesar la importación en este momento. Probá de nuevo en unos minutos.',
  pos: 'No pudimos completar la operación en caja. Revisá la conexión y reintentá.',
  auth: 'No pudimos validar tu acceso en este momento. Probá de nuevo.',
  general: 'No pudimos completar la operación en este momento. Probá de nuevo.',
};

const RULES_BY_MODULE: Record<CopyModule, Rule[]> = {
  arca: [
    {
      test: /(certificad|token|wsaa|firma|cms)/i,
      message: 'La configuración fiscal del certificado no está disponible. Revisala en Configuración > ARCA.',
    },
    {
      test: /(cuit|doc|documento|10015|10016)/i,
      message: 'El CUIT o DNI informado no pasó la validación fiscal. Revisá el dato y volvé a intentar.',
    },
    {
      test: /(cae|sin_cae|sin cae)/i,
      message: 'ARCA no devolvió el CAE todavía. El comprobante quedó pendiente para reintento.',
    },
    {
      test: /(timeout|network|fetch failed|econn|socket|offline)/i,
      message: 'No hubo respuesta de ARCA a tiempo. Reintentá en unos minutos.',
    },
  ],
  stock: [
    {
      test: /stock insuficiente/i,
      message: 'No hay stock suficiente para completar esta salida.',
    },
    {
      test: /(producto no encontrado|not found)/i,
      message: 'No encontramos el producto seleccionado. Actualizá la pantalla y probá de nuevo.',
    },
    {
      test: /(cantidad.*mayor.*0|cantidad.*invalida)/i,
      message: 'La cantidad debe ser mayor a cero.',
    },
    {
      test: /(sucursal|permiso|forbidden|unauthorized)/i,
      message: 'No tenés permisos para operar en esa sucursal.',
    },
    {
      test: /(usa_variantes|variantes|variante)/i,
      message: 'Este producto trabaja con variantes. Seleccioná una variante para continuar.',
    },
  ],
  importador: [
    {
      test: /(json|parse|unexpected token)/i,
      message: 'No pudimos leer la respuesta del servidor. Reintentá la importación.',
    },
    {
      test: /(archivo|pdf|mime|formato)/i,
      message: 'El archivo no tiene un formato válido para importar. Usá un PDF con texto seleccionable.',
    },
    {
      test: /(size|too large|payload|413)/i,
      message: 'El archivo supera el tamaño permitido. Probá con un archivo más liviano.',
    },
    {
      test: /(timeout|network|fetch failed|offline|econn)/i,
      message: 'No pudimos conectar con el servidor de importación. Revisá tu conexión y reintentá.',
    },
    {
      test: /(fila|column|columna|headers?)/i,
      message: 'No pudimos interpretar algunas columnas del archivo. Revisá el mapeo y probá de nuevo.',
    },
  ],
  pos: [
    {
      test: /(afip|arca|cae)/i,
      message: 'La venta se registró, pero la autorización fiscal quedó pendiente. Revisala en Centro de errores.',
    },
    {
      test: /(pago|terminal|mp|point|qr)/i,
      message: 'No se pudo confirmar el cobro con el medio de pago seleccionado. Reintentá la operación.',
    },
    {
      test: /(respuesta invalida|invalid response|parse)/i,
      message: 'Recibimos una respuesta incompleta del servidor. Reintentá la venta.',
    },
    {
      test: /(timeout|network|fetch failed|offline)/i,
      message: 'Se perdió la conexión durante el cobro. Verificá la red y reintentá.',
    },
  ],
  auth: [
    {
      test: /(invalid login credentials|invalid_credentials)/i,
      message: 'El correo o la contraseña no coinciden.',
    },
    {
      test: /(rate limit|too many requests|over_email_send|once every \d+ seconds?|email rate limit)/i,
      message:
        'Llegaste al límite de envíos de correo. Esperá al menos 1 minuto antes de pedir otro código.',
    },
    {
      test: /(email not confirmed|otp expired|invalid otp|token has expired|access_denied)/i,
      message: 'Tu verificación venció o no es válida. Pedí un código nuevo para continuar.',
    },
    {
      test: /(already registered|already exists|user already)/i,
      message: 'Ese correo ya está registrado. Iniciá sesión o recuperá tu contraseña.',
    },
    {
      test: /(weak password|password)/i,
      message: 'La contraseña no cumple los requisitos mínimos de seguridad.',
    },
    {
      test: /(timeout|network|fetch failed|offline|econn)/i,
      message: 'No pudimos validar el acceso por un problema de conexión. Reintentá en unos minutos.',
    },
  ],
  general: [],
};

const TECHNICAL_HINTS = [
  'stack',
  'exception',
  'trace',
  'sql',
  'syntaxerror',
  'typeerror',
  'referenceerror',
  'supabase',
  'postgres',
  'rpc',
  'at ',
];

function normalizeCopy(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const collapsedMarks = trimmed.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');
  const looksShouting =
    collapsedMarks.length >= 8 &&
    collapsedMarks === collapsedMarks.toUpperCase() &&
    /[A-ZÁÉÍÓÚÑ]/.test(collapsedMarks);

  if (!looksShouting) return collapsedMarks;

  const lower = collapsedMarks.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isTechnicalLeak(raw: string): boolean {
  const lower = raw.toLowerCase();
  return TECHNICAL_HINTS.some((hint) => lower.includes(hint));
}

export function userFacingErrorCopy(
  moduleName: CopyModule,
  rawError: unknown,
  fallback?: string,
): string {
  const raw = typeof rawError === 'string' ? rawError.trim() : '';
  const moduleRules = RULES_BY_MODULE[moduleName] ?? [];
  const allRules = moduleRules.concat(RULES_BY_MODULE.general);

  if (raw) {
    for (const rule of allRules) {
      if (rule.test.test(raw)) return rule.message;
    }
  }

  if (raw && !isTechnicalLeak(raw)) return normalizeCopy(raw);

  return fallback ?? DEFAULT_COPY[moduleName] ?? DEFAULT_COPY.general;
}

export function apiErrorPayload(
  moduleName: CopyModule,
  rawError: unknown,
  fallback?: string,
): { error: string } {
  return { error: userFacingErrorCopy(moduleName, rawError, fallback) };
}
