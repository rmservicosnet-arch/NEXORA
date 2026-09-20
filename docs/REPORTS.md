# Relatórios

> Relatório de ERP não é tela de consulta: é o número que decide compra,
> demissão, comissão e preço. Se ele muda de valor entre duas execuções sobre
> o mesmo período, ninguém confia mais em nenhum.

## 1. Princípios

1. **Reproduzível.** O mesmo período consultado hoje e daqui a um ano devolve
   o mesmo número. Isso exige ler valores **congelados**, nunca recalcular com
   dados de hoje.
2. **Custo é informação restrita.** Custo, margem e valor de estoque exigem
   `relatorio.ver_custo`. Um vendedor vê o que vendeu, não a margem.
3. **Divergência aparece.** Saldo negativo não é escondido nem zerado nas
   somas — ele é mostrado separadamente, porque distorce o valor do estoque.
4. **Soma em `numeric`, no banco.** Agregação monetária acontece em SQL com
   `numeric`, nunca somando `float` em JavaScript.
5. **Exportação é auditada.** Quem exportou, o quê, quando. Relatório de custo
   e de cliente sai da empresa em CSV com um clique.

## 2. O cálculo que só funciona por causa do modelo

### Margem bruta

`VendaItem` grava `custoUnitario` — o custo médio **no instante da saída**.
Por isso:

```
margem_bruta = Σ (preco_unitario − custo_unitario) × quantidade
```

Se a margem fosse calculada com o custo médio **atual**, a margem de março
mudaria toda vez que uma compra nova entrasse em outubro. Relatório histórico
que muda sozinho é relatório inútil.

Mesma razão pela qual `precoUnitario` é congelado no item: mudar a tabela de
preços não pode reescrever o faturamento passado.

### Posição de estoque em data passada

`saldo_estoque` tem o saldo de **agora**. Ele não serve para "qual era meu
estoque em 31/12".

A posição histórica vem do razão. Por `(variação, local)`, pega-se o último
movimento com `criado_em <= data` e lê-se `saldo_posterior` e
`custo_medio_depois`.

É exatamente por isso que o movimento grava essas duas colunas em vez de
apenas a quantidade. Sem elas, a posição histórica exigiria reprocessar o
razão inteiro desde o começo — e daria números diferentes a cada ajuste
retroativo.

### Valor total do estoque, com saldo negativo

```
valor = Σ (saldo × custo_medio)
```

Saldo negativo entra com sinal negativo e **reduz** o total. Um relatório que
some só os positivos mente sobre o patrimônio.

Por isso a apresentação é em três linhas, nunca uma:

| Linha | O que é |
|---|---|
| Valor dos saldos positivos | O que de fato existe na prateleira |
| Efeito dos saldos negativos | A divergência, com sinal |
| **Valor líquido** | A soma. É o número contábil |

Ver a tela *Relatórios — Posição de estoque*.

### Estoque disponível vs físico

Com pedidos confirmados, existem dois números diferentes:

```
físico     = saldo_estoque.quantidade
reservado  = Σ estoque_reserva ATIVA
disponível = físico − reservado
```

Relatório de **valor** usa o físico (é o que está na loja). Relatório de
**ruptura e reposição** usa o disponível (é o que dá para vender). Trocar os
dois produz compra errada.

## 3. Catálogo

Marcados com **[C]** exigem `relatorio.ver_custo`.

> **Estado: 36 dos 37 construídos.** O único que falta é **Comissões
> apuradas**, e ele não é trabalho de relatório: não existe modelo de comissão
> no schema. Construí-lo antes seria inventar número.
>
> Os três de Compras exigem `relatorio.ver_custo`, não só o que tem "custo" no
> nome: "compras por fornecedor" devolve valor e unidades lado a lado, e
> dividir um pelo outro dá o custo unitário do fornecedor.

### Estoque

| Relatório | Responde |
|---|---|
| **Posição de estoque** **[C]** | Saldo, custo médio e valor por item, loja e local. Com o total do patrimônio |
| **Saldo negativo** | O que está abaixo de zero, desde quando, por qual movimento |
| **Abaixo do mínimo** | O que repor, usando o **disponível** |
| **Razão de movimentações** | Todo entra e sai, com saldo anterior → posterior e custo |
| **Curva ABC** **[C]** | Quais 20% dos itens concentram 80% do valor |
| **Giro e cobertura** **[C]** | Quantas vezes o item girou; quantos dias o estoque cobre |
| **Sem movimento** | Encalhe: o que não sai há N dias, e quanto dinheiro está parado |
| **Divergências de inventário** | Contado × sistema, por contagem |
| **Transferências** | Enviado, recebido, em trânsito, divergente |

