# Servidor do site: login, varredura e IA (Cloudflare Worker · grátis)

Por que existe: a versão publicada no GitHub Pages é **estática**. Sem servidor, o navegador não
consegue abrir `magazineluiza.com.br`, `kabum.com.br`, `bing.com`… (bloqueio de CORS), os proxies
CORS públicos estão hoje com limite de plano ou fora do ar, e **qualquer chave colocada no HTML é
pública** — o GitHub bloqueia o commit (Push Protection) e o Google pode revogar a chave.

Este Worker resolve as três coisas numa camada grátis do Cloudflare (100.000 requisições/dia),
sem banco e sem custo:

| Rota | O que faz |
| --- | --- |
| `POST /login` | `{ email, password }` → `{ token, exp, email }` (HMAC-SHA256, validade `SESSION_HOURS`) |
| `GET /verify` | confere o token guardado no navegador → `{ email, exp }` |
| `POST /gemini` | chama o Google **com a chave que só existe aqui** e devolve `{ text, model }` |
| `GET /?url=<url codificada>` | repassa a página pública da loja para a varredura |

Sem nada configurado, o site continua funcionando exatamente como antes: a tela de acesso entra em
**modo local** (os acessos vivem no `localStorage` daquele navegador) e a IA usa a chave salva por
você em ⚙. Configurando `AUTH_SECRET` + `USERS` + `GEMINI_API_KEY`, o login passa a ser verificado
aqui, a varredura fica fechada para quem tem sessão e **a chave nunca mais aparece no HTML nem é
pedida para ninguém**.

## 1. Deploy do Worker

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create application** → **Workers**.
2. Nome (ex.: `licita-proxy`) → **Deploy** com o modelo padrão (esvazia o arquivo).
3. Cole o conteúdo de [`worker.js`](./worker.js) → **Save and Deploy**.
4. Guarde a URL, ex.: `https://licita-proxy.<sua-conta>.workers.dev/`.

## 2. Variáveis (Settings → Variables and Secrets → **Secrets**)

| Variável | Obrigatória | Efeito |
| --- | --- | --- |
| `AUTH_SECRET` | para login | string aleatória que assina o token de sessão. `openssl rand -hex 32`. **Com ela ausente o `/login` devolve 500.** |
| `USERS` | para login | uma linha por acesso: `email:salt:sha256hex`. Gere com o script do repositório. |
| `GEMINI_API_KEY` | para a IA via servidor | a chave do Google. Fica **só** aqui — o navegador não a vê. |
| `SESSION_HOURS` | não | validade do token (padrão `336` = 14 dias) |
| `PROXY_TOKEN` | não | modo antigo, sem login: exige `?t=<token>` em tudo |
| `ALLOWED_HOSTS` | não | sufixos extras separados por vírgula, ex.: `lojaqualquer.com.br` |

Crie cada acesso com (a senha tem ≥ 10 caracteres; o hash é o mesmo que o site usa no modo local):

```bash
PASSWORD='senha-bem-grande' node .github/scripts/hash-password.mjs controle@manaus.am.gov.br
# → controle@manaus.am.gov.br:7ea04c677317937894eb5f5b8abb720c:568bd1a2...
```

Junte as linhas em `USERS` com vírgula (ou `;` / quebra de linha):

```
controle@manaus.am.gov.br:7ea0…:568b…,gestor@manaus.am.gov.br:1c9f…:aa40…
```

## 3. Ligar o site ao Worker

No LicitaPreço, clique em **⚙ Chave IA** → campo **Servidor** → cole a URL raiz **com a barra
final**:

```
https://licita-proxy.<sua-conta>.workers.dev/
```

Salvar. O selo do topo passa a dizer **“IA via servidor · varredura própria”**, a tela de acesso
mostra **“verificado no servidor”** e o campo de chave fica opcional (deixe vazio: nada é pedido).
Para não digitar nada em outro navegador, use o atalho pelo fragmento do endereço — o que vem após
o `#` **não é enviado a servidor nenhum**:

```
https://<usuario>.github.io/assistentedelicitacoes/#servidor=https://licita-proxy.<sua-conta>.workers.dev/
```

Com `USERS` preenchido, o próprio `?url=` passa a exigir sessão válida: quem não fez login não usa
seu proxy. Se você quiser o proxy aberto como antes, basta deixar `USERS` vazio e usar `PROXY_TOKEN`.

## 4. Testar pelo terminal

```bash
W=https://licita-proxy.<sua-conta>.workers.dev
curl -s -X POST "$W/login" -H 'content-type: application/json' \
  -d '{"email":"controle@manaus.am.gov.br","password":"senha-bem-grande"}'      # → {"token":"…","exp":…,"email":"…"}
TOKEN=… # o campo token da resposta
curl -s "$W/verify" -H "authorization: Bearer $TOKEN"                          # → {"email":"…","exp":…}
curl -s -X POST "$W/gemini" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"responda só: OK"}]}]}'      # → {"text":"OK","model":"…"}
curl -s "$W/?url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('https://www.kabum.com.br/busca/notebook-dell',safe=''))")" -H "authorization: Bearer $TOKEN" | head -c 200
```

## 5. O que o Worker já recusa

`AUTH_SECRET` ausente → 500 com explicação · senha errada ou e-mail desconhecido → 401 com a mesma
mensagem (não revela qual dos dois) · 8 tentativas por IP em 5 min → 429 · token adulterado ou
vencido → 401 · hosts fora da lista → 403 · endereços internos/`localhost`/metadados (SSRF) → 403 ·
respostas acima de 4 MB → cortadas · `Access-Control-Allow-Origin: *` em tudo (o site é outro domínio).

A comparação de senha no modo local e do token aqui é por tempo constante (`safeEqual`), e o hash
guardado é `SHA-256(salt + ":" + senha)` — sem bcrypt porque Workers não têm; por isso a senha deve
ser longa. Não reutilize uma senha sua de verdade.

## Testes

Não há suíte no repositório (o contrato do Worker são 4 rotas com JSON simples). O arquivo foi
exercitado em Node com uma linha real de `USERS`: senha correta → 200 + token; senha errada e
e-mail inexistente → 401 idênticos; `/verify` com token válido → 200, token adulterado e sem token →
401; `/gemini` sem token → 401; `?url=` sem login com `USERS` ativo → 401, host permitido logado →
busca real, `evil.tld` → 403; 10ª tentativa após 9 falhas → 429; `/login` sem `USERS` → 501.
