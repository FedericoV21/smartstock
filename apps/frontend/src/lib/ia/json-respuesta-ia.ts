/**
 * El modelo suele devolver JSON puro; a veces markdown (` ```json `), texto extra, o JSON truncado.
 * Extrae el primer objeto `{...}` balanceando llaves y respetando strings JSON (evita el regex `\{[\s\S]*\}`
 * que rompe con `}` dentro de valores o con greedy incorrecto).
 */

export function quitarCercasMarkdownJson(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

/**
 * Desde el primer `{`, encuentra el `}` que cierra ese objeto (strings y escapes cuentan).
 */
export function extraerPrimerObjetoJsonBalanceado(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

export function intentarParseObjetoJsonModelo(text: string): { json: string; data: unknown } | null {
  const limpio = quitarCercasMarkdownJson(text);

  try {
    const data = JSON.parse(limpio) as unknown;
    return { json: limpio, data };
  } catch {
    /* seguir */
  }

  const balanceado = extraerPrimerObjetoJsonBalanceado(limpio);
  if (balanceado) {
    try {
      const data = JSON.parse(balanceado) as unknown;
      return { json: balanceado, data };
    } catch {
      /* seguir */
    }
  }

  const balanceadoCrudo = extraerPrimerObjetoJsonBalanceado(text);
  if (balanceadoCrudo && balanceadoCrudo !== balanceado) {
    try {
      const data = JSON.parse(balanceadoCrudo) as unknown;
      return { json: balanceadoCrudo, data };
    } catch {
      /* falló */
    }
  }

  return null;
}
