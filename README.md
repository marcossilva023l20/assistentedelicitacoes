# LicitaPreço — Assistente de Licitações

Cola o item do edital (ou envia a foto do produto / o Termo de Referência inteiro) e recebe
as ofertas reais do varejo brasileiro ordenadas por preço, com avaliação de conformidade pelas
IA e relatório pronto para o processo de licitação.

Stack: Next.js 16 (App Router, Turbopack) · `@google/genai` · Drizzle ORM + Postgres (opcional).

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencha GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Verifique se o servidor enxergou a chave: <http://localhost:3000/api/status>

```json
{ "configured": true, "keySource": "GEMINI_API_KEY", "model": "gemini-3.6-flash", "storage": "local" }
```

## Variáveis de ambiente

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `GEMINI_API_KEY` | **sim** | Chave gratuita do Google AI Studio (<https://aistudio.google.com/apikey>). Sem ela, `/api/analyze` responde `503 MISSING_KEY`. |
| `GEMINI_MODEL` | não | Modelo preferido. Se ele falhar, o app tenta `gemini-3.5-flash`, `gemini-3.8-flash`, `gemini-3-flash-preview`. |
| `DATABASE_URL` | não | Postgres para histórico e TRs. Sem ela, os registros vão para `.data/store.json` (fora do git) e o app segue 100% funcional. |
| `MERCADO_LIVRE_CLIENT_ID` / `_SECRET` | não | API oficial do Mercado Livre; aumenta a cobertura de ofertas. |

`GEMINI_API_KEY` também é lida de `GOOGLE_API_KEY` ou `GOOGLE_GENERATIVE_AI_API_KEY`.

> A chave **nunca** deve ser commitada: `.env` e `.env.*` estão no `.gitignore`.
> Em deploys (Vercel, Railway, Render…), configure a variável no painel do provedor — não no repositório.

### Postgres (opcional)

```bash
DATABASE_URL=postgresql://usuario:senha@host:5432/banco npm run db:push
```

`drizzle-kit push` cria as tabelas `searches`, `search_results` e `tr_batches`.
O `drizzle.config.ts` lê `DATABASE_URL` do `.env.local` automaticamente.

## Rotas

| Rota | Função |
| --- | --- |
| `POST /api/analyze` | Analisa o texto do edital: planeja buscas, varre lojas/comparadores, avalia conformidade com a IA e grava no histórico. |
| `POST /api/analyze-image` | Identifica o produto a partir de uma foto e roda o mesmo fluxo de busca. |
| `POST /api/tr/import` · `POST /api/tr/run` | Importa um Termo de Referência (DOCX/PDF) e pesquisa item por item, retomando de onde parou. |
| `GET /api/searches` · `GET /api/searches/[id]` · `DELETE …` | Histórico (listar, abrir, apagar, esvaziar lixeira). |
| `GET /api/status` · `GET /api/health` | Diagnóstico: chave configurada, modelo, tipo de armazenamento. |

## Versão estática (GitHub Pages)

`index.html` é a versão que roda só no navegador, sem servidor: a chave é colada uma vez no
botão **⚙ Chave IA** e fica no `localStorage` do dispositivo (nunca no repositório).
Como não há servidor intermediário, a varredura das lojas depende de proxies CORS públicos e
é mais limitada que a versão Next.js.

## Solução de problemas

| Sintoma | Causa e correção |
| --- | --- |
| `Chave da IA não configurada` (`MISSING_KEY`) | Falta `GEMINI_API_KEY` no `.env.local` — reinicie o `next dev` depois de criar/editar o arquivo. |
| `A chave da IA foi rejeitada pelo Google` (`INVALID_KEY`) | Chave antiga/revogada: gere outra no AI Studio e substitua no `.env.local` (ou na variável do provedor). |
| `Não consegui falar com a API do Google` (`GEMINI_OFFLINE`) | O **servidor** sem acesso a `generativelanguage.googleapis.com` (firewall, proxy, rede isolada). |
| `Nenhum modelo de IA disponível para esta chave` | `GEMINI_MODEL` aponta para um modelo inexistente — deixe vazio para usar os padrões. |
| `Não consegui confirmar nenhuma oferta agora` | As lojas limitaram o acesso momentaneamente; tente de novo em alguns segundos. |
| PDF digitalizado não segmenta | O arquivo é imagem; rode OCR antes (a versão estática também precisa de texto extraível). |