### Vendas

| Relatório | Responde |
|---|---|
| **Vendas no período** | Faturamento por dia, semana ou mês; ticket médio; itens por venda |
| **Ranking por vendedor** | Valor, quantidade, nº de vendas, ticket médio — e margem **[C]** |
| **Ranking por produto** | O que mais sai, em valor e em quantidade |
| **Ranking por cliente** | Quem compra mais; recorrência |
| **Ranking por tabela de preço** | Professor, Aluno, Revendedor, Padrão — ver §4 |
| **Ranking de revendedores** | Quem mais COMPROU da loja no período, por `cliente.perfil` — ver §4 |
| **Ranking por categoria e marca** | Onde está o faturamento |
| **Margem por dimensão** **[C]** | Margem bruta e % por produto, categoria, vendedor, tabela |
| **Formas de pagamento** | Distribuição e prazo médio de recebimento |
| **Descontos concedidos** | Por vendedor e por venda. Controle, não curiosidade |
| **Cancelamentos e devoluções** | Volume, motivo e impacto no faturamento |
| **Comparativo entre lojas** | Mesma métrica, lojas lado a lado |

### Pedidos

| Relatório | Responde |
|---|---|
| **Fila e tempo de confirmação** | Quanto tempo o pedido espera. Onde trava |
| **Taxa de confirmação** | Confirmado, parcial, devolvido, recusado |
| **Ruptura** | Itens **`DEVOLVIDO`** por falta — venda perdida por estoque |
| **Alterações pela equipe** | Quanto foi incluído e removido, por quem |
| **Aceites de cliente** | Quantos aumentos foram aceitos e recusados |

O relatório de ruptura é a razão pela qual `DEVOLVIDO` e `REMOVIDO` são
status distintos: item retirado por acordo com o cliente **não** é venda
perdida por estoque, e contá-lo como tal faria a loja comprar o que não
precisa. Ver `docs/ORDERS.md` §6.

### Financeiro e caixa — Fase 5

| Relatório | Responde |
|---|---|
| **Contas a receber por vencimento** | Aging: a vencer, vencido 1–30, 31–60, 60+ |
| **Contas a pagar por vencimento** | Idem |
| **Fluxo de caixa realizado** | Entrou e saiu, por período |
| **Fechamento de caixa** | Abertura, suprimento, sangria, conferência, **diferença** |
| **Comissões apuradas** | Por vendedor e período, com status de pagamento |

### Compras — Fase 5

| Relatório | Responde |
|---|---|
| **Compras por fornecedor** | Volume, valor, prazo de entrega |
| **Evolução do custo de aquisição** **[C]** | Quanto o custo subiu, por item e fornecedor |
| **Notas a receber** **[C]** | Nota emitida e ainda fora do estoque: custo assumido, saldo não subiu |

### Auditoria

| Relatório | Responde |
|---|---|
| **Trilha por entidade** | Tudo que aconteceu com um produto, venda ou pedido |
| **Ações sensíveis** | Alteração de preço, ajuste de estoque, cancelamento, estorno |
| **Acessos e exportações** | Quem exportou dado de custo ou de cliente |

## 4. "Por professor ou tipo de usuário"

**Decisão tomada: existe `cliente.perfil`**, independente da tabela de preços.
`CONSUMIDOR` · `PROFESSOR` · `REVENDEDOR`.

Este documento dizia antes que a tabela de preços bastava como segmento, e
que acrescentar um campo seria duplicá-la com outro nome. O caso que derrubou
isso apareceu na operação: mover um professor para uma tabela promocional por
um mês o tirava do ranking de revendedores — por um motivo que nada tem a ver
com revenda.

**Tabela diz quanto ele PAGA; perfil diz quem ele É.** São perguntas
diferentes e precisam de campos diferentes.

### O que o "Ranking de revendedores" mede — e o que não mede

Ele soma **o que o cliente comprou da loja**. A revenda que o professor faz
acontece fora daqui e o sistema não a vê.

