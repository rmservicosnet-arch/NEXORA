# Política de custo médio ponderado

> Esta é a regra mais delicada do sistema. Ela decide a margem de toda venda,
> o valor do patrimônio e o resultado do exercício. Um erro aqui não aparece
> como bug — aparece como um número errado que ninguém questiona.
>
> Implementação: `packages/core/src/custo-medio.ts`.
> Testes: `packages/core/src/custo-medio.test.ts`.

## 1. Precisão e arredondamento

| Grandeza | Escala | Arredondamento |
|---|---|---|
| Quantidade | 6 casas | half-up |
| Custo unitário e custo médio | 6 casas | half-up |
| Valor monetário | 2 casas | half-up |

O custo usa 6 casas porque é resultado de divisão. Truncar em 2 acumularia
erro a cada movimentação — e um item com 400 entradas por ano teria um custo
visivelmente errado ao fim.

**O custo médio é arredondado a cada entrada, não mantido com precisão
infinita.** O motivo é reprodutibilidade: o valor precisa sobreviver a uma ida
e volta ao banco (`numeric(18,6)`) sem mudar. Um número que só existe em
memória com 34 dígitos não é auditável.

O desvio introduzido é de no máximo 1e-6 por movimento, e não se acumula de
forma sistemática porque o half-up arredonda para os dois lados.

**Nunca `float`.** `0.1 + 0.2` não é `0.3`, e dinheiro não perdoa isso. O
construtor `dec()` **recusa** um `number` com casas decimais: ou é inteiro, ou
tem de vir como string. É guarda-corpo deliberado, não inconveniência.

## 2. As quatro políticas

O movimento grava qual regra foi aplicada, para a auditoria não precisar
deduzir depois.

| Política | Quando | Efeito na média |
|---|---|---|
| `MEDIA_PONDERADA` | Entrada com saldo anterior **> 0** | Recalculada |
| `CUSTO_REDEFINIDO` | Entrada com saldo anterior **≤ 0** | Assume o custo da entrada |
| `SEM_EFEITO` | Saída ao custo médio vigente | Inalterada |
| `CUSTO_HISTORICO` | Saída a um custo específico gravado (estorno de entrada) | Inalterada |

Cada valor tem exatamente um significado. Devolução de venda e estorno de
saída **não** são políticas próprias: são entradas cujo custo unitário veio do
histórico em vez do documento de compra. Isso muda o `custoUnitario` do
movimento, não a regra aplicada à média.

## 3. Entrada

```
saldo_posterior = saldo_anterior + quantidade
```

### Saldo anterior > 0 — média ponderada

```
                saldo_ant × custo_méd_ant  +  quantidade × custo_entrada
custo_médio  =  ─────────────────────────────────────────────────────────
                            saldo_ant + quantidade
```

O denominador é sempre positivo aqui, porque `saldo_ant > 0` e
`quantidade > 0`. Não existe divisão por zero neste ramo.

### Saldo anterior ≤ 0 — custo redefinido

```
custo_médio = custo_entrada
```

Ponderar não faz sentido: não há base positiva com que ponderar, e o
denominador poderia ser zero ou negativo — o que produziria um custo médio
negativo, que é um absurdo contábil.

Este é o ramo que a combinação "saldo negativo permitido + custo médio" torna
obrigatório. Sem ele, a primeira compra depois de uma venda a descoberto
quebraria o cálculo.

### Regularização: o que a redefinição deixa para trás

Quando o saldo anterior é **negativo**, algumas unidades já foram vendidas ao
custo médio antigo, sem existirem. Quando a mercadoria chega, descobre-se
quanto elas custavam de verdade.

```
unidades_regularizadas = min( |saldo_anterior| , quantidade )
ajuste = unidades_regularizadas × (custo_entrada − custo_médio_anterior)
```

**Este valor não é aplicado automaticamente ao custo médio.** Ele é devolvido
pela função e gravado no movimento como informação: é uma correção de
resultado do período, não um ajuste de estoque.

Aplicá-lo à média distorceria o custo das unidades que existem agora, para
compensar unidades que já saíram. Esconder o valor deixaria a loja sem saber
que vendeu abaixo ou acima do custo real. Por isso: calculado, exposto, não
aplicado.

