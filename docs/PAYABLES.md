# Contas a pagar e a receber — o compromisso com vencimento

> Fase 5. Escrito **depois** do módulo, como [PURCHASES.md](PURCHASES.md), e
> pelo mesmo motivo: Contas move dinheiro e nasceu sem documento.

## 1. A decisão que veio antes da primeira linha de código

**O saldo do revendedor continua sendo o da Carteira.**

O título **não cria um segundo saldo**. Ele acrescenta o que a carteira não
tem, que é **vencimento**. Dois lugares com o mesmo débito e números
diferentes seria a pior coisa que este sistema poderia ganhar — e é o erro que
[WALLET.md](WALLET.md) §6 existe para impedir.

Daí a regra que atravessa o módulo inteiro:

| Cliente | Onde a dívida vive |
|---|---|
| **Com** carteira (`cliente.usaCarteira`) | Débito no razão da carteira. Sem título |
| **Sem** carteira | Título `RECEBER`, com vencimento. Sem débito |

Nunca os dois. Uma venda a prazo escolhe um caminho e só um.

## 2. O modelo

```
titulo_financeiro
  tipo      PAGAR | RECEBER
  origem    COMPRA | VENDA | MANUAL
  status    ABERTO | PAGO | CANCELADO
  valor, valor_pago, vencimento
  cliente_id | fornecedor_id, loja_id, venda_id | compra_id
```

`origem` não é enfeite: **título sem origem visível vira número órfão**. Quem
audita precisa chegar da linha até o fato que a criou.

`vencido` é **derivado** de hoje, nunca uma coluna que alguém precisa virar.
Coluna de status temporal envelhece sozinha: o título vence à meia-noite e
ninguém roda nada.

## 3. Rotas

| Rota | Permissão | O quê |
|---|---|---|
| `GET /financeiro/titulos` | `financeiro.visualizar` | Recortes `abertos`, `vencidos`, `pagos`, `todos` |
| `GET /financeiro/titulos/:id` | `financeiro.visualizar` | Com as baixas |
| `POST /financeiro/titulos` | `financeiro.baixar` | Manual, com parcelas |
| `POST /financeiro/titulos/:id/baixar` | `financeiro.baixar` | Recebimento ou pagamento |
| `POST /financeiro/titulos/:id/baixas/:baixaId/estornar` | `financeiro.baixar` | Desfaz uma baixa |
| `POST /financeiro/titulos/:id/cancelar` | `financeiro.baixar` | Só em aberto e sem baixa |

## 4. A baixa

**Uma transação só.** Eram três — o movimento de caixa numa, o lançamento da
carteira noutra, a linha da baixa numa terceira. Uma falha entre elas deixava
dinheiro movido sem baixa gravada, que é a pior metade de acontecer: a
cobrança continua de pé e o dinheiro já saiu.

O título é travado com `SELECT … FOR UPDATE` antes de somar. Sem isso, duas
baixas simultâneas leem o mesmo `valor_pago` e uma sobrescreve a outra — o
título quitaria pela metade com o dinheiro inteiro recebido.

**Contas não lança dinheiro por conta própria.** Ela chama:

- o **CAIXA**, quando a forma é `DINHEIRO`: sai da gaveta, vira sangria (a
  pagar) ou suprimento (a receber), e exige caixa aberto. Ver
  [CASHBOX.md](CASHBOX.md);
- a **CARTEIRA**, num título `RECEBER` de cliente **que tem carteira**: a
  quitação entra no razão dela.

> **Só quem TEM carteira.** Isto era `if (RECEBER && clienteId)`, e a carteira
> responde 404 para quem não tem: a baixa inteira morria. E o título de venda
> a prazo nasce **exatamente** para o cliente sem carteira (§1) — ou seja, o
> título era criado num caminho e não podia ser pago em nenhum. Cobrança
> impossível, sem erro de compilação e sem teste que cobrisse.

Parcial é normal: o fornecedor aceitou metade hoje e metade na semana que vem.
Marcar como pago o que foi pago pela metade é perder a cobrança do resto.

## 5. O estorno de baixa

Toda operação que move dinheiro nasce com o contrário dela. A baixa não tinha:
digitou errado, ficava — e a recusa de cancelar uma venda chegava a mandar
"estorne a baixa antes", apontando para uma porta que não existia.

**A baixa não é apagada.** Ela fica marcada (`estornada_em`, `estorno_motivo`)
e aparece riscada na lista, com o motivo. Apagar a linha diria que o dinheiro
nunca se moveu, e ele se moveu.

O que volta, volta pelos razões de quem move: lançamento **contrário** no
caixa e na carteira. No caixa **original** enquanto ele estiver aberto; no
caixa de hoje se já fechou — reabrir turno conferido para acertar o passado
seria reescrever uma conferência assinada.

O motivo é obrigatório. Desfazer dinheiro sem dizer por que é o mesmo que não
registrar.

## 6. Cancelar

Só título **em aberto e sem nenhuma baixa**. Cancelar um título já baixado em
parte apagaria a cobrança do resto sem dizer o que aconteceu com o que já foi
pago.

Cancelar uma **venda** cancela os títulos dela — e **recusa** quando algum já
recebeu dinheiro, com `VENDA_COM_TITULO_BAIXADO`. Alguém precisa decidir se
devolve ou se vira crédito, e essa decisão não é do código.

Uma **devolução parcial** abate o título em vez de cancelá-lo: o valor de face
diminui e não há baixa, porque não entrou dinheiro. Cobrindo o que falta, aí
sim ele é cancelado — cobrar zero não é cobrar. Ver [POS.md](POS.md) §10.1.

## 7. Os indicadores

**"Em aberto" soma `valor − pago`.** Um título de R$ 9.600,00 com R$ 4.743,00
pagos pesa R$ 4.857,00, não R$ 9.600,00. Somar o cheio mostra dívida que já
não existe.

Vale igual no **aging** ([REPORTS.md](REPORTS.md)): a faixa pesa o que falta, e
as faixas **fecham** com o total. Buraco ou sobreposição, e quem lê não
descobre qual coluna mente.

## 8. O que ainda não existe

- **Recorrência.** Aluguel e assinatura são digitados um a um.
- **Conciliação bancária.** A baixa é registrada por quem a faz; nada compara
  com extrato.
- **Juros e multa** por atraso.
- **Renegociação** — hoje só cancelar e criar de novo, o que perde o histórico
  de que houve acordo.

## 9. Testes obrigatórios

Em `apps/api/src/contas/contas.e2e.test.ts`:

1. `vencido` é **derivado** de hoje, não uma coluna que alguém precisa virar.
2. Parcelas viram títulos próprios e somam o total exato.
3. Baixa parcial deixa o título aberto pelo saldo.
4. Baixar mais do que se deve é recusado.
5. Baixa de título a receber lança a quitação **na carteira** do cliente.
6. Baixa em dinheiro sem caixa aberto é recusada.
7. Título já quitado não se baixa de novo.
8. Título com baixa não se cancela.
9. O resumo conta o conjunto e **desconta o que já foi pago**.
10. O cliente do portal não enxerga a rota de contas.
11. **Título a receber de cliente SEM carteira aceita baixa** — e quitá-lo não
    inventa uma carteira.
12. Estornar devolve o título para `ABERTO` e a baixa **fica** marcada.
13. Estornar duas vezes a mesma baixa é recusado.
14. Estornar sem motivo é recusado.

E em `venda-a-prazo.e2e.test.ts`: cliente sem carteira gera título e nenhum
movimento de carteira; cliente com carteira, o contrário.
