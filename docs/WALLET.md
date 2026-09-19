# Carteira do cliente (conta corrente)

> Fase 5, junto com o financeiro. Documentado agora porque muda o modelo de
> pagamento e o de contas a receber.

## 1. O que é

Uma conta corrente por cliente. O revendedor acumula débito ao comprar e
quita depois; ou deposita adiantado e usa o crédito para pagar.

O saldo pode ser **positivo ou negativo** — e esse é exatamente o ponto onde
esses sistemas costumam errar.

## 2. A convenção de sinal

Escrita aqui uma vez, válida em todo lugar: banco, API, tela, relatório e
exportação.

```
saldo POSITIVO  →  crédito do cliente.  A LOJA deve a ele.
                   Ele tem dinheiro para gastar.

saldo NEGATIVO  →  débito do cliente.   ELE deve à loja.
                   É o que precisa ser quitado.
```

Nunca inverter em nenhuma camada, nem "para ficar mais bonito na tela". Se a
tela quiser mostrar `R$ 1.200,00 em aberto` para um saldo de `−1.200,00`, ela
formata — mas o valor que trafega e é somado continua negativo.

| Termo | Significa |
|---|---|
| **Crédito** | Movimento que **aumenta** o saldo (`+`) |
| **Débito** | Movimento que **diminui** o saldo (`−`) |
| **Quitação** | Um crédito cuja finalidade é zerar ou reduzir um saldo negativo |

Quitação é um crédito. Não é um tipo especial de operação — é dinheiro
entrando na conta do cliente.

## 3. Razão imutável, saldo derivado

Mesma arquitetura do estoque, pela mesma razão:

| Tabela | Papel | Mutável? |
|---|---|---|
| `carteira` | Saldo atual, limite, status | Sim — e é travada com `FOR UPDATE` |
| `carteira_movimento` | Todo crédito e débito | **Não.** Append-only |

Cada movimento grava `saldoAnterior` e `saldoPosterior`. Com isso:

- o extrato de um período passado é reproduzível sem reprocessar tudo;
- o saldo em qualquer data sai do último movimento até aquela data;
- uma divergência entre `carteira.saldo` e a soma do razão é detectável por
  conferência, e é **bug**, não arredondamento.

Estorno gera movimento contrário referenciando o original. Nunca se apaga nem
se edita um movimento. O extrato do cliente não pode mudar de ontem para hoje.

## 4. Limite de crédito

```
saldo_disponivel_para_compra = saldo + limite_credito
```

Exemplo: saldo `−3.200,00`, limite `5.000,00` → pode comprar mais `1.800,00`.

- `limiteCredito` é **positivo** e representa o quanto o saldo pode ficar
  negativo. Zero = não pode ficar devendo.
- Ultrapassar exige a permissão `carteira.exceder_limite`, com justificativa,
  e marca o movimento como `excedeuLimite`.
- Igual ao saldo negativo de estoque: **permitido quando autorizado, nunca
  silencioso**.

## 5. Uso como pagamento

`FormaPagamento` ganha o valor `CARTEIRA`.

Ao finalizar uma venda com essa forma:

1. Trava a linha de `carteira` com `SELECT … FOR UPDATE`.
2. Confere `saldo + limite >= valor`, ou exige a permissão de exceder.
3. Grava `carteira_movimento` do tipo `PAGAMENTO_VENDA`, com sinal negativo,
   referenciando a venda.
4. Atualiza `carteira.saldo`.

Tudo na **mesma transação** da venda. Venda concluída com pagamento em
carteira que não debitou é dinheiro que some.

Idempotência: o movimento carrega a mesma `Idempotency-Key` da venda.
Reprocessar não debita duas vezes.

## 6. A decisão que evita contar a mesma dívida duas vezes

Um cliente compra R$ 1.000,00 a prazo. Isso vira:

- **(A)** um débito na carteira, **ou**
- **(B)** um título em contas a receber.

**Nunca os dois.** Fazer os dois infla o ativo da empresa pelo dobro — o erro
contábil mais caro que um ERP pequeno costuma cometer.

**Decisão:** para cliente **com carteira ativa**, a dívida vive na
**carteira**. Contas a receber não gera título para ele.

