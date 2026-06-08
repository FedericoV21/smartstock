import {
  ejecutarMatching,
  type ProductoCatalogo,
} from '../../analyzer/price-lists/utils/lista-matching.util';
import { facturaItemsAMatcheables, type FacturaGeminiPayload } from './factura-extraccion.util';

export type FacturaItemMatch = {
  producto_id: string | null;
  confidence: number;
  metodo: string;
  producto_nombre: string | null;
};

export function matchearItemsFactura(
  items: FacturaGeminiPayload['items'],
  catalogo: ProductoCatalogo[],
): Map<string, FacturaItemMatch> {
  const matcheables = facturaItemsAMatcheables(items).map((m) => ({
    id: m.id,
    codigoProveedor: m.codigo_proveedor,
    nombreProveedor: m.nombre_raw,
  }));

  const { matches, sinMatch } = ejecutarMatching(matcheables, catalogo);
  const nombrePorId = new Map(catalogo.map((p) => [p.id, p.nombre]));
  const porItemId = new Map<string, FacturaItemMatch>();

  for (const m of matches) {
    porItemId.set(m.itemId, {
      producto_id: m.productoId,
      confidence: m.confidence,
      metodo: m.metodo,
      producto_nombre: nombrePorId.get(m.productoId) ?? null,
    });
  }

  for (const item of sinMatch) {
    porItemId.set(item.id, {
      producto_id: null,
      confidence: 0,
      metodo: 'sin_match',
      producto_nombre: null,
    });
  }

  return porItemId;
}