Chamar a coluna de "quem mais vendeu" seria rótulo mais forte do que a conta —
e é o número que vai premiar alguém. A tela diz `Comprado`, e a ressalva vem
em faixa vermelha, não em nota de rodapé.

Quem **parou** de comprar aparece à parte: uma lista de quem comprou não tem
linha para quem sumiu, e é justamente desse que um programa de premiação
precisa.

## 5. Desempenho

Relatório roda sobre `movimento_estoque` e `venda_item`, que crescem sem
parar.

**Regra: começar com consulta indexada e medir. Só criar agregado quando o
número justificar.**

Tabela de rollup que ninguém mede vira duas fontes de verdade que divergem — o
pior resultado possível num relatório financeiro.

O que existe desde já:

- Índices por `(tenant_id, criado_em)` e `(tenant_id, variacao_id, local_id, criado_em)`.
- Toda consulta de relatório é obrigatoriamente **limitada por período**. Não
  existe "trazer tudo".
- Paginação por cursor; exportação grande vai para fila e volta por download.

Quando a medição pedir, o próximo passo é uma **view materializada diária** de
vendas e de posição, atualizada de madrugada, com o dia corrente vindo da
consulta ao vivo. Documentar aqui quando acontecer.

## 6. Permissões

| Permissão | Efeito |
|---|---|
| `relatorio.visualizar` | Acessa o módulo |
| `relatorio.ver_custo` | Custo, margem e valor de estoque. **Sem ela, essas colunas não vêm na resposta da API** |
| `relatorio.ver_todas_lojas` | Sem ela, só as lojas às quais o usuário tem vínculo |
| `relatorio.ver_todos_vendedores` | Sem ela, o vendedor vê apenas os próprios números |
| `relatorio.exportar` | Gera CSV/XLSX. Cada exportação vira registro em `audit_log` |

A segunda linha é servidor, não interface: esconder a coluna no front e mandar
o custo no JSON é o mesmo que não ter permissão nenhuma.

### Ausente, `null` e zero são três coisas

| No JSON | Significa |
|---|---|
| chave ausente | quem pediu não tem a permissão de custo |
| chave com `null` | tem a permissão, mas não há custo a informar — saldo zero, e divisão por zero não existe |
| chave com `"0.000000"` | o custo é realmente zero (brinde, bonificação, doação) |

Colapsar os três em zero faz o relatório mentir sobre patrimônio; colapsar
ausente e `null` faz a interface confundir "sem direito" com "sem estoque".

Fixado em `produtos.e2e.test.ts`: um teste verifica a **ausência da chave**
para quem não tem `produto.ver_custo`, outro verifica que o produto de saldo
zero traz a chave com `null` para quem tem.

O mesmo corte vale para o cache do cliente: ele é indexado pelo filtro, não por
quem perguntou. Trocar de usuário sem esvaziá-lo serve ao próximo o que o
anterior viu. Ver `apps/web/src/auth/sessao.tsx`.

## 7. Exportação

CSV (UTF-8 com BOM, para o Excel em português abrir certo) e XLSX.

Todo arquivo exportado carrega um cabeçalho com: empresa, período, filtros
aplicados, quem exportou e quando. Planilha sem procedência circula por e-mail
e vira discussão sobre qual está certa.

## 8. Testes obrigatórios

1. Margem usa `custoUnitario` do item; comprar hoje não altera a margem de
   ontem.
2. Posição em data passada vem do razão, não de `saldo_estoque`.
3. Valor de estoque com saldo negativo mostra as três linhas, e o líquido
   confere com a soma.
4. Ruptura conta `DEVOLVIDO` e ignora `REMOVIDO`.
5. Reposição usa disponível; valor de estoque usa físico.
6. Usuário sem `relatorio.ver_custo` não recebe custo nem margem **no JSON**.
7. Usuário sem `relatorio.ver_todas_lojas` não vê outra loja em nenhum
   relatório, nem nos totais.
8. Vendedor sem `relatorio.ver_todos_vendedores` vê só os próprios números.
9. Relatório de um tenant nunca soma linha de outro.
10. Consulta sem período é rejeitada.
11. Exportação gera registro em `audit_log`.
12. Somas monetárias batem com a soma dos itens até o último centavo.