### Exemplo

| # | Operação | Saldo | Custo médio | Política |
|---|---|---|---|---|
| 1 | Entrada 30 @ 36,00 | 0 → 30 | 0 → **36,000000** | `CUSTO_REDEFINIDO` |
| 2 | Entrada 20 @ 42,00 | 30 → 50 | 36,00 → **38,400000** | `MEDIA_PONDERADA` |

Conferência de (2): `(30 × 36 + 20 × 42) / 50 = 1920 / 50 = 38,40`.

## 4. Saída

```
saldo_posterior = saldo_anterior − quantidade
custo_unitário  = custo_médio_vigente
custo_médio     = inalterado
```

Saída **nunca** altera o custo médio. Ela consome ao custo vigente, e esse
custo é gravado no movimento — é dele que sai a margem da venda, e é por ele
que uma devolução reentra.

### Saldo negativo

Permitido por configuração da empresa. Quando acontece:

- o movimento é marcado `saldoNegativo`;
- o custo médio é **preservado**, não zerado;
- o valor de estoque fica negativo e aparece assim nos relatórios.

Zerar o custo médio ao ficar negativo seria conveniente e errado: a próxima
entrada perderia a referência do que aquele item custava.

### Saída sem base de custo

Se o custo médio vigente é zero — item que nunca teve entrada —, a saída sai a
custo zero e o movimento é marcado `semBaseDeCusto`. A margem dessa venda é
100% e é **falsa**. O relatório precisa poder separar esses casos, senão a
margem da loja inteira fica inflada.

## 5. Devolução de venda

Reentra pelo **custo gravado na saída original**, não pelo custo médio atual.

```
custo_entrada = venda_item.custo_unitario
```

Depois disso, segue a regra normal de entrada: pondera se o saldo for
positivo, redefine se não for.

**Por quê:** se a devolução entrasse ao custo médio de hoje, uma compra cara
feita depois da venda faria a devolução "valorizar" mercadoria que sempre foi
barata. O estoque ganharia valor por um evento que não foi compra.

## 6. Transferência entre locais

Duas operações, mesma transação:

1. Saída na origem, ao custo médio da origem.
2. Entrada no destino, com `custo_entrada` = o custo da saída.

O custo atravessa a transferência. Transferir não cria nem destrói valor — se
o custo médio da empresa mudasse por mover caixa de uma sala para outra, o
modelo estaria errado.

## 7. Estorno

Estorno **nunca** desfaz um movimento nem recalcula a média para trás.

Ele gera um movimento contrário, referenciando o original:

- estorno de **saída** → entrada, ao custo unitário da saída original;
- estorno de **entrada** → saída, ao custo unitário da entrada original,
  política `CUSTO_HISTORICO`.

A média **não volta** ao valor anterior, porque outros movimentos podem ter
acontecido no intervalo. Reescrever o passado tornaria todo extrato e todo
relatório irreprodutível — exatamente o que `REPORTS.md` §1 proíbe.

## 8. Valor do estoque

```
valor = saldo × custo_médio
```

Com saldo negativo, o valor é negativo. Nos relatórios isso aparece em três
linhas — positivos, efeito dos negativos, líquido. Ver `REPORTS.md` §2.

## 9. Invariantes

Valem sempre. Violação é bug, não arredondamento.

1. `custo_médio >= 0`, em qualquer situação, inclusive com saldo negativo.
2. Saída não altera o custo médio.
3. Entrada com saldo anterior > 0 produz custo médio entre o antigo e o de
   entrada (inclusive nos extremos).
4. `saldo_posterior` de um movimento é o `saldo_anterior` do próximo, para o
   mesmo par (variação, local).
5. Quantidade de movimento é sempre positiva; o sinal está em `sentido`.
6. Reaplicar a mesma sequência de movimentos sobre a mesma posição inicial
   produz exatamente o mesmo resultado — sem aleatoriedade, sem relógio.

O invariante 3 é o mais útil na prática: se a média saiu fora do intervalo,
alguém trocou uma quantidade por um valor em algum lugar.
