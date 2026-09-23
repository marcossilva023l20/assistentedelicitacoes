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

## Versão estática (GitHub Pages) — publicar e atualizar

O arquivo publicado é `index.html` da raiz (com a cópia idêntica `public/gh-pages-demo.html`, que o
workflow usa como fonte). **Qualquer mudança nesses dois arquivos precisa ser feita nas duas cópias.**

**De onde o Pages lê** — *Settings → Pages → Build and deployment → Source*:

| Source | O que acontece |
| --- | --- |
| `Deploy from a branch` → `arena/01a0cc30-assistentedelicitacoes` / `(root)` | cada push no branch atualiza o site em ~30 s, sem PR e sem merge. É o que permite continuar mexendo direto no diretório. |
| `GitHub Actions` (workflow) | usa [`.github/workflows/pages.yml`](.github/workflows/pages.yml), que publica só a demo e pode injetar a chave a partir do secret `GEMINI_API_KEY`. **Só funciona com o workflow registrado na branch padrão** — enquanto as mudanças estiverem num branch não publicado, o Pages fica congelado na última build, por mais push que você dê. |

Se o Source está em `GitHub Actions` e o workflow ainda não está na branch padrão, o site **não
atualiza** (nenhuma build é criada ao fazer push) — é o sintoma de “mudei e continua igual”. Volte
para `Deploy from a branch` ou leve o workflow para a `main`.

Depois de publicado, em `https://marcossilva023l20.github.io/assistentedelicitacoes/`:

- **A chave não vai no código público.** O valor de `PRESET_GEMINI_KEY` é `""`: o Push Protection do
  GitHub rejeita commit com chave de API literal (`GH013`), e o agente não burla esse bloqueio.
- Cada dispositivo que colar a chave uma vez em **⚙ Chave IA** para de perguntar (fica no
  `localStorage`). Para “salvar sem digitar nada” em um navegador seu, favorite um link com o
  fragmento — o que vem depois de `#` não é enviado a servidor nenhum e não entra no repositório:

  ```
  https://<usuario>.github.io/assistentedelicitacoes/#chave=AIza…
  ```

  O mesmo vale para o servidor: `#servidor=https://licita-proxy.<conta>.workers.dev/`.
- Para **todos** os visitantes pararem de ver o pedido, há dois caminhos: (a) secret `GEMINI_API_KEY`
  em *Settings → Secrets and variables → Actions* + workflow na branch padrão (exige merge); (b) o
  Worker de [`pages-proxy/`](pages-proxy/worker.js), que guarda a chave fora do HTML e faz a chamada
  da IA por você — funciona sem merge e desliga o pedido de chave. Detalhes em
  [`pages-proxy/LEIA-ME.md`](pages-proxy/LEIA-ME.md).
- O indicador do topo diz o estado real: `configure a chave da IA` → `IA ativa · sua chave local` /
  `IA ativa · chave do site` → `IA via servidor · varredura própria`.
- Sem o Worker, a leitura dos preços nas lojas depende de proxies CORS públicos (`cors.eu.org`,
  `allorigins.win`, `corsproxy.io`…), hoje com limite de plano, fora do ar ou pedindo chave paga.
  O app avisa **“nenhum proxy respondeu”** em vez de dizer que não achou ofertas.

## Tela de acesso (e-mail e senha)

A página abre com uma tela de acesso. Dois modos, o próprio site decide:

- **Local (padrão, zero infraestrutura).** No primeiro uso a tela já vem em modo *criar acesso*: você
  define e-mail + senha (mín. 10 caracteres) e entra. Os acessos ficam no `localStorage` do
  navegador, como `SHA-256(salt + ":" + senha)` — a senha em si nunca é gravada. Enquanto `html.locked`
  estiver no documento, o resto da página fica invisível e nada roda: `runAnalysis()` recusa sem
  sessão, e o botão `sair` derruba a sessão.
