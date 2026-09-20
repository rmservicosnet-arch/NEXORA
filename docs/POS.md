# PDV — venda de balcão

> Fase 4. O PDV é o **modo de venda interno da loja**: o cliente está na
> frente, paga e leva. Pedido que aguarda confirmação é outra entidade, com
> outro fluxo — ver ADR-008 e [ORDERS.md](ORDERS.md).

## 1. Uma transação, ou nada

`POST /vendas` faz tudo junto: numeração, itens com preço e custo congelados,
baixa de estoque e pagamentos. Se qualquer parte falhar, nada fica.

Venda gravada com estoque não baixado — ou estoque baixado sem venda — é a pior
divergência possível: ninguém encontra, e o balanço nunca mais fecha. Há teste
que provoca a falha depois da baixa e confere que o saldo voltou intacto.

## 2. A baixa é a mesma do estoque manual

A venda chama `EstoqueService.baixarParaVenda`, que usa o **mesmo** travamento,
o **mesmo** cálculo de custo e a **mesma** regra de saldo negativo da saída
manual. Uma segunda implementação "só para a venda" seria uma segunda verdade
sobre o custo.

O movimento sai como `SAIDA_VENDA`, com `documento_tipo = 'VENDA'`,
`documento_id` da venda e `documento_numero` do cupom. É assim que se vai do
razão ao cupom e de volta.

## 3. O que congela na venda

| Campo | Por quê |
|---|---|
| `preco_unitario` | mudar a tabela depois não reescreve faturamento passado |
| `custo_unitario` | compra de hoje não altera a margem de ontem |
| `preco_origem` | `TABELA` ou `MANUAL` — o relatório de desconto precisa saber o que alguém digitou à mão, e isso não dá para deduzir depois comparando com uma tabela que mudou |

Os dois primeiros têm teste: a venda é conferida de novo **depois** de uma
compra a custo bem diferente, e a margem não se move.

## 4. Preço: de onde vem

Precedência: o que o operador escolheu → a tabela do cliente → a padrão.

O cliente Professor entra e o preço de professor aparece sozinho, mas o
operador ainda pode trocar — a exceção existe no balcão.

Digitar preço exige `preco.aplicar_desconto`. Desconto no total, também.

## 5. Pagamento

A soma precisa fechar o total. Faltando, a resposta diz **quanto** falta.

Sobrando, só `DINHEIRO` devolve troco. Cartão ou PIX acima do total é erro de
digitação, e deixar passar vira um acerto manual no fechamento do caixa.

O cartão guarda bandeira, quatro últimos dígitos e autorização — nunca o número
inteiro.

## 6. Saldo negativo no balcão

Vale a regra de [STOCK.md §4](STOCK.md), com uma consequência prática: a
vendedora comum **não** conclui venda que deixe o saldo negativo, porque o
perfil Vendedor não tem `estoque.vender_sem_saldo`. Ela chama alguém que tenha.

Quem tem, conclui — e a venda volta com o aviso. O PDV mostra os avisos na
tela, item por item:

- saldo ficou negativo;
- **saída sem base de custo**: a margem daquele item será falsa até a entrada
  correspondente ser lançada. Sem esse aviso, o relatório mostraria 100% de
  margem e alguém acreditaria.

## 7. O saldo que o PDV mostra é o do balcão

`GET /vendas/itens` devolve o saldo **do local padrão de venda daquela loja**,
não o total da empresa. Mostrar o total da rede faria o operador prometer ao
cliente uma peça que está em outra cidade.

## 8. Cancelamento

`POST /vendas/:id/cancelar` muda o status, guarda o motivo e a hora, e devolve a
mercadoria por **lançamento contrário** — `ENTRADA_DEVOLUCAO_CLIENTE` apontando
para a saída original por `estorno_de_id`.

A venda não é apagada. Um cancelamento que some do histórico é um cancelamento
que ninguém consegue auditar.

A mercadoria volta **pelo custo congelado na venda**, não pelo custo médio de
hoje. Tem teste: vende tudo, zera o saldo, cancela — e o custo que reentra é o
da venda.

## 9. Numeração

Sequencial por empresa, serializada com `pg_advisory_xact_lock`. Cinco caixas
vendendo ao mesmo tempo recebem cinco números diferentes; tem teste.

Não é `SEQUENCE` porque a numeração é por tenant, e uma sequência global
deixaria buracos visíveis para o cliente — "minha última venda foi a 41, por
que a próxima é a 87?".

## 10. O que ainda não existe

- **Devolução parcial.** `quantidade_devolvida` está no item, sem rota ainda.
  Hoje só há cancelamento total.
- **Venda a prazo.** Pagar com `CARTEIRA` debita a conta corrente, mas lançar
  a venda INTEIRA a prazo — o outro caminho do §6 de [WALLET.md](WALLET.md) —
  ainda não existe. `cliente.usaCarteira` é gravado e ninguém o lê.

> **Construído desde que este documento foi escrito:** o caixa inteiro (ver
> [CASHBOX.md](CASHBOX.md)) e o débito em carteira no pagamento com
> `FormaPagamento.CARTEIRA` — `vendas.service.ts` chama `debitarPorVenda`.

## 11. Testes obrigatórios

Em `apps/api/src/vendas/vendas.e2e.test.ts`:

1. Conclui, baixa o estoque, congela preço e custo, calcula margem.
2. A baixa aparece no razão ligada ao número da venda.
3. Compra posterior a custo diferente **não** reescreve a margem da venda.
4. Várias formas de pagamento na mesma venda.
5. Dinheiro a mais vira troco e o troco é avisado.
6. Cartão a mais é recusado.
7. Pagamento a menos diz quanto falta.
8. **Falha no meio não deixa estoque baixado.**
9. Cinco vendas simultâneas, cinco números.
10. Preço digitado marcado como `MANUAL`; desconto maior que a venda recusado.
11. Vendedora não conclui venda negativa; quem tem permissão conclui com aviso.
12. Cancelamento devolve por lançamento contrário, pelo custo da venda, sem
    apagar nada; não cancela duas vezes; vendedora não cancela.
13. Sem `venda.ver_todas`, só as próprias vendas; custo e margem ausentes do
    JSON para quem não tem `produto.ver_custo`.
