export type ItemImporteComprobante = {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje?: number | null;
};

export type ImportesComprobante = {
  subtotal: number;
  iva_porcentaje: number;
  iva_monto: number;
  total: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function discriminaIva(tipo: string): boolean {
  return (
    tipo === 'factura_a' ||
    tipo === 'factura_b' ||
    tipo === 'nota_credito_a' ||
    tipo === 'nota_credito_b'
  );
}

export function calcularImportesComprobante(
  items: ItemImporteComprobante[],
  tipoComprobante: string,
  ivaDefault: number = 21,
  precioNetoEnLineas = true,
): ImportesComprobante {
  const grupos = new Map<number, number>();

  for (const item of items) {
    const rate = item.iva_porcentaje ?? ivaDefault;
    let lineSub = round2(item.cantidad * item.precio_unitario);
    if (!precioNetoEnLineas && discriminaIva(tipoComprobante) && rate > 0) {
      lineSub = round2(lineSub / (1 + rate / 100));
    }
    grupos.set(rate, round2((grupos.get(rate) ?? 0) + lineSub));
  }

  if (!discriminaIva(tipoComprobante)) {
    const subtotal = round2([...grupos.values()].reduce((s, v) => s + v, 0));
    return { subtotal, iva_porcentaje: ivaDefault, iva_monto: 0, total: subtotal };
  }

  let subtotalNeto = 0;
  let ivaMonto = 0;
  let rateDominante = ivaDefault;
  let maxIva = -1;

  for (const [rate, neto] of grupos) {
    subtotalNeto = round2(subtotalNeto + neto);
    const ivaLine = round2((Math.round(neto * 100) * rate) / 10000);
    ivaMonto = round2(ivaMonto + ivaLine);
    if (ivaLine > maxIva) {
      maxIva = ivaLine;
      rateDominante = rate;
    }
  }

  return {
    subtotal: subtotalNeto,
    iva_porcentaje: rateDominante,
    iva_monto: ivaMonto,
    total: round2(subtotalNeto + ivaMonto),
  };
}

export function importesPreferiendoTotalInformado(
  importes: ImportesComprobante,
  totalInformado: number | null,
): ImportesComprobante {
  if (totalInformado == null || !Number.isFinite(totalInformado)) return importes;
  const total = round2(Math.max(0, totalInformado));
  if (Math.abs(total - importes.total) <= 0.02) return importes;

  const esFacturaA =
    importes.iva_monto > 0 && importes.subtotal > 0 && importes.total > importes.subtotal;
  if (esFacturaA && importes.subtotal > 0) {
    const ivaMonto = round2(total - importes.subtotal);
    return {
      ...importes,
      iva_monto: Math.max(0, ivaMonto),
      total,
      iva_porcentaje:
        importes.subtotal > 0 ? round2((ivaMonto * 100) / importes.subtotal) : importes.iva_porcentaje,
    };
  }

  return { ...importes, subtotal: total, iva_monto: 0, total };
}
