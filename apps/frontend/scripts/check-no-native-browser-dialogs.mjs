/**
 * Evita regresiones a confirm() / alert() / prompt() del navegador con mensaje literal,
 * o a window.confirm / globalThis.alert, etc.
 * Preferir useConfirm() y renderizar ConfirmDialog en el cliente.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const PATTERNS = [
  {
    label: 'window/globalThis.confirm|alert|prompt(',
    re: /\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/g,
  },
  {
    label: 'confirm|alert|prompt( con string/template literal (típico de API nativa)',
    re: /(?<![$\w.])(?:confirm|alert|prompt)\s*\(\s*(?:'|"|`)/g,
  },
];

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (EXT.has(path.extname(e.name))) {
      yield p;
    }
  }
}

/** Líneas que son sólo comentario (evita texto en docs que imite el patrón). */
function isLikelyCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/');
}

const hits = [];

const projectRoot = path.dirname(ROOT);

for (const file of walk(ROOT)) {
  const rel = path.relative(projectRoot, file).replaceAll(path.sep, '/') || path.basename(file);
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (isLikelyCommentLine(line)) return;
    for (const { label, re } of PATTERNS) {
      const r = new RegExp(re.source, re.flags);
      if (r.test(line)) {
        hits.push({
          rel,
          line: idx + 1,
          label,
          preview: line.trim().slice(0, 140),
        });
      }
    }
  });
}

if (hits.length > 0) {
  console.error(
    'Se detectaron diálogos nativos del navegador o patrones equivalentes. Usá useConfirm() en su lugar.\n',
  );
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.line}  [${h.label}]\n    ${h.preview}\n`);
  }
  process.exit(1);
}

console.log('check-no-native-browser-dialogs: ok');
