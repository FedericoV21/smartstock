export function quitarCercasMarkdownJson(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

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
    return { json: limpio, data: JSON.parse(limpio) as unknown };
  } catch {
    /* seguir */
  }
  const balanceado = extraerPrimerObjetoJsonBalanceado(limpio);
  if (balanceado) {
    try {
      return { json: balanceado, data: JSON.parse(balanceado) as unknown };
    } catch {
      /* seguir */
    }
  }
  const balanceadoCrudo = extraerPrimerObjetoJsonBalanceado(text);
  if (balanceadoCrudo && balanceadoCrudo !== balanceado) {
    try {
      return { json: balanceadoCrudo, data: JSON.parse(balanceadoCrudo) as unknown };
    } catch {
      /* fall├│ */
    }
  }
  return null;
}
