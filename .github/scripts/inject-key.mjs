/*
 * Injeta a chave do Gemini no HTML publicado no Pages, a partir do secret
 * GEMINI_API_KEY ( Actions → Repository secrets ).
 *
 * Por que existe: o repositório é público, então a chave embutida em index.html é legível por
 * qualquer pessoa. Enquanto ela estiver lá, o site funciona sem configuração nenhuma — e assim
 * que você criar o secret, o artefato publicado passa a usar o valor do secret, o que permite
 * apagar a constante do repositório sem quebrar o site.
 *
 * Uso:  AI_KEY=<chave> node .github/scripts/inject-key.mjs <arquivo.html>
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const key = (process.env.AI_KEY || "").trim();
const MARKER = 'const PRESET_GEMINI_KEY = "';

if (!key) {
  console.log("secret GEMINI_API_KEY ausente — o site vai usar a chave embutida no index.html");
  process.exit(0);
}
if (!file) {
  console.error("uso: node inject-key.mjs <arquivo.html>");
  process.exit(2);
}

const text = readFileSync(file, "utf8");
const start = text.indexOf(MARKER);
if (start < 0) {
  console.error(`AVISO: "${MARKER}" não existe em ${file} — o formato mudou, atualize este script`);
  process.exit(1);
}
const end = text.indexOf('";', start + MARKER.length);
if (end < 0) {
  console.error(`AVISO: a constante PRESET_GEMINI_KEY em ${file} está sem fechamento`);
  process.exit(1);
}

const anterior = text.slice(start + MARKER.length, end);
const patched = text.slice(0, start + MARKER.length) + key + text.slice(end);
writeFileSync(file, patched, "utf8");
console.log(
  `chave do site injetada do secret em ${file} (substituídos ${anterior ? anterior.slice(0, 6) + "…" : "coluna vazia"} → ${key.slice(0, 6)}…)`
);
