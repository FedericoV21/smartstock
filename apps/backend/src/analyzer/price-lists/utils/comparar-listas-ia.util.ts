import { llamarGeminiTexto } from '../../../ai/utils/gemini';
import { PROMPT_CROSS_MATCHING } from '../../../ai/utils/prompts';
import type { ItemConProveedor } from './comparar-listas.util';

export async function cruzarListasConIA(
  items: ItemConProveedor[],
): Promise<Map<string, ItemConProveedor[]>> {
  if (items.length === 0) return new Map();

  const porLista = new Map<string, { item_id: string; nombre: string; codigo: string | null }[]>();
  const itemMap = new Map<string, ItemConProveedor>();

  for (const it of items) {
    itemMap.set(it.item_id, it);
    if (!porLista.has(it.lista_id)) porLista.set(it.lista_id, []);
    porLista.get(it.lista_id)!.push({
      item_id: it.item_id,
      nombre: it.nombre_raw,
      codigo: it.codigo_proveedor,
    });
  }

  const listas = [...porLista.entries()].map(([listaId, items_]) => ({
    lista_id: listaId,
    items: items_.slice(0, 100),
  }));

  const prompt = `${PROMPT_CROSS_MATCHING}\n\n${JSON.stringify({ listas })}`;

  let respuesta: string;
  try {
    respuesta = await llamarGeminiTexto(prompt);
  } catch {
    return new Map();
  }

  let parsed: { grupos?: { nombre_unificado: string; items: { lista_id: string; item_id: string }[] }[] };
  try {
    parsed = JSON.parse(respuesta) as typeof parsed;
  } catch {
    const jsonMatch = respuesta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return new Map();
    try {
      parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
    } catch {
      return new Map();
    }
  }

  if (!Array.isArray(parsed.grupos)) return new Map();

  const grupos = new Map<string, ItemConProveedor[]>();
  const usados = new Set<string>();

  for (const g of parsed.grupos) {
    if (!g.nombre_unificado || !Array.isArray(g.items)) continue;

    const grupoItems: ItemConProveedor[] = [];
    const listasEnGrupo = new Set<string>();

    for (const ref of g.items) {
      const it = itemMap.get(ref.item_id);
      if (!it || usados.has(it.item_id) || listasEnGrupo.has(it.lista_id)) continue;
      grupoItems.push(it);
      listasEnGrupo.add(it.lista_id);
      usados.add(it.item_id);
    }

    if (grupoItems.length >= 2) {
      grupos.set(`ia_${g.nombre_unificado}`, grupoItems);
    }
  }

  return grupos;
}
