import jsPDF from 'jspdf';

import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import { formatearNumeroComprobante, formatearTipoComprobante } from './formato';

interface DatosEmisor {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  domicilio: string | null;
  condicion_iva: string;
  punto_de_venta: number;
}

interface DatosCliente {
  nombre: string;
  razon_social: string | null;
  cuit_dni: string | null;
  condicion_iva: string;
  direccion: string | null;
}

interface ItemPDF {
  cantidad: number;
  descripcion: string;
  precio_unitario: number;
  subtotal: number;
  iva_porcentaje?: number | null;
  iva_monto?: number;
}

interface DatosComprobante {
  tipo: string;
  numero: number;
  fecha: string;
  subtotal: number;
  iva_monto: number;
  iva_porcentaje: number;
  total: number;
  notas: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  /** Total de mercadería antes del ajuste por medio de pago (IVA incl. en precios). */
  total_mercaderia?: number | null;
  financiacion_monto?: number | null;
  financiacion_porcentaje?: number | null;
  financiacion_descripcion?: string | null;
}

const CONDICION_IVA_LABELS: Record<string, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
};

function formatCondicionIva(condicion: string): string {
  return CONDICION_IVA_LABELS[condicion] ?? condicion;
}

export function generarPDF(
  emisor: DatosEmisor,
  cliente: DatosCliente,
  comprobante: DatosComprobante,
  items: ItemPDF[],
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // === HEADER ===
  const letra = comprobante.tipo.includes('_a')
    ? 'A'
    : comprobante.tipo.includes('_b')
      ? 'B'
      : comprobante.tipo.includes('_c')
        ? 'C'
        : 'X';

  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(letra, pageWidth / 2, y + 8, { align: 'center' });

  const tipoLabel = formatearTipoComprobante(comprobante.tipo);
  const numeroLabel = formatearNumeroComprobante(
    emisor.punto_de_venta,
    comprobante.numero,
  );

  doc.setFontSize(14);
  doc.text(`${tipoLabel} Nro ${numeroLabel}`, pageWidth / 2, y + 16, {
    align: 'center',
  });

  y += 24;

  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // === DATOS DEL EMISOR ===
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(emisor.razon_social || emisor.nombre, margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  if (emisor.cuit) {
    doc.text(`CUIT: ${emisor.cuit}`, margin, y);
    y += 4;
  }
  if (emisor.domicilio) {
    doc.text(emisor.domicilio, margin, y);
    y += 4;
  }
  doc.text(
    `Condición IVA: ${formatCondicionIva(emisor.condicion_iva)}`,
    margin,
    y,
  );
  y += 4;

  doc.text(`Fecha: ${formatDate(comprobante.fecha)}`, pageWidth - margin, y - 12, {
    align: 'right',
  });

  y += 4;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // === DATOS DEL CLIENTE ===
  doc.setFont('helvetica', 'bold');
  doc.text('Cliente:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(cliente.razon_social || cliente.nombre, margin + 18, y);
  y += 5;
  if (cliente.cuit_dni) {
    doc.text(`CUIT/DNI: ${cliente.cuit_dni}`, margin, y);
    y += 4;
  }
  doc.text(
    `Condición IVA: ${formatCondicionIva(cliente.condicion_iva)}`,
    margin,
    y,
  );
  y += 4;
  if (cliente.direccion) {
    doc.text(cliente.direccion, margin, y);
    y += 4;
  }

  y += 4;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // === TABLA DE ITEMS ===
  // Factura con IVA discriminado: cada línea muestra su alícuota e importe
  // de IVA embebido; en ticket/remito/presupuesto se omiten esas columnas.
  const muestraIvaItem =
    comprobante.iva_monto > 0 &&
    items.some((it) => it.iva_porcentaje != null || it.iva_monto != null);

  const colX = muestraIvaItem
    ? {
        cant: margin,
        desc: margin + 18,
        precio: pageWidth - margin - 88,
        ivaPct: pageWidth - margin - 58,
        ivaMonto: pageWidth - margin - 38,
        subtotal: pageWidth - margin - 10,
      }
    : {
        cant: margin,
        desc: margin + 20,
        precio: pageWidth - margin - 60,
        ivaPct: pageWidth - margin - 60,
        ivaMonto: pageWidth - margin - 60,
        subtotal: pageWidth - margin - 10,
      };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Cant.', colX.cant, y);
  doc.text('Descripción', colX.desc, y);
  doc.text('P. Unit.', colX.precio, y, { align: 'right' });
  if (muestraIvaItem) {
    doc.text('IVA %', colX.ivaPct, y, { align: 'right' });
    doc.text('IVA', colX.ivaMonto, y, { align: 'right' });
  }
  doc.text('Subtotal', colX.subtotal, y, { align: 'right' });
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  for (const item of items) {
    if (y > 250) {
      doc.addPage();
      y = margin;
    }

    doc.text(String(item.cantidad), colX.cant, y);
    doc.text(
      item.descripcion.substring(0, muestraIvaItem ? 38 : 50),
      colX.desc,
      y,
    );
    doc.text(formatCurrency(item.precio_unitario), colX.precio, y, {
      align: 'right',
    });
    if (muestraIvaItem) {
      const rate = item.iva_porcentaje;
      const iva = item.iva_monto ?? 0;
      doc.text(rate != null ? `${rate}%` : '-', colX.ivaPct, y, {
        align: 'right',
      });
      doc.text(formatCurrency(iva), colX.ivaMonto, y, { align: 'right' });
    }
    doc.text(formatCurrency(item.subtotal), colX.subtotal, y, {
      align: 'right',
    });
    y += 5;
  }

  y += 3;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // === TOTALES ===
  const totalesX = pageWidth - margin;

  doc.setFontSize(10);
  doc.text('Subtotal:', totalesX - 50, y);
  doc.text(formatCurrency(comprobante.subtotal), totalesX, y, {
    align: 'right',
  });
  y += 5;

  if (comprobante.iva_monto > 0) {
    doc.text(`IVA (${comprobante.iva_porcentaje}%):`, totalesX - 50, y);
    doc.text(formatCurrency(comprobante.iva_monto), totalesX, y, {
      align: 'right',
    });
    y += 5;
  }

  const tm = comprobante.total_mercaderia;
  const fm = comprobante.financiacion_monto;

  if (tm != null && fm != null && Math.abs(fm) > 0.001) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const pct = comprobante.financiacion_porcentaje;
    const pctLabel = pct != null && !Number.isNaN(pct) ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : '';
    const desc = (comprobante.financiacion_descripcion ?? '').trim();

    if (fm < 0) {
      doc.text('Total mercadería:', totalesX - 50, y);
      doc.text(formatCurrency(tm), totalesX, y, { align: 'right' });
      y += 5;
    }

    const etiqueta = fm < 0 ? `Descuento financiero${pctLabel}` : `Recargo financiero${pctLabel}`;
    const detalle = desc ? `${etiqueta}: ${desc}` : etiqueta;
    doc.text(detalle, totalesX - 50, y, { maxWidth: totalesX - margin - 5 });
    doc.text(formatCurrency(fm), totalesX, y, { align: 'right' });
    y += Math.max(5, desc.length > 42 ? 10 : 5);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL A PAGAR:', totalesX - 50, y);
  doc.text(formatCurrency(comprobante.total), totalesX, y, { align: 'right' });
  y += 8;

  // === CAE (si tiene) ===
  if (comprobante.cae) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`CAE: ${comprobante.cae}`, margin, y);
    y += 4;
    if (comprobante.cae_vencimiento) {
      doc.text(
        `Vencimiento CAE: ${formatDate(comprobante.cae_vencimiento)}`,
        margin,
        y,
      );
      y += 6;
    }
  }

  // === NOTAS ===
  if (comprobante.notas) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text(`Obs: ${comprobante.notas}`, margin, y);
  }

  return doc;
}
