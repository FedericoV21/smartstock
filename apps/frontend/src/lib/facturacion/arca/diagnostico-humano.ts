type DiagnosticoBase = {
  titulo: string;
  recomendacion: string;
  transitorio?: boolean;
};

const MAPA_DIAGNOSTICOS: Record<string, DiagnosticoBase> = {
  '10015': {
    titulo: 'Documento del receptor inválido',
    recomendacion: 'Revisá CUIT/DNI del cliente y volvé a autorizar.',
  },
  '10016': {
    titulo: 'Numeración o fecha fuera de secuencia AFIP',
    recomendacion: 'Sincronizá numeración ARCA y confirmá la fecha del comprobante.',
  },
  '10017': {
    titulo: 'Punto de venta no habilitado',
    recomendacion: 'Verificá punto de venta y ambiente (homologación/producción) en ARCA.',
  },
  '10040': {
    titulo: 'CUIT emisor no autorizado',
    recomendacion: 'Validá certificado, CUIT del emisor y habilitación fiscal en ARCA.',
  },
  '10042': {
    titulo: 'Tipo de comprobante no permitido',
    recomendacion: 'Confirmá tipo de comprobante y condición fiscal del cliente.',
  },
  '10068': {
    titulo: 'Fecha de comprobante inválida',
    recomendacion: 'Usá fecha actual o posterior al último comprobante autorizado.',
  },
  '10074': {
    titulo: 'Comprobante asociado inválido',
    recomendacion: 'Revisá tipo, punto de venta y número del comprobante asociado.',
  },
  '10084': {
    titulo: 'Importes inconsistentes',
    recomendacion: 'Revisá neto, IVA y total para que coincidan con el desglose.',
  },
  '10093': {
    titulo: 'Alicuotas de IVA inconsistentes',
    recomendacion: 'Corroborá IVA por ítem y su total en el comprobante.',
  },
  '10242': {
    titulo: 'Certificado o ticket de acceso inválido',
    recomendacion: 'Renová certificado/ticket WSAA y reintentá.',
  },
  NETWORK: {
    titulo: 'ARCA no respondió por red',
    recomendacion: 'Esperá unos minutos y reintentá autorización.',
    transitorio: true,
  },
  MAX_REINTENTOS: {
    titulo: 'Se agotaron los reintentos automáticos',
    recomendacion: 'Corregí datos fiscales y reintentá manualmente.',
  },
  SIN_CAE: {
    titulo: 'Comprobante sin CAE válido',
    recomendacion: 'Reintentá autorización para obtener CAE de 14 dígitos.',
  },
};

function limpiarCodigo(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw || null;
}

export function diagnosticoHumanoArca(
  codigo: string | null | undefined,
  mensajeTecnico: string | null | undefined,
): {
  codigo: string | null;
  titulo: string;
  detalleTecnico: string | null;
  recomendacion: string;
  transitorio: boolean;
} {
  const cod = limpiarCodigo(codigo);
  const base = cod ? MAPA_DIAGNOSTICOS[cod] : null;
  const detalle = String(mensajeTecnico ?? '').trim() || null;

  if (base) {
    return {
      codigo: cod,
      titulo: base.titulo,
      detalleTecnico: detalle,
      recomendacion: base.recomendacion,
      transitorio: Boolean(base.transitorio),
    };
  }

  const normalizado = String(mensajeTecnico ?? '').toLowerCase();
  if (
    normalizado.includes('timeout') ||
    normalizado.includes('econn') ||
    normalizado.includes('fetch failed') ||
    normalizado.includes('network')
  ) {
    return {
      codigo: cod,
      titulo: 'Falla temporal de conexión con ARCA',
      detalleTecnico: detalle,
      recomendacion: 'Probá de nuevo en unos minutos; suele resolverse solo.',
      transitorio: true,
    };
  }

  return {
    codigo: cod,
    titulo: 'Error fiscal pendiente de revisión',
    detalleTecnico: detalle,
    recomendacion: 'Abrí el comprobante, corregí datos fiscales y reintentá autorización.',
    transitorio: false,
  };
}
