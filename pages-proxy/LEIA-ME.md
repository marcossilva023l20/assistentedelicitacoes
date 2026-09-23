# Proxy da varredura (Cloudflare Worker · grátis)

Por que existe: a versão publicada no GitHub Pages é estática — sem servidor, o navegador
não consegue abrir `magazineluiza.com.br`, `kabum.com.br`, `bing.com`… (bloqueio de CORS).
Os proxies CORS públicos (`cors.eu.org`, `allorigins.win`, `corsproxy.io`) estão hoje ou com
limite de plano, ou fora do ar, ou exigindo chave paga. Um Worker seu resolve com ~2 minutos
de configuração e remove essa dependência.

Sem proxy próprio o app **continua funcionando** (a IA e os links de busca por loja), mas os
preços confirmados nas páginas das lojas ficam sujeitos à sorte dos proxies públicos.

## Implantar

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create application** → **Workers**.
2. Dê um nome (ex.: `licita-proxy`) → **Deploy** com o modelo padrão (esvazia o arquivo).
3. Cole o conteúdo de [`worker.js`](./worker.js) no editor → **Save and Deploy**.
4. Copie a URL gerada, ex.: `https://licita-proxy.<sua-conta>.workers.dev`.
5. No LicitaPreço, clique em **⚙ Chave IA** e cole:

   ```
   https://licita-proxy.<sua-conta>.workers.dev/?url=
   ```

   Salvar. O indicador no topo passa a dizer **“IA ativa · varredura pelo seu proxy”**.

Nada é enviado para o Cloudflare além do que a própria varredura já faz: o Worker só repassa
a página pública da loja e devolve o HTML. Nenhuma chave de IA passa por ele (as chamadas do
Gemini vão direto do navegador para o Google).

## Endurecer (recomendado se a URL ficar pública)

Em **Settings → Variables & Secrets** do Worker:

| Variável | Efeito |
| --- | --- |
| `PROXY_TOKEN` | exige `?t=<token>`; cole no app como `https://…workers.dev/?url=&t=SEU_TOKEN` — qualquer pessoa com a URL deixa de conseguir usar seu proxy. |
| `ALLOWED_HOSTS` | sufixos extras separados por vírgula, ex.: `lojaqualquer.com.br,another.com`. |

O Worker já recusa hosts fora da lista, endereços internos (SSRF) e respostas acima de 4 MB.

## Testar pelo terminal

```bash
curl -s "https://licita-proxy.<sua-conta>.workers.dev/?url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('https://www.kabum.com.br/busca/notebook-dell',safe=''))")" | head -c 300
```

Deve devolver HTML da KaBuM! (e os cabeçalhos `Access-Control-Allow-Origin: *`).

## Testes de unidade?

Não há — é 1 arquivo de 100 linhas cujo contrato é “recebe `?url=`, devolve o corpo com
CORS”. O comportamento observable está descrito acima e o app mostra claramente quando o
transporte falhou (erro “Nenhum proxy respondeu” em vez de “não achei ofertas”).
