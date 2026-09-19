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
| Handler do NestJS devolvendo `null` | Manda corpo VAZIO, e o cliente recebe `{}` — que é verdadeiro. Embrulhe: `{ caixa: null }` |
| URL montada com `localhost` para o cliente | Dentro de contêiner é o próprio contêiner. Use `API_PUBLIC_URL`, que aceita caminho relativo |
| Volume do Postgres em `/var/lib/postgresql/data` | Na imagem 18 é `/var/lib/postgresql`; o contêiner recusa subir |
| `LANG=pt_BR.UTF-8` em imagem Debian | Não existe gerada. Ordenação vem do ICU; `LANG` fica `C.UTF-8` |
| Chamar uma função de conferência e descartar o retorno | `conferirLimite` devolve "excedeu com autorização". Descartar grava o movimento como se tivesse cabido — e "nunca silencioso" vira silencioso |
| Helper de teste `async` devolvendo a cadeia do supertest | Sem `async`: a Promise não tem `.expect`. O `await` continua funcionando, a cadeia é thenable |
| Perfil do seed mais permissivo que o documento | `docs/` é a verdade. `npm run db:sync-perfis` aplica a correção sem apagar dados |
| RLS de cliente só onde há coluna `cliente_id` | Tabela filha precisa da política via `EXISTS` no pai; senão o portal esconde o pedido e mostra os itens |
| Ciclo de vida escrito como `if`s espalhados | Tabela `TRANSICOES` única. Transição não listada é proibida |
| Token do outro domínio numa rota | Dá **401**, não 403: falha na autenticação, não na permissão. É o desenho do ADR-009 |

## Testes

- `packages/core` — puro, sem banco. Rápido e exaustivo.
- `packages/db` — integração real contra o PostgreSQL.
- `apps/api` — ponta a ponta, com a aplicação de verdade.

Isolamento e autenticação **não** se testam com mock: metade da garantia está
no banco.

Precisa do banco preparado: `npm run db:setup && npm run db:migrate && npm run db:seed`.
