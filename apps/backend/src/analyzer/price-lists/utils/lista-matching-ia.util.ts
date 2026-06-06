import { llamarGeminiTexto } from '../../../ai/utils/gemini';
import { PROMPT_MATCHING_FUZZY } from '../../../ai/utils/prompts';
import type { ItemMatcheable, MatchResult, ProductoCatalogo } from './lista-matching.util';

const GEMINI_BATCH_SIZE = 25;

interface GeminiFuzzyMatch {
  item_id: string;
  producto_id: string;
  confidence: number;
  razon: string;
}

export async function matchPorIA(
  items: ItemMatcheable[],
  productosDisponibles: ProductoCatalogo[],
): Promise<MatchResult[]> {
  if (items.length === 0 || productosDisponibles.length === 0) return [];

  const allMatches: MatchResult[] = [];

  for (let i = 0; i < items.length; i += GEMINI_BATCH_SIZE) {
    const batch = items.slice(i, i + GEMINI_BATCH_SIZE);
    const itemsPayload = batch.map((it) => ({
      id: it.id,
      nombre: it.nombreProveedor,
      codigo: it.codigoProveedor,
    }));
    const productosPayload = productosDisponibles.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      codigo: p.codigo,
    }));

    const prompt = `${PROMPT_MATCHING_FUZZY}\n\n${JSON.stringify({
      items: itemsPayload,
      productos: productosPayload,
    })}`;

    let respuesta: string;
    try {
      respuesta = await llamarGeminiTexto(prompt);
    } catch {
      continue;
    }

    let parsed: { matches?: GeminiFuzzyMatch[] };
    try {
      parsed = JSON.parse(respuesta) as { matches?: GeminiFuzzyMatch[] };
    } catch {
      const jsonMatch = respuesta.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      try {
        parsed = JSON.parse(jsonMatch[0]) as { matches?: GeminiFuzzyMatch[] };
      } catch {
        continue;
      }
    }

    if (!Array.isArray(parsed.matches)) continue;

    const itemIds = new Set(batch.map((it) => it.id));
    const prodIds = new Set(productosDisponibles.map((p) => p.id));
    const usedItems = new Set<string>();
    const usedProds = new Set<string>();

    for (const m of parsed.matches) {
      if (
        !itemIds.has(m.item_id) ||
        !prodIds.has(m.producto_id) ||
        usedItems.has(m.item_id) ||
        usedProds.has(m.producto_id)
      ) {
        continue;
      }

      const confidence =
        typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : 0;
      if (confidence < 0.5) continue;

      allMatches.push({
        itemId: m.item_id,
        productoId: m.producto_id,
        confidence,
        metodo: 'ia_fuzzy',
      });
      usedItems.add(m.item_id);
      usedProds.add(m.producto_id);
    }
  }

  return allMatches;
}
