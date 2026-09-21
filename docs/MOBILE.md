# Aplicativo mobile

> Fase 6. Este documento existe desde a Fase 1 porque a decisão de mobile
> impõe restrições ao desenho da API — que é construída antes.

## 1. Restrição inegociável: nada de WebView

O aplicativo tem **estrutura nativa**. Não é uma aplicação web empacotada.

Estão proibidos, em qualquer fase e para qualquer tela:

| Proibido | O que realmente é |
|---|---|
| Capacitor | `WebView` com ponte para plugins |
| Cordova / PhoneGap | `WebView` com ponte para plugins |
| Ionic (modo WebView) | `WebView` |
| PWA instalada | O navegador do sistema com ícone |
| TWA (Trusted Web Activity) | Chrome em tela cheia |
| `WebView` embutido "só numa tela" | `WebView` |

A única exceção admissível é uma tela de **checkout de terceiro** que o próprio
provedor de pagamento exija abrir em navegador — e, nesse caso, no navegador do
sistema (Custom Tabs / `SFSafariViewController`), não em `WebView` embutido.
Isso não é uma tela do aplicativo; é uma saída para outro domínio.

### Por que, além do requisito

O PDV mobile depende de **leitura contínua de código de barras** no balcão.

Em `WebView`, isso obrigatoriamente passa por `getUserMedia` mais decodificação
em JavaScript. Na prática significa: sem controle de autofoco, sem controle de
exposição, sem acesso ao scanner de hardware de coletores, e decodificação por
software que degrada sob a iluminação real de uma loja. A diferença entre um
leitor que funciona e um que o vendedor abandona no segundo dia.

## 2. Decisão: React Native + Expo

**ADR-007.** Aplicativo em React Native com toolchain Expo.

### React Native é nativo — o ponto que gera confusão

React Native não renderiza HTML. Não há `WebView`, DOM, HTML ou CSS envolvidos.

| Camada | O que é |
|---|---|
| Lógica | JavaScript/TypeScript em **Hermes** (motor compilado AOT para bytecode) |
| Interface | **Views nativas reais**: `android.view.View`, `UIView` |
| Renderizador | **Fabric** — árvore de views em C++, montagem síncrona |
| Acesso nativo | **TurboModules** via JSI, sem ponte assíncrona serializada |
| Artefato | `.aab` / `.apk` e `.ipa` reais, publicáveis nas lojas |

Expo não é um empacotador de web: é toolchain e SDK sobre o React Native.
`expo prebuild` gera os projetos Android e iOS nativos; EAS Build compila
binários nativos. Módulos nativos próprios em Kotlin/Swift continuam possíveis.

### Por que esta opção e não Kotlin + Swift

O fator decisivo não é a UI — é a **regra de negócio**.

Preço por tabela, arredondamento monetário, validação de item, permissões e
formato de payload precisam ser idênticos em backend, web e mobile. Com React
Native, `packages/contracts` (schemas Zod) e `packages/core` são consumidos
literalmente pelo aplicativo. Com Kotlin/Swift, essas regras seriam
**reescritas** — duas ou três vezes, divergindo a cada alteração.

Num sistema onde divergência de arredondamento vira diferença de caixa, esse é
o risco que mais importa.

### O que foi aceito como custo

- Uma camada JS entre a UI e o sistema. Para telas de lista, formulário e
  scanner — o que este app faz — é irrelevante.
- Módulos nativos de terceiros entram na superfície de manutenção.
- Atualização de versão do React Native exige atenção real, não é rotina.

### Revisão

Se surgir requisito de processamento pesado no dispositivo (visão
computacional própria, uso intenso e prolongado de câmera), a decisão é
reavaliada — possivelmente com um módulo nativo dedicado em vez de trocar toda
a stack.

## 3. Versões verificadas (19/09/2026)

| Pacote | Versão |
|---|---|
| `react-native` | 0.87.1 |
| `expo` | 57.0.24 |
| `react-native-vision-camera` | 5.2.3 |
| `expo-camera` | 57.0.5 |

Leitor de código de barras: **`react-native-vision-camera`**, que usa ML Kit no
Android e Vision no iOS — ambos nativos, com autofoco e leitura contínua.
`expo-camera` fica como alternativa se a integração se mostrar suficiente.

## 4. Consequências para a API — valem desde a Fase 1

O aplicativo mobile impõe requisitos ao backend que precisam existir **antes**
da Fase 6, senão viram retrabalho:

1. **Toda escrita é idempotente.** Conexão de balcão cai. O app reenvia. O
   servidor não pode duplicar venda, baixa de estoque nem comissão. Chave
   `Idempotency-Key` por requisição de mutação.
2. **Respostas compactas e paginadas por cursor.** Offset com dado mudando sob
   os pés repete e pula registros.
3. **Autenticação sem cookie.** O refresh token do mobile vai em armazenamento
   seguro do sistema (Keychain / Keystore), não em cookie. O backend suporta
   os dois modos desde o início.
4. **Erros legíveis por máquina.** Código estável (`SALDO_NEGATIVO_BLOQUEADO`),
   não apenas mensagem em português, para o app decidir o que fazer.
5. **Catálogo com sincronização incremental.** `updatedSince` para o app não
   rebaixar o catálogo inteiro a cada abertura.
6. **Versionamento de API.** O app instalado fica para trás do servidor. A API
   é versionada e mantém compatibilidade regressiva.

Nenhum desses seis itens é sobre mobile especificamente — todos tornam a API
melhor. Mas são exatamente os que costumam ser descobertos tarde demais.

## 5. Onde cada um está — auditado em 20/09/2026

Antes de começar o aplicativo, os seis foram conferidos contra o código. Três
não existiam, e o primeiro era o pior: a tabela `chave_idempotencia` estava
migrada desde o início e **nenhuma linha de código a lia**. Este documento,
`docs/ORDERS.md` §7 e `docs/WALLET.md` §5 afirmavam que a chave era enviada —
o schema dava a impressão de resolvido.

| # | Item | Estado |
|---|---|---|
| 1 | Idempotência | **Feito.** `IdempotenciaInterceptor` lê `Idempotency-Key` em POST/PUT/PATCH/DELETE. Reserva a chave, guarda a resposta, devolve a mesma no reenvio. Falha NÃO é guardada: reenviar depois de erro tem de poder tentar de novo |
| 2 | Cursor | **Já existia.** Onze listagens. Catálogo do portal e buscas têm teto fixo, o que é aceitável: busca por código de barras devolve um item |
| 3 | Sem cookie | **Feito.** Login e refresh já aceitavam `canal: 'app'`; o **logout só lia o cookie** e devolvia 204 sem revogar nada — no celular a sessão sobrevivia os 30 dias do refresh |
| 4 | Erro com código | **Feito.** `ErroFiltro` global. Antes, 429, 404 e todo `ErroDominio` de `@estoque/core` saíam sem `codigo` |
| 5 | Sincronização incremental | **Falta.** Nenhuma rota aceita "só o que mudou desde X". O catálogo do balcão cabe numa carga; vira problema quando não couber |
| 6 | Versionamento | **Falta.** Prefixo `/api`, sem `/v1`. Só importa quando houver aplicativo instalado em campo atrás do servidor — mas é aí que não dá mais para escolher |

Os dois que faltam não impedem o aplicativo de existir; impedem que ele
envelheça bem. Estão registrados aqui para não serem descobertos de novo.

## 6. O aplicativo — `apps/mobile`

Existe desde 21/09/2026. Domínio de FUNCIONÁRIO; o do cliente fica para
depois. Telas: entrar, fila de pedidos, conferência, PDV com leitor,
consulta de estoque e conta.

**O pagamento ainda não.** O carrinho está pronto e a tela DIZ isso, em vez
de oferecer um botão que não leva a lugar nenhum.

Duas coisas descobertas ao construir, e as duas contrariam o que se encontra
escrito por aí:

- **A API do `react-native-vision-camera` 5 não é a da v4.** A versão fixada
  na tabela acima está certa; o exemplo que aparece em toda documentação de
  terceiros — `useCodeScanner` e a prop `codeScanner` — é da v4. A v5 foi
  reescrita sobre Nitro: `usePreviewOutput` e `useObjectOutput` montam as
  saídas, e elas vão em `outputs`.
- **`@types/react` precisa ser ÚNICO no monorepo.** Fixar 19.1.1 aqui (o peer
  do React Native) contra 19.3.0 na raiz produz `'View' cannot be used as a
  JSX component` — um erro que não parece de versão.

Para compilar: `apps/mobile/README.md`. O APK exige JDK 17 e Android SDK, que
não estão nesta máquina; o código está pronto e o `prebuild` configurado.