- O saldo negativo da carteira **é** o contas a receber daquele cliente.
- O relatório de aging desse cliente lê `carteira_movimento`, usando a data de
  cada débito ainda não coberto por créditos posteriores (FIFO).
- Cliente **sem** carteira segue o caminho normal: venda a prazo gera título.

**Por que a carteira e não o título:** revendedor compra toda semana. Gerar 40
títulos por mês e baixar cada um na mão é trabalho que ninguém faz — na
prática o operador "paga tudo" e a conciliação se perde. Conta corrente com
extrato é como esse relacionamento realmente funciona.

**Consequência a aceitar:** não existe "vencimento" por compra na carteira,
só a data do débito. Se a loja precisar cobrar juros por atraso de título
específico, o modelo de título é melhor. Está anotado como reversível:
`cliente.usaCarteira` decide o caminho, cliente a cliente.

## 7. Tipos de movimento

Crédito (`+`):

| Tipo | Origem |
|---|---|
| `DEPOSITO` | Cliente adiantou dinheiro |
| `QUITACAO` | Pagamento de débito, com forma e comprovante |
| `DEVOLUCAO_VENDA` | Devolução gerou crédito em vez de dinheiro de volta |
| `BONIFICACAO` | Acordo comercial. Exige permissão |
| `ESTORNO_DEBITO` | Anula um débito anterior |
| `AJUSTE_CREDITO` | Correção manual. Exige permissão e justificativa |

Débito (`−`):

| Tipo | Origem |
|---|---|
| `PAGAMENTO_VENDA` | Venda paga com carteira |
| `VENDA_A_PRAZO` | Venda lançada na conta corrente |
| `TAXA` | Encargo acordado |
| `ESTORNO_CREDITO` | Anula um crédito anterior |
| `AJUSTE_DEBITO` | Correção manual. Exige permissão e justificativa |

`AJUSTE_*` e `BONIFICACAO` são os tipos perigosos: eles criam dinheiro sem
contrapartida. Por isso exigem permissão própria, justificativa obrigatória e
aparecem destacados no extrato e no relatório de ações sensíveis.

## 8. O que o cliente vê

No aplicativo, sua própria carteira: saldo, limite, disponível e extrato.

- Somente leitura. Cliente nunca lança movimento.
- Nunca vê carteira de outro cliente — escopo `app.cliente_id`, como o resto
  do portal.
- No carrinho, se houver saldo positivo, aparece a opção de usar. O servidor
  revalida; a tela apenas oferece.

## 9. Permissões

| Permissão | Quem |
|---|---|
| `carteira.visualizar` | Gestor, Financeiro, Vendedor |
| `carteira.lancar_quitacao` | Gestor, Financeiro |
| `carteira.lancar_deposito` | Gestor, Financeiro |
| `carteira.ajustar` | Gestor. **Cria dinheiro** — sempre com justificativa |
| `carteira.definir_limite` | Gestor |
| `carteira.exceder_limite` | Gestor |
| `carteira.estornar` | Gestor |

## 10. Testes obrigatórios

1. Saldo da carteira é sempre igual à soma dos movimentos. Divergência falha.
2. Crédito aumenta o saldo; débito diminui. Em toda camada, sem inversão.
3. Quitação de saldo `−1.000,00` com `R$ 400,00` deixa `−600,00`.
4. Compra acima de `saldo + limite` é recusada sem a permissão de exceder.
5. Com a permissão, passa, exige justificativa e marca `excedeuLimite`.
6. Venda paga com carteira debita na mesma transação; falha na venda não
   deixa débito órfão.
7. Reenvio com a mesma `Idempotency-Key` não debita duas vezes.
8. Cliente com carteira **não** gera título em contas a receber pela mesma
   venda.
9. Estorno cria movimento contrário; o original permanece no extrato.
10. Extrato de período passado não muda depois de novos movimentos.
11. Cliente A não acessa a carteira do cliente B, nem por id direto.
12. Dois pagamentos simultâneos com a mesma carteira não ultrapassam o limite
    (trava `FOR UPDATE`).
13. `AJUSTE_*` sem justificativa é rejeitado.
