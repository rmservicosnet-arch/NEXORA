# Instruções para agentes neste repositório

Leia antes de alterar qualquer coisa. O que está aqui não é estilo — é o que
impede erro caro num sistema que mexe com estoque e dinheiro.

## Antes de escrever código

1. Procure a decisão em `docs/`. Quase tudo já foi decidido e justificado.
2. Se o código contradiz o documento, **o código está errado** — a menos que
   você mude os dois no mesmo commit, com o motivo.
3. Rode `npm run typecheck`, `npm run lint` e `npm test` antes de dizer que
   terminou. "Deve funcionar" não conta.

## Regras que não se negociam

### Dinheiro e quantidade

Nunca `float`, nunca `number` para valor monetário. Use `Decimal` de
`@estoque/core`:

```ts
import { dec, formatarBRL } from '@estoque/core';

dec('38.40')   // ✅
dec(38)        // ✅ inteiro é exato
dec(38.4)      // ❌ lança ValorImprecisoError
```

O lint bloqueia `parseFloat` e `Math.round`. Se você precisar deles em código
monetário, o desenho está errado.

Escalas: valor `numeric(14,2)`, custo `numeric(18,6)`, quantidade
`numeric(18,6)`. Custo tem 6 casas porque é resultado de divisão.

### Isolamento entre empresas

O `tenantId` vem **do token validado** e de mais lugar nenhum. Nunca do corpo,
da query ou de um header — o guard trata divergência como
`CROSS_TENANT_ATTEMPT`.

Toda leitura e escrita de dado de empresa acontece dentro de `comEscopo` ou
`comEscopoAtual`:

```ts
const lojas = await comEscopoAtual(prisma, (tx) => tx.loja.findMany());
```

Note que não há `where: { tenantId }`. O PostgreSQL aplica o escopo. Esquecer
um filtro não vaza nada — é para isso que o RLS existe.

Nunca conecte a aplicação com `DIRECT_URL`. `criarPrisma` recusa papel com
`BYPASSRLS` e derruba a inicialização.

### Histórico é imutável

`movimento_estoque`, `carteira_movimento`, `audit_log` e `pedido_evento` são
*append-only*. Nunca `UPDATE`, nunca `DELETE`. Estorno gera lançamento
contrário referenciando o original.

Preço e custo são **congelados** no item da venda e do pedido. Mudança futura
na tabela de preços não reescreve faturamento passado, e compra de hoje não
altera a margem do mês passado.

### Rotas nascem protegidas

Os guards são globais. Abrir uma rota exige `@Publico()` explícito. Esquecer
fecha, não abre.

`@Permissoes()` diz **o quê**; `@EscopoLoja()` diz **onde**. São perguntas
diferentes e as duas precisam de resposta.

### Esconder botão não é segurança

`SePode` e `PermissionGuard` existem para não oferecer caminho que vai falhar.
Toda ação é revalidada no servidor — sem exceção.

## Convenções

- **Código e comentários em português.** O domínio é em português; traduzir
  metade cria duas linguagens no mesmo arquivo.
- Comentário explica **por que**, não o que. O código já diz o que faz.
- Versões **exatas** no `package.json` (`save-exact=true`). Atualização é
  decisão, não efeito colateral de `npm install`.
- Erro de domínio carrega `codigo` estável, legível por máquina. A mensagem em
  português é para humano e pode mudar; o código é contrato.

## Antes de mudar dependência

Confira as versões publicadas em vez de supor. Duas armadilhas já encontradas
neste repositório:

- `prisma@latest` apontava para um release candidate enquanto
  `@prisma/client` estável era outro. Ver ADR-003.
- NestJS 12 exige TypeScript 7, e `typescript-eslint` não suporta TS 7 — o
  projeto ficaria sem lint. Ver ADR-010.

Nunca use `--force` nem `--legacy-peer-deps` para calar um conflito. Eles
silenciam um requisito declarado pelo fornecedor e transferem o problema para
o runtime.

## O que já mordeu, para não morder de novo

