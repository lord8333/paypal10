# Checkout de teste sem login — deploy direto

**PACOTE CONFIDENCIAL.** Contém credenciais PayPal fornecidas pelo proprietário, exclusivamente em `config.server.mjs`, usado pela Function. Não publique o ZIP, esse arquivo ou seus valores em repositório público, chat, screenshot ou serviço estático. O Client Secret não é enviado ao navegador, mas quem acessar o código do servidor/artefato poderá vê-lo.

As credenciais foram expostas no chat. Recomenda-se revogar o segredo exposto e substituí-lo por outro localmente, no mesmo arquivo, antes de operar dinheiro real. O pacote não foi autenticado com PayPal: não há garantia de validade, de que Client ID/Secret correspondam entre si ou de elegibilidade da conta.

## O que está configurado

- Client ID e Client Secret informados, apenas no módulo de servidor.
- `environment: "live"` e `allowLivePayments: true`.
- Valor ilustrativo BRL 1.00. Confira antes de aprovar qualquer pagamento.
- Sem usuário, senha ou autenticação HTTP Basic na página. CSRF, validação da sessão, valor e moeda continuam ativos.
- Domínio detectado pelas variáveis automáticas da Vercel. Não exige cadastro manual de variáveis nem Redis.
- Configuração importada diretamente pela Function: não depende de pasta oculta nem leitura de JSON ignorado no deploy.

## Publicar — uma ação na sua máquina

Pré-requisito: Node.js 24 e acesso à sua conta Vercel.

1. Extraia a pasta `paypal-sem-login`.
2. No terminal, entre nela e execute:

```sh
cd paypal-sem-login
npm run deploy
```

O comando verifica a sintaxe, obtém a Vercel CLI oficial pelo npm e inicia o deploy Production. Se for solicitado, autentique sua conta Vercel e crie/vincule o projeto. Essa autenticação é necessária para publicar na sua conta e não pode ser dispensada pelo pacote.

Framework: Other; diretório raiz: pasta contendo `vercel.json`; build: `npm run build`; saída: `public`. O arquivo de configuração já define build e saída. Aguarde o deploy e abra o domínio raiz.

**Use deploy direto pela CLI, não importação GitHub.** `config.server.mjs` é ignorado pelo Git para evitar publicação de credenciais, mas é incluído no upload direto e rastreado pelo import da Function. Importar um repositório que não contém esse arquivo não será suficiente. Não remova a proteção para publicar o segredo.

Não é necessário informar usuário ou senha. Qualquer pessoa com a URL poderá abrir a página e iniciar seu próprio pedido. Não deixe esse protótipo público além do necessário para o teste; não há controle durável de abuso/limites de tentativa.

## Se o domínio não for detectado

Se as variáveis automáticas da Vercel estiverem desativadas, o domínio for personalizado ou a origem detectada não corresponder à URL que você abre, preencha `publicUrl` em `config.server.mjs` com a origem HTTPS correta e publique novamente. Nenhum valor secreto deve ser mostrado em suporte.

## Cuidados com pagamento real

Nenhuma cobrança ocorre no build, nos testes ou no deploy. É necessário confirmar o valor na página e aprovar no PayPal; o retorno inicia a verificação/captura no servidor. Recomenda-se testar primeiro no Sandbox com credenciais de teste correspondentes e `allowLivePayments: false`. No Sandbox nunca use cartão real.

No Live, use somente conta/cartão autorizados e transações permitidas pelo PayPal. A opção de cartão não é garantida e pagamentos para a própria conta podem ser restringidos. Confira tarifas e reembolsos no painel PayPal. A página não recebe cartão/CVV.

## Limitações

Protótipo privado, sem Redis, histórico, conciliação, webhooks, reembolso automático ou travas distribuídas. Retentativas dependem de idempotência e regras do PayPal; não há garantia própria de processamento exatamente uma vez. Não use para entrega automática de produtos ou como loja completa.

Cookie de sessão assinado com validade de três horas, origem e CSRF conferidos, pedido vinculado à sessão por HMAC, moeda/valor verificados antes da captura. Apenas captura COMPLETED aparece como paga. Se expirar a sessão, mudar segredo, perder cookie, houver falha de conexão ou pagamento pendente, consulte o painel antes de começar outra compra. Fechar a página antes do retorno pode deixar pedido sem captura local.

Live bloqueado em Preview. Esta versão não foi publicada nem testada ponta a ponta com uma conta real durante sua preparação. `npm test` usa respostas falsas e não efetua conexões externas.

## Conta brasileira: cartão no checkout oficial do PayPal

Esta versão remove somente o login. A compra ainda usa o checkout oficial do PayPal. Não inclui campos HTML que coletem PAN/CVV. A integração de campos hospedados (CardFields) depende do país e da habilitação da conta Business; o Brasil não aparece na lista oficial atual de países de comerciantes para Expanded Checkout. Como a conta foi confirmada como brasileira, esta versão mantém o cartão somente no checkout oficial do PayPal, não adiciona campos locais de cartão.

No checkout PayPal, use a opção de cartão se ela estiver disponível. Não é garantida; a plataforma decide a elegibilidade. Não altere o país ou tente burlar a restrição para habilitar campos. A aprovação e a captura são operações distintas: o servidor consulta/valida o pedido aprovado antes de capturar. Confira a captura na atividade da conta.

Referências: https://developer.paypal.com/expanded/eligibility e https://developer.paypal.com/v5/expanded/integrate .

## Diagnóstico PayPal — versão 2.3.1

Em erros da API, a página agora exibe somente nome/códigos de erro (name e details.issue), status HTTP e debug_id de referência. Não exibe a resposta completa, descrições/valores de campos, dados do pagador, cartão ou tokens. A referência sozinha não informa a causa. Compartilhe apenas a mensagem/código seguro com suporte.

Se houve erro antes de abrir o checkout, não assuma que aconteceu uma compra ou que nenhuma cobrança ocorreu: confira a atividade do PayPal. Esta versão não repete operações automaticamente e não realizou chamadas reais ao preparar o diagnóstico. Publique o commit/pacote atualizado antes de comparar as mensagens.
