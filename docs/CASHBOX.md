# Caixa

> Fase 5. O caixa controla o **dinheiro físico da gaveta**.

## 1. O que o caixa controla — e o que não controla

Cartão e PIX **não passam pelo caixa**. Vão para a adquirente, não para a
gaveta. Contá-los no fechamento faria o operador procurar, em espécie, um
dinheiro que nunca esteve ali.

Eles aparecem no painel do turno — separados, para conferir o movimento do
período — mas fora da conta do que se espera na gaveta.

## 2. Um caixa aberto por vez

No modo `POR_OPERADOR` (padrão), a garantia é do **banco**: índice único
parcial `caixa_aberto_por_operador` sobre `(tenant, loja, operador)` onde
`status = 'ABERTO'`.

O `WHERE` não é detalhe. Sem ele, o operador não conseguiria abrir um segundo
caixa nunca mais — nem depois de fechar o primeiro.

No modo `COMPARTILHADO_POR_LOJA` a regra é "um por loja", que **não cabe** nesse
índice. Ela é verificada na aplicação, e portanto é uma garantia mais fraca:
duas aberturas exatamente simultâneas na mesma loja passariam. Está registrado
aqui em vez de escondido.

## 3. Dinheiro exige caixa aberto

Uma venda com qualquer pagamento em `DINHEIRO` precisa de caixa aberto:
dinheiro que entra sem caixa é dinheiro que ninguém vai conferir no fim do
turno. Sem caixa, a API recusa com `409 CAIXA_FECHADO`.

Venda só em cartão ou PIX **não** exige — exigir pararia a loja sem proteger
nada. Se houver caixa aberto, ela é vinculada a ele mesmo assim, para o
relatório do turno ficar completo.

A recusa acontece **antes de qualquer escrita**. Baixar estoque e descobrir no
fim que a venda não podia ser registrada seria o pior dos mundos.

O PDV pergunta pelo caixa ao abrir a tela, não ao fechar a venda: descobrir o
problema com o carrinho montado é fazer o cliente esperar por uma informação
que já existia.

## 4. A conta do esperado

```
esperado = fundo de troco
         + suprimentos
         − sangrias
         + (dinheiro recebido − troco)
```

**O troco é subtraído porque saiu da gaveta.** Uma venda de R$ 50 paga com
R$ 100 deixa R$ 50, não R$ 100. Somar o recebido sem descontar o troco infla o
esperado e transforma todo caixa que deu troco numa falta.

É por isso que `venda.troco` é uma **coluna gravada** e não uma conta feita na
hora: é ela que a conferência subtrai, e recalcular `recebido − total` em cada
conferência espalharia a mesma fórmula por vários lugares.

O painel mostra a conta **aberta em parcelas**, nunca só o total. Quem confere
precisa ver de onde cada parcela veio; diante de uma diferença, a única saída
seria aceitar o número.

## 5. Fechamento: a diferença fica como é

O operador informa o que **contou na gaveta**, não a diferença. Pedir a
diferença faria conferir contra o número do sistema em vez de contar o
dinheiro — que é justamente o que a conferência existe para evitar.

`diferenca = contado − esperado`. Negativo é falta, positivo é sobra.

**Não há ajuste automático nem tolerância silenciosa.** Um caixa que fecha
sempre exato porque o sistema arredonda é um caixa que não controla nada.

## 6. Conferência: outra pessoa

Quem fechou **não confere** o próprio caixa. Conferência é o segundo par de
olhos; feita pela mesma pessoa, é assinatura em branco. Exige
`caixa.conferir`, e o status vai a `CONFERIDO`.

A diferença registrada no fechamento **não muda** na conferência. Conferir é
atestar que alguém olhou, não corrigir o número.

## 7. O caixa é de quem o abriu

Sem `caixa.conferir`, ninguém vê nem mexe no caixa de outra pessoa — nem na
listagem. O valor da gaveta alheia é o que aquela pessoa vai ter de justificar
no fechamento.

## 8. Sangria e suprimento

Append-only, como todo razão aqui. Não se corrigem: lança-se o contrário.

**Motivo é obrigatório** (mínimo de 5 caracteres). Dinheiro que sai da gaveta
sem motivo escrito vira diferença sem dono no fechamento, e a conversa acontece
dias depois, sem ninguém lembrar.

Sangria maior do que o que existe na gaveta é recusada: é erro de digitação ou
um problema bem maior, e nos dois casos recusar é melhor do que registrar um
caixa com dinheiro negativo.

## 9. Uma armadilha que custou um teste

`GET /caixa/meu` devolve `{ caixa: Caixa | null }`, e não `Caixa | null`.

Handler do NestJS que devolve `null` manda **corpo vazio**. O cliente recebe
`{}` — que é **verdadeiro**. Um teste daqui concluiu que havia caixa aberto
quando não havia, e cinco testes de venda falharam por um motivo que não tinha
nada a ver com eles.

"Não há caixa aberto" é uma resposta normal. Ela precisa caber no corpo.

## 10. O que ainda não existe

- **Fechamento cego**: hoje o operador vê o esperado antes de contar. O
  fechamento às cegas — contar primeiro, ver a diferença depois — é o que
  torna a conferência honesta, e é configuração de empresa, não decisão do
  sistema.
- **Sangria obrigatória acima de um teto**, para limitar o dinheiro em gaveta.
- **Relatório de quebras** por operador e período.

> **Construído desde que este documento foi escrito:** o pagamento com
> `FormaPagamento.CARTEIRA` debita a conta corrente — `vendas.service.ts`
> chama `debitarPorVenda`.

## 11. Testes obrigatórios

Em `apps/api/src/caixa/caixa.e2e.test.ts`:

1. Abre com fundo e o esperado começa exatamente nele.
2. Não abre dois caixas para a mesma pessoa na mesma loja.
3. "Não há caixa aberto" cabe no corpo (`{ caixa: null }`).
4. **A conta do esperado**, com suprimento, sangria, troco e cartão juntos.
5. PIX não entra na gaveta.
6. Sangria maior que o caixa é recusada; sangria sem motivo é recusada.
7. Fecha exato; registra falta; registra sobra; não fecha duas vezes.
8. Depois de fechar, dá para abrir outro (o índice parcial funciona).
9. Quem fechou não confere; outra pessoa confere; não confere caixa aberto;
   sem `caixa.conferir` não confere.
10. Caixa alheio dá 403; a listagem respeita isso.

E em `vendas.e2e.test.ts`: dinheiro sem caixa é recusado, PIX sem caixa passa.