| Armadilha | O que fazer |
|---|---|
| `@updatedAt` do Prisma não gera default no banco | Sempre com `@default(now())`, senão `INSERT` em SQL puro falha |
| Cliente Prisma gerado dentro de `src` | Fica em `packages/db/generated`; `tsc` não copia `src/generated` para `dist` |
| `SET` em vez de `SET LOCAL` | O pool reaproveita a conexão e vaza o tenant anterior |
| Pacote CommonJS consumido pelo Vite | `@estoque/contracts` tem saída dupla ESM/CJS |
| Várias renovações de token simultâneas | O cliente web compartilha uma só promessa; senão o servidor vê reuso e derruba a sessão |
| Cache do TanStack Query sobrevivendo à troca de usuário | `queryClient.clear()` ao entrar e ao sair; a chave descreve o filtro, não quem perguntou — foi assim que a coluna de custo do admin apareceu para uma vendedora |
| `Slot` do Radix com mais de um filho | `Botao` com `comoFilho` emite só `children`; `{spinner}{children}` vira array e o Radix lança |
| Mensagem de validação do Zod em inglês | `packages/contracts/src/idioma.ts` configura pt-BR; o mesmo schema valida no navegador e na API |
| `_count` de relação com exclusão lógica | Sempre com `where`; senão foto excluída conta como foto e o produto publica sem ter nenhuma |
| Eleger "o primeiro" em operações paralelas | Quatro envios simultâneos disputam a capa; o índice único derruba três. Engolir o P2002 é o correto — abortar a operação inteira não |
| Ler saldo, calcular e gravar sem travar a linha | `SELECT … FOR UPDATE` antes de todo cálculo de estoque; senão o razão deixa de encadear e nenhuma tela mostra |
| Travar duas linhas em ordem variável | Sempre na mesma ordem de id. Transferências cruzadas viram deadlock |
| Guardar o item buscado e reusar a foto dele | Saldo congelado no momento da busca faz o operador decidir pela quantidade errada; releia do servidor |
| Pré-preencher formulário cortando pelo disponível | Disponível é aviso, não teto. Cortar faz a falta de estoque devolver o item ao cliente sozinha — o oposto de "nunca silencioso". Sugira o que foi pedido e grite a falta |
| Avisar só por `title` | No celular não há hover, e é no celular que a equipe aprova. Aviso é elemento visível |
| Largura fixa numa tela de uso móvel | 240px de menu num telefone de 375px não é acabamento: é a funcionalidade não existir. Empilhe abaixo do ponto de corte e devolva as colunas com `sm:contents` |
| Renovar o refresh duas vezes com o mesmo cookie | A revogação por reuso derruba a família inteira — a sessão boa junto. Uma promessa compartilhada por aba **e** `navigator.locks` entre abas. O caminho de boot também conta |
| Reusar o erro de login na renovação | Sessão expirada não é senha errada; manda a pessoa trocar uma senha certa. `SESSAO_ENCERRADA` à parte, ainda sem distinguir o motivo |
| Campo que o sistema LÊ e ninguém consegue gravar | `cliente.tabelaPrecoId` decidia o catálogo inteiro e só o seed o preenchia. Antes de usar uma configuração, procure a tela que a define |
| Rota reusada entre os dois domínios | O cliente carrega só `portal.acessar`: `@Permissoes(produto.visualizar)` lhe dá 403. Domínio separado quer rota separada — e recorte próprio, porque uuidv7 é adivinhável |
| Linha no banco sem os bytes no armazenamento | Envio interrompido, banco restaurado sem objetos, diretório limpo. Vira 500 com pilha; traduza para 404 — o servidor sabe o que houve |
| Um só cofre de token para dois domínios | Entrar no portal derrubaria a sessão da equipe na mesma aba. O token é por domínio, e o domínio sai do CAMINHO, não de um parâmetro por chamada |
| Preço da busca vindo de tabela diferente da que grava | A tela mostrava R$ 129,90 e o pedido gravava R$ 110,42. Quem busca item para um pedido pede o preço da tabela DAQUELE pedido — e a tabela entra na chave do cache |
| Invariante do razão inteiro medido numa página | Somar a primeira página e comparar com o saldo total passa enquanto o cadastro é novo. Siga o cursor até o fim |
| SKU fixo em teste de ponta a ponta | Passa na primeira execução e dá 409 em todas as seguintes, contra o mesmo banco. Sufixo aleatório |
| Schema novo em `@estoque/contracts` sem rebuild | A API importa o pacote CONSTRUÍDO: o schema chega `undefined` e o `ZodPipe` quebra com `safeParse of undefined` |
| Perfil montado com `apenas('grupo')` | O curinga concede toda permissão FUTURA do grupo. Já aconteceu duas vezes. Permissão sensível quer lista explícita |
| `cliente_acesso` sem `credencial_login` | A credencial existe e não autentica: o login não descobre de qual empresa a pessoa é. E o índice `(dominio, email)` é GLOBAL |
| Redefinir senha sem revogar sessão | Redefine-se porque a senha pode ter vazado; a sessão aberta sobreviveria à troca |
| Senha de terceiro digitada por quem cadastra | O servidor gera, mostra uma vez e guarda só o hash. Poder mostrar de novo significa ter guardado |
| Teste procurando a palavra "senha" no JSON | Um e-mail com ela derruba o teste sem nada ter vazado. Procure `senhaHash` e `$argon2` |
| "Sem ponto de corte" lido como "quebra no celular" | Tabela larga dentro de `overflow-x-auto` rola e não vaza. Meça `scrollWidth` contra `innerWidth` no navegador antes de afirmar |
| Cálculo que soma tabela escondida pelo RLS | `estoque_reserva` é invisível ao portal, e `saldo − reservas` virou `saldo − 0`: o catálogo anunciava item todo reservado. Use `disponivel_no_local`, função `SECURITY DEFINER` que devolve só o número |
| `SECURITY DEFINER` sem filtro de tenant | A função ignora o RLS por definição. O `tenant_id` tem de ser filtrado à mão, em cada subconsulta, ou ela vira o vazamento que o RLS impede |
| Agendador dentro da API | Duas instâncias no ar rodam a rotina duas vezes e disputam as mesmas linhas. Quem agenda é o sistema operacional: `npm run expirar` por cron |
| Prazo gravado que ninguém lê | `expiraEm` existia desde o início e nada o consultava: reserva vencida prendia estoque para sempre. O filtro vai no CÁLCULO, não só na rotina de limpeza |
| `bg-[--minha-var]` no Tailwind 4 | O atalho não gera nada: sai `transparent`. Use `bg-[var(--minha-var)]`. Ficou invisível em 155 lugares sem ninguém notar — cor de status não dá erro, só some |
| Estado de tela guardado sem dizer a QUEM pertence | Ir de um pedido para outro não remonta o componente: a rota é a mesma, muda o parâmetro. As decisões do anterior ficavam na tela |
| Largura mínima dentro de linha flex | Item de flex não encolhe abaixo do conteúdo (`min-width: auto`). A tabela empurrou o painel lateral inteiro para fora da tela, num `overflow-hidden` — invisível E sem rolagem. `min-w-0` na coluna, mínimo só dentro do que rola |
| "Fora da tela" contado sem perguntar se dá para rolar | Tabela larga tem conteúdo à direita de propósito. O defeito é o que está fora E sem ancestral que role: some sem aviso |
| Aba cujo rótulo, contagem e consulta discordam | "Aguardando confirmação" consultava `apenasFila`, que inclui confirmado; o número ao lado contava só os aguardando. Cada aba lista EXATAMENTE o que a contagem dela conta |
| Vários recortes do mesmo campo espalhados no `where` | `status`, `statusEm` e `apenasFila` como spreads: o último sobrescreve o anterior em silêncio. Resolva num só lugar |
| Chave de configuração que não faz nada | Pior do que não existir: a pessoa configura, confia, e nada muda. Declare em `semEfeito` e desabilite na tela — esconder faz o campo parecer esquecido |
| Id devolvido onde a tela espera nome | `movimento.ator` era o `ator_id`: a coluna "Usuário" mostrava uuid. Sem chave estrangeira (o razão é append-only), resolva o nome numa consulta por página |
| BOM escrito literal no código-fonte | Vira erro de lint e some em qualquer cópia. Use `String.fromCharCode(0xfeff)` |
| Teste que cria dado visível e não limpa | Tabela de preço criada em teste aparece na grade de TODO produto. Desative no `afterAll` — o teste não pode degradar o ambiente que usa |
| `replace` sem conferir se o âncora existe | Troca silenciosa que não acontece: o arquivo fica sem a declaração e o erro só aparece em execução |
| Handler do NestJS devolvendo `null` | Manda corpo VAZIO, e o cliente recebe `{}` — que é verdadeiro. Embrulhe: `{ caixa: null }` |
| URL montada com `localhost` para o cliente | Dentro de contêiner é o próprio contêiner. Use `API_PUBLIC_URL`, que aceita caminho relativo |
| Volume do Postgres em `/var/lib/postgresql/data` | Na imagem 18 é `/var/lib/postgresql`; o contêiner recusa subir |
| `LANG=pt_BR.UTF-8` em imagem Debian | Não existe gerada. Ordenação vem do ICU; `LANG` fica `C.UTF-8` |
| Chamar uma função de conferência e descartar o retorno | `conferirLimite` devolve "excedeu com autorização". Descartar grava o movimento como se tivesse cabido — e "nunca silencioso" vira silencioso |
| Helper de teste `async` devolvendo a cadeia do supertest | Sem `async`: a Promise não tem `.expect`. O `await` continua funcionando, a cadeia é thenable |
| Perfil do seed mais permissivo que o documento | `docs/` é a verdade. `npm run db:sync-perfis` aplica a correção sem apagar dados |
| RLS de cliente só onde há coluna `cliente_id` | Tabela filha precisa da política via `EXISTS` no pai; senão o portal esconde o pedido e mostra os itens |
| Ciclo de vida escrito como `if`s espalhados | Tabela `TRANSICOES` única. Transição não listada é proibida |
| Cabeçalho com "Salvar" e campo que grava no `blur` | Os dois controles nascem decorativos e "alterações não salvas" nunca acende. Quem grava é o botão |
| Barra de gráfico com altura em % dentro de `items-end` | O pai desliga o `stretch`, a porcentagem vira `auto` e o gráfico fica vazio. O trilho precisa de `h-full` |
| Grade de altura definida com `grid-auto-rows: auto` | A linha é ESTICADA para caber: 60 cartões viraram faixas de 34px, com o conteúdo cortado pelo `overflow-hidden` de cada um. Altura de linha explícita e `content-start` |
| Página que rola pelo CORPO | O menu lateral sobe junto e some. O shell trava a altura na tela; quem rola é a região de dentro |
| `prisma migrate dev` interrompido | A conexão órfã segura `pg_advisory_lock` e toda migração seguinte expira. Encerre o backend `idle` que a detém; `migrate deploy` é o comando não interativo |
| Tela que lista tudo, inclusive o desativado | 19 lojas de teste inativas empurraram as três de verdade para fora da tela. Filtre por ativo e ofereça "mostrar desativadas" |
| `ORDER BY` por coluna não qualificada | O PostgreSQL prefere o nome de SAÍDA: `ORDER BY valor` com `valor::text` no SELECT ordena TEXTO. Qualifique (`b.valor`) quando houver cast |
| Curva ABC classificada pela página | A acumulada só significa algo contra o conjunto inteiro. Janela sobre tudo, `LIMIT` depois — e o teste compara as letras de uma página de 5 com as da de 200 |
| Margem calculada com custo zero | Dá 100% e parece lucro. Custo zero é item que nunca teve entrada com custo: a margem é nula, não cheia |
| Rótulo de coluna mais forte do que a conta | "Valor parado" mostrava `saldo × custo` de QUALQUER item, inclusive o que girou bem. Quem lê decide pelo rótulo, não pela fórmula |
| Resumo de relatório contado sobre a página | Pedir 10 linhas devolvia "no máximo 10 em trânsito". Indicador conta o conjunto; a lista é uma página dele |
| Cobertura de estoque escrita como "infinita" | Sem venda não há ritmo: é ausência de giro, não excesso de cobertura. Nulo, e a tela escreve "sem giro" |
| Exportação montada no navegador | O CSV nunca passa pela API: "quem levou dado de custo" fica em branco e parece dizer que ninguém exportou. A tela AVISA o servidor antes de baixar |
| Conjunto sensível definido por prefixo | `acao LIKE 'CARTEIRA_%'` inclui toda ação FUTURA sem ninguém decidir — o mesmo erro do curinga de permissão. Lista explícita |
| Detectar custo por `LIKE '%custo%'` | `com_custo` é a coluna que DIZ se havia custo, não o custo. Ancore no começo do nome |
| Antes e depois despejados como JSON | Quem audita compara chave a chave e a alteração passa batido. Devolva só os campos que mudaram |
| Enum do Postgres comparado com `text[]` | `p.status = ANY($1::text[])` dá "operador não existe". O cast vai no enum: `p.status::text` |
| Vetor de parâmetros compartilhado entre consultas | Uma consulta que não usa `$1` recebe o parâmetro e o Postgres recusa a ligação inteira. Cada consulta com os seus |
| Campo novo gravado pela aplicação depois de o schema subir | As linhas fechadas no meio ficam com o default. `venda.troco` zerado somava R$ 37,50 de dinheiro que voltou ao cliente. Confira o invariante depois de todo deploy em duas partes |
| Seed que decide valor a valor e confia no comentário | Mexer num lançamento empurra o saldo e transforma OUTRO em excedente. O seed obedece à mesma regra do serviço: excedeu sem justificativa, ele para |
| Cursor devolvido pelo servidor e ignorado pela tela | `proximoCursor` voltava e nada o usava: com 3.888 variações, quem precisava da 81ª rolava até o fim e não achava caminho |
| Denominador do rodapé contando fora do recorte | "Exibindo 2 de 3888" com um filtro de 2 itens manda procurar 3.886 linhas que o filtro excluiu. O rodapé conta o que a LISTA mostra |
| Página numerada em tela com rascunho | Trocar de página desmonta as linhas com preço digitado e o trabalho some sem aviso. Acrescente ao fim; quem grava é o botão |
| Fluxo documentado com metade do caminho construído | Dava para INCLUIR e REMOVER item de pedido e não dava para mudar dois para cinco — a negociação emperrava numa operação que o §6 previa. Leia a tabela do documento inteira |
| Teto de confirmação preso ao pedido original | O cliente aceitava o aumento e a confirmação recusava "mais do que foi pedido". O teto vem do ACORDO registrado, não do envio |
| Dois controles para a mesma coisa na mesma tela | O stepper da conferência e um campo de edição: um sempre ativo, o outro só no modo — e o botão "Editar" parecia BLOQUEAR. Um controle, que o modo LIBERA |
| Contagem pesada por linha da listagem | Uma varredura de `variacao` por tabela de preço: 144 tabelas viraram 144 varreduras por chamada. Agrupe uma vez e subtraia |
| Resultado de busca que desce num bloco de rodapé | Empurra o próprio campo de busca para fora da tela. Lista para cima |
| Lista de escolha sem o que distingue as opções | Dois "Kimono Trançado Judô" com preços diferentes: faltavam SKU, variação e saldo, que é o que decide |
| Token do outro domínio numa rota | Dá **401**, não 403: falha na autenticação, não na permissão. É o desenho do ADR-009 |
| Formato de resposta trocado e só o teste do módulo atualizado | O catálogo virou objeto e três arquivos de e2e continuaram chamando `.find` nele. Ao mudar o corpo de uma rota, procure a ROTA em todos os testes, não o tipo |
| Pilha de avisos idênticos no topo da lista | Sessenta e nove faixas âmbar não chamam atenção para nada — é a parede de avisos de novo. Acima de um, um aviso só, com o número e o caminho até eles |
| Item de flex com `overflow:hidden` numa linha curta demais | `line-clamp` e `truncate` ligam `overflow:hidden`, e isso anula o `min-height:auto` que impediria o encolhimento: três linhas de texto viraram 3px, sem erro nenhum. Altura de linha é PISO (`minmax(h,auto)`), e todo texto leva `shrink-0` |
| `flex-1 min-w-0` numa linha `flex-wrap` | Não quebra: esmaga. O nome do produto virou uma letra no celular enquanto os controles seguiam na mesma linha. Quem precisa de duas linhas pede grade com posição explícita |
| Recortes que não particionam o total ao lado deles | "Todos 1462" com quatro pílulas somando 1166: cancelado e expirado não cabiam em nenhuma. Ou a soma fecha, ou "Todos" não mostra número |
| Rota com permissão própria que nenhuma tela chama | `POST /caixa/:id/conferir` existia desde o início e CONFERIDO era um status que nada alcançava. Antes de criar rota, procure quem vai apertar o botão |
| Parcela somada dentro de outra no painel de conferência | `vendasEmDinheiro` já vinha líquido do troco: quem confere via um número e não tinha como achar os R$ 812,50 que saíram da gaveta. Cada parcela da fórmula é uma coluna |
| Rodar `npm run db:seed` sem autorização | Ele LIMPA antes de criar. Falhou no meio e deixou o banco pela metade: produtos, preços, clientes e pedidos apagados, nada recriado. Seed é comando destrutivo — pergunte antes |
| Seed que não apaga tudo o que referencia usuário | Faltava `caixa`, e `usuario.deleteMany` violava a FK. O seed morria NO MEIO da limpeza. A ordem das exclusões é parte do contrato, não detalhe |
| `prisma migrate dev` num terminal não interativo | Fica pendurado depois de aplicar, esperando resposta que nunca vem. A migração entra e o comando nunca volta; `migrate deploy` é o não interativo |
| Faixa de tempo com piso zero e relógio adiantado | "Menos de 1 h" exigia `horas >= 0`: pedido gravado no futuro dá −3 e não cai em faixa NENHUMA. A primeira faixa não tem piso |
| Endpoint construído sem a tela que o usa | A busca de itens de compra existia e nada a chamava: a nota nascia vazia e não havia como preencher. Rota nova só está pronta quando alguém consegue apertar o botão |
| Módulo que grava dinheiro por conta própria | A baixa de título chama o CAIXA e a CARTEIRA em vez de lançar sozinha. Cada um com as suas regras e a sua auditoria — senão viram dois lugares onde saldo muda |
| Indicador financeiro somando o valor cheio | "Em aberto" tem de somar `valor − pago`: um título de 9.600 com 4.743 pagos pesa 4.856, não 9.600. Somar o cheio mostra dívida que já não existe |
| Estado de painel que não remonta ao trocar de linha | Abrir outro título não desmonta o componente: a rota é a mesma. O valor digitado para o anterior ficava no seguinte — o estado carrega o id do dono |
| Módulo novo sem cenário no seed | Compras, Contas e Caixa nasceram com a tela certa e a base vazia — e o que aparecia era o lixo dos próprios testes. Tela nova pede dado de seed junto, senão só o e2e a preenche |
| Teste de e2e que cria e não limpa, de novo | 46 notas "T7X2K9" e 36 "título de teste" empurraram os de verdade para fora da primeira página. `afterAll` apaga rascunho, ESTORNA recebida e CANCELA título — pelas ações do domínio, nunca por `delete` escondido |
| Seed que cria o que a API recusaria | Fundo 200 + suprimento 500 − sangrias 1000 dá −300 na gaveta: o serviço recusa sangria maior do que existe, mas o seed escreve direto. Dado de demonstração obedece às mesmas invariantes |
| Largura do artboard virando teto da tela | 1152px é o que sobra DENTRO de um artboard de 1440. Num monitor de 1900 vira coluna centralizada com 250px de vazio de cada lado — e só essas telas faziam isso. O artboard dá proporção, não largura máxima |
| Colunas lado a lado com `items-start` | A curta para onde acaba e deixa um vazio de PÁGINA embaixo, do tamanho da outra. Igualar a altura move o vazio para dentro do cartão, que é onde ele parece intencional — e o cartão rola por dentro |
| Aging somando o valor cheio do título | Um título de 9.600 com 4.743 pagos pesa 4.856 na faixa, não 9.600. E as faixas têm de FECHAR com o total: buraco ou sobreposição, quem lê não descobre qual coluna mente |
| "Fluxo de caixa" misturando previsto com realizado | Título em aberto com vencimento no período é promessa. Somá-lo faz o fluxo mentir exatamente no mês em que ninguém pagou — e a ressalva vai na RESPOSTA, não só na tela |
| Prazo de entrega zero quando falta a emissão | Zero afirma "chegou no mesmo dia". Sem a data de saída não há prazo: nulo, e a coluna escreve "sem emissão" |
| Custo de aquisição lido do custo médio | A média mistura datas e fornecedores. O que se leva para negociar é o que o fornecedor COBROU, nota a nota — e custo inicial zero não vira "subiu infinito%" |
| Classificar cliente pela tabela de preço | Tabela diz quanto ele PAGA; perfil diz quem ele É. Mover um professor para uma tabela promocional por um mês o tirava do ranking de revendedores por um motivo que nada tem a ver com revenda. Campos separados |
| "Quem mais vendeu" quando o sistema só vê compra | A revenda do professor acontece fora daqui. Medir a compra e chamar de venda é rótulo mais forte do que a conta — e é o número que vai premiar alguém |
| Ranking que esconde quem sumiu | Uma lista de quem comprou não tem linha para quem parou de comprar. O programa de premiação precisa justamente desse: conte à parte |

## Testes

- `packages/core` — puro, sem banco. Rápido e exaustivo.
- `packages/db` — integração real contra o PostgreSQL.
- `apps/api` — ponta a ponta, com a aplicação de verdade.

Isolamento e autenticação **não** se testam com mock: metade da garantia está
no banco.

Precisa do banco preparado: `npm run db:setup && npm run db:migrate && npm run db:seed`.
