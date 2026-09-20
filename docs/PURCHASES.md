# Compras — a porta por onde a mercadoria entra com custo

> Fase 5. Este documento foi escrito **depois** do módulo, não antes: Compras
> e Contas nasceram sem documentação, e a primeira regra deste repositório é
> procurar a decisão em `docs/`. Um módulo que mexe em estoque e custo sem
> documento obriga o próximo a ler o código inteiro para descobrir o porquê.

## 1. O problema

Até aqui a mercadoria entrava por `POST /estoque/entrada`, um movimento avulso
com custo digitado à mão. Funciona para ajuste, não para compra: não há
fornecedor, não há nota, não há como responder "quanto paguei a este
fornecedor nos últimos 90 dias" nem "o custo deste item subiu quanto".

Compra é o documento. A entrada de estoque é **consequência** dela.

## 2. Ciclo de vida

```
RASCUNHO ──── receber ────► RECEBIDA ──── estornar ────► ESTORNADA
    │
    └──── excluir (só em rascunho)
```

- **RASCUNHO** não existe para o estoque. É a nota sendo digitada: itens,
  quantidades, custos. Pode ser alterada e excluída à vontade.
- **RECEBER** é o que move o mundo: grava os movimentos de entrada, aplica o
  custo e fecha a nota. Deixa de ser editável.
- **ESTORNAR** lança os movimentos contrários. A nota **não some** — vira
  `ESTORNADA` e continua no histórico, porque o estoque se moveu de verdade.

Receber não é salvar. É por isso que `PUT /compras/:id` recusa nota já
recebida em vez de "atualizar": reescrever a nota deixaria o razão de estoque
apontando para números que ninguém mais consegue ver.

## 3. Rotas

| Rota | Permissão | O quê |
|---|---|---|
| `GET /compras` | `compra.visualizar` | Lista, com recorte por status e fornecedor |
| `GET /compras/:id` | `compra.visualizar` | A nota com itens |
| `POST /compras` | `compra.receber` | Cria em `RASCUNHO` |
| `PUT /compras/:id` | `compra.receber` | Altera o rascunho |
| `DELETE /compras/:id` | `compra.receber` | Só rascunho |
| `POST /compras/:id/receber` | `compra.receber` | Grava os movimentos e aplica o custo |
| `POST /compras/:id/estornar` | `compra.receber` | Lançamentos contrários |
| `GET /compras/itens` | `compra.visualizar` | Busca de variação para montar a nota |
| `GET /compras/fornecedores` | `compra.visualizar` | Com `incluirInativos` |
| `POST /compras/fornecedores` | `compra.receber` | Cadastro |
| `PUT /compras/fornecedores/:id` | `compra.receber` | Edição e ativar/desativar |

`GET /compras/itens` existia antes da tela que o usa, e isso foi um defeito:
a nota nascia vazia e não havia como preencher. Rota nova só está pronta
quando alguém consegue apertar o botão.

## 4. O custo

Receber aplica a política de [COST_POLICY.md](COST_POLICY.md) §3, item a item.
Os dois casos que o documento prevê e que ninguém lembra aparecem no painel de
recebimento, com o custo médio **antes e depois** de cada linha:

- **saldo anterior zero** → o custo é **redefinido**, não ponderado. Fazer
  média com um passado que não existe inventa um número;
- **saldo anterior negativo** → a média é **preservada** até o saldo voltar a
  zero.

Mostrar antes e depois não é enfeite: é a única chance de alguém perceber que
digitou 3.800,00 onde queria 38,00 — e depois do recebimento o razão é
imutável.

## 5. Fornecedor

Documento **único por empresa**. É ele que impede o mesmo fornecedor entrar
duas vezes com nomes ligeiramente diferentes, e é por isso que a conferência
está no banco, não só na tela.

**Desativar não apaga.** O fornecedor aparece em notas já recebidas, e apagar
deixaria compras órfãs. Ele só sai da lista de escolha da nova entrada — e a
tela filtra por ativo, oferecendo "mostrar desativados", porque lista que
mostra tudo empurra o que importa para fora da primeira página.

## 6. Contas a pagar — o elo que **ainda não existe**

Receber uma nota **não gera título**. A mercadoria entra, o custo é aplicado,
e nada registra que a loja passou a dever ao fornecedor.

`OrigemTitulo.COMPRA` está no enum e o único jeito de gravá-lo hoje é alguém
abrir Contas, digitar o título à mão e lembrar de informar o `compraId`. Fora
o seed, há **dois** títulos com essa origem no banco de desenvolvimento — e
nenhum deles veio de um recebimento.

É a armadilha conhecida do "campo que o sistema tem e ninguém grava", aqui
custando uma dívida que só existe se alguém lembrar.

Quando for construído, Compras **chama** o serviço de Contas em vez de gravar
em `titulo_financeiro` por conta própria: módulo que grava dinheiro sozinho
vira um segundo lugar onde saldo muda. A nota precisará de condição de
pagamento — à vista, prazo em dias, parcelas —, que hoje ela também não tem.

## 7. Relatórios

Três, todos exigindo `relatorio.ver_custo` — ver [REPORTS.md](REPORTS.md):

- **Compras por fornecedor.** Volume, valor, participação e prazo médio.
  Prazo sem data de emissão é **nulo**, não zero: zero afirmaria que a
  mercadoria chegou no mesmo dia.
- **Evolução do custo de aquisição.** O que o fornecedor **cobrou**, nota a
  nota — não o custo médio, que mistura datas e fornecedores e não serve de
  argumento numa negociação. Item cujo primeiro custo era zero fica de fora:
  não existe "subiu infinito por cento".
- **Notas a receber.** Nota emitida e ainda fora do estoque: o custo já foi
  assumido e o saldo não subiu.

`compras/fornecedores` exige `ver_custo` embora não tenha "custo" no nome: ele
devolve valor e unidades lado a lado, e dividir um pelo outro dá o custo
unitário do fornecedor.

## 8. O que ainda não existe

- **Título a pagar gerado pelo recebimento** (§6). É o buraco maior: a dívida
  com o fornecedor depende de alguém lembrar de digitá-la.
- **Condição de pagamento na nota** — à vista, prazo, parcelas.
- **Pedido de compra.** Hoje a nota nasce quando a mercadoria chega. Não há o
  passo anterior — pedir, acompanhar, receber contra o pedido.
- **Rateio de frete e despesa** no custo dos itens.
- **Devolução ao fornecedor.** Hoje só o estorno da nota inteira.
- **Conferência cega do recebimento**, contando antes de ver o que a nota diz.

## 9. Testes obrigatórios

Em `apps/api/src/compras/compras.e2e.test.ts`:

1. A busca de itens devolve saldo e custo do destino — **nunca** preço de
   venda. Quem monta uma nota decide por custo.
2. A nota nasce em rascunho e não mexe no estoque.
3. O rascunho carrega o saldo atual do destino; a recebida, o custo congelado.
4. Receber recalcula o custo médio ponderado.
5. A mesma nota do mesmo fornecedor não entra duas vezes.
6. Nota recebida não se edita nem se apaga — corrigir é estornar.
7. O estorno devolve o saldo, exige motivo e não apaga a nota.
8. Nota sem itens não tem o que dar entrada.
9. As contagens contam o conjunto, não a página.
10. O cliente do portal não enxerga compra nenhuma.
