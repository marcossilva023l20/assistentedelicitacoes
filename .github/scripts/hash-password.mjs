/*
 * Gera a linha de usuário para o secret USERS do proxy (pages-proxy/worker.js).
 *
 *   node .github/scripts/hash-password.mjs seu@email.gov.br
 *   →  seu@email.gov.br:1f9c…salt…:b3d7…hash…
 *
 * O login do site (modo navegador) usa exatamente a mesma derivação
 * SHA-256(salt + ":" + senha), então o mesmo par salt/hash vale nos dois modos.
 * Senha curta é adivinhável offline se alguém tiver acesso à lista — por isso a lista
 * mora no secret do Worker, nunca no HTML.
 */
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("uso: node hash-password.mjs <email>  [senha]  (sem senha, pede no terminal)");
  process.exit(2);
}

const ask = (prompt) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (v) => {
      rl.close();
      resolve(v.trim());
    });
  });

let password = process.argv[3] || process.env.PASSWORD || "";
if (!password) {
  console.error("(o terminal não oculta a digitação — para histórico limpo, use PASSWORD='…' node …)");
  password = await ask("Senha: ");
}
if (password.length < 10) {
  console.error("senha muito curta: use pelo menos 10 caracteres");
  process.exit(2);
}

const salt = randomBytes(16).toString("hex");
const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
console.log(`${email}:${salt}:${hash}`);
console.error("(cole esta linha no secret USERS do Worker, uma por usuário)");