- **Servidor (recomendado).** Preencha ⚙ → **Servidor** com a URL do Worker (`https://…workers.dev/`):
  o login passa a ser validado por `POST /login` com token HMAC assinado por `AUTH_SECRET`, a sessão é
  revalidada em `GET /verify` a cada abertura e os visitantes param de receber pedido de chave porque a
  IA é chamada pelo Worker (`POST /gemini`). Configuração completa em [`pages-proxy/LEIA-ME.md`](pages-proxy/LEIA-ME.md).

No celular funciona igual, com três cuidados: o cartão de acesso é visível **antes** de qualquer
script (uma tela preta nunca é o estado "carregando"), os campos têm `font-size: 16px` em telas
pequenas para o iOS não dar zoom, e `viewport-fit=cover` + `env(safe-area-inset-bottom)` tiram o
botão de trás da barra de gestos. O armazenamento é acessado por uma camada que degrada para memória
quando o navegador o bloqueia.

**Honestidade sobre o que isso protege:** numa página estática, a tela de acesso é **barreira de
entrada, não segurança** — o HTML e o JavaScript continuam visíveis em *Ver código-fonte*, e um
portão do lado do navegador pode ser contornado por quem sabe inspecionar. Ela serve para uso
compartilhado no mesmo computador, para não deixar consulta solta em tela e para obrigar sessão
válida no Worker. Em modo **servidor**, a barreira é real (o token é verificado fora do navegador) e
ela vale também para a cota da IA. Um portão client-side **não** esconde uma chave embutida: se a
chave estiver no HTML, continua pública mesmo com a tela de login.

## Fluxo da análise

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
| O site **pede a chave de novo** toda vez que abre, mesmo depois de salvar | Ou é outro navegador/dispositivo (a chave salva em ⚙ fica no `localStorage` daquele navegador só), ou o navegador bloqueia armazenamento — modo privado e o navegador interno do WhatsApp/Instagram. Nesse segundo caso o modal ⚙ avisa ("Este navegador não deixa guardar nada") e oferece **Gerar link**: um `…#chave=SUACHAVE` para favoritar, que reabre o site com a chave carregada sem depender de armazenamento. Salvar "e sumir" não é mais fingido: se nada persistiu, o modal fica aberto e diz por quê. |
| O cartão de acesso aparece, mas **nenhum botão reage** (inclusive "criar novo acesso") | O script principal abortou antes de anexar os tratadores — um único elemento ausente bastava (`gEl("gateForm").onsubmit` com `gateForm` inexistente). O portão agora usa `gEl`/`gBind`, que avisam no console em vez de derrubar tudo; abra o DevTools e procure `[acesso] elemento ausente`. |
| No celular a tela fica **preta** (nada do portão aparece) | O script principal não rodou: WebView interno do WhatsApp/Instagram bloqueia `localStorage`, o modo privado lança erro, ou o navegador é antigo demais para `type="module"`. Desde já o site cai para um depósito em memória e mostra o cartão de acesso com o motivo (`#gateDead`) em vez de tela preta — mas para o acesso *sobreviver* ao fechar, abra no Chrome/Safari normais. |
| No iPhone o formulário dá zoom e sai da tela ao tocar no campo | Combate-se com `font-size:16px` em telas ≤ 640px (iOS só não dá zoom a partir de 16px) — já aplicado no CSS do portão; se aparecer zoom em outro campo, é o mesmo remédio. |
| PDF digitalizado não segmenta | O arquivo é imagem; rode OCR antes (a versão estática também precisa de texto extraível). |
| A tela de acesso não sai do lugar / nada aparece | Sessão expirada ou `AUTH_SECRET` ausente no Worker: o `/verify` devolve 401 e o site volta a bloquear. Crie o secret (ou limpe ⚙ → **Servidor** para usar o modo local) e recarregue. |
| “Muitas tentativas. Aguarde 30 s.” | Cooldown anti-força-bruta: 5 falhas seguidas no mesmo navegador. Espere os 30 s. |
| Esqueci a senha do acesso **local** | Ela não é recuperável (só o hash fica no navegador). Limpe `localStorage.licita_users` nas DevTools → a tela volta ao modo “criar acesso”. |
| Cadastrei o acesso e em outro computador ele não existe | Esperado no modo local: os acessos vivem no navegador. Para acessos compartilhados, configure o Worker com `USERS`. |
