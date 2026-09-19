# Movimentação de estoque

> Fase 3. A matemática do custo médio está em [COST_POLICY.md](COST_POLICY.md);
> aqui está como ela é aplicada, gravada e protegida.

## 1. O razão é a verdade

`movimento_estoque` é **append-only**. `saldo_estoque` é cache derivado: existe
para a consulta ser rápida, e pode ser reconstruído somando o razão.

Isso decide o desenho inteiro. Não existe "editar movimento" nem "excluir
movimento" na API — e não é esquecimento. Correção é lançamento contrário.

Cada linha grava, além da quantidade:

| Campo | Para quê |
|---|---|
| `saldo_anterior`, `saldo_posterior` | encadeamento; um tem que casar com o seguinte |
| `custo_medio_antes`, `custo_medio_depois` | a auditoria não precisa recalcular para conferir |
| `custo_unitario` | é dele que sai a margem da venda |
| `politica_custo` | *qual regra* foi aplicada, não só o resultado |
| `saldo_negativo` | marca o movimento que deixou — ou manteve — saldo abaixo de zero |

Gravar a política junto é o que permite auditar sem re-deduzir. Custo médio que
"por acaso" bate não prova que a regra certa foi usada: entrada com saldo zero e
entrada ponderada podem dar o mesmo número e significar coisas diferentes.

## 2. As quatro operações

| Rota | Permissão | Gera |
|---|---|---|
| `POST /estoque/entrada` | `estoque.entrada_manual` | `ENTRADA_COMPRA` / `_DEVOLUCAO_CLIENTE` / `_AJUSTE` |
| `POST /estoque/saida` | `estoque.ajustar` | `SAIDA_PERDA` / `_AVARIA` / `_CONSUMO` / `_DEVOLUCAO_FORNECEDOR` / `_AJUSTE` |
| `POST /estoque/transferencia` | `estoque.transferir` | `SAIDA_TRANSFERENCIA` + `ENTRADA_TRANSFERENCIA` |
| `POST /estoque/contagem` | `estoque.inventariar` | `ENTRADA_INVENTARIO` ou `SAIDA_INVENTARIO`, ou nada |

`SAIDA_VENDA` **não** é lançável à mão. Venda gera movimento pela venda, com o
documento que a explica; solto, seria movimento sem origem — e a conferência de
caixa deixaria de fechar contra o estoque.

### Saída manual exige justificativa

Mínimo de 5 caracteres, validado no contrato compartilhado. Saída manual tira
mercadoria do patrimônio sem venda correspondente: sem motivo registrado, a
diferença aparece no balanço meses depois e não há a quem perguntar.

### Transferência é uma transação só

As duas pontas gravam juntas. Meia transferência — mercadoria que saiu e não
chegou — é pior do que nenhuma: some do patrimônio sem nada explicando. As duas
linhas compartilham `documento_id`, que é o que as liga.

O custo atravessa junto com a mercadoria. Transferir não cria nem destrói valor;
se o custo médio da empresa mudasse por mover caixa de uma sala para outra, o
modelo estaria errado.

### Contagem informa o saldo final, não a diferença

Pedir a diferença obrigaria o operador a fazer a subtração de cabeça em frente à
prateleira — e é dessa subtração que sai o erro.

Sobra reentra **ao custo médio vigente**: mercadoria que estava lá o tempo todo
não muda de valor por ter sido encontrada. Contagem não é lugar de reavaliar
estoque.

Contagem que bate com o sistema **não gera movimento**. A resposta diz
`{ semDiferenca: true }` explicitamente — sem isso a tela mostraria "nada
aconteceu" e o operador contaria de novo achando que errou.

## 3. Travamento

Toda operação trava a linha de `saldo_estoque` com `SELECT … FOR UPDATE` antes
de calcular.

Sem isso, duas saídas simultâneas leem o mesmo saldo, calculam a partir dele e
gravam. O razão fica com dois movimentos, mas `saldo_anterior` e
`saldo_posterior` deixam de encadear: **o histórico passa a mentir**, e nenhuma
tela mostra isso.

A linha é criada antes com `INSERT … ON CONFLICT DO NOTHING`, porque não dá para
travar linha que ainda não existe — e a primeira entrada de um item é exatamente
esse caso.

Na transferência, as duas linhas são travadas **em ordem crescente de id**. Duas
transferências cruzadas entre os mesmos dois locais travariam uma à outra e o
PostgreSQL mataria as duas por deadlock.

Fixado em teste: dez saídas simultâneas do mesmo item precisam encadear e
terminar no saldo certo.

## 4. Saldo negativo

Permitido por configuração da empresa (`permitir_saldo_negativo`, padrão
ligado), **e nunca em silêncio**:

1. Se a empresa não permitir → `409 SALDO_INSUFICIENTE`.
2. Se permitir, mas o usuário não tiver `estoque.vender_sem_saldo` →
   `409 SEM_PERMISSAO_SALDO_NEGATIVO`.
3. Se passar, o movimento grava `saldo_negativo = true` e a resposta traz o
   aviso `SALDO_NEGATIVO`.

Os movimentos negativos são achaveis por filtro
(`GET /estoque/movimentos?apenasNegativos=true`) — divergência que não se
consegue listar é divergência que ninguém corrige.

A entrada seguinte devolve o aviso `REGULARIZACAO` com quantas unidades cobriram
venda a descoberto. O cálculo do impacto está em
[COST_POLICY.md](COST_POLICY.md) — é computado e informado, não aplicado
automaticamente ao custo.

## 5. Escopo: permissão diz o quê, vínculo diz onde

Um estoquista da Loja Centro não movimenta o estoque da Loja Shopping, mesmo
tendo `estoque.ajustar`.

Duas barreiras, de propósito:

1. `@EscopoLoja('lojaId')` confere o campo do corpo contra os vínculos.
2. O serviço carrega o **local** e confronta a loja dele com a informada. Se
   divergirem → `400 LOCAL_DE_OUTRA_LOJA`.

A segunda existe porque a primeira confia num campo do corpo. Sem ela, bastava
declarar uma loja à qual se tem acesso e apontar o `localId` de outra.

`GET /estoque/locais` só devolve locais das lojas do vínculo: oferecer um
destino de transferência que a API vai recusar é desenhar o erro.

## 6. Custo na resposta

Mesma regra dos produtos: `custoUnitario`, `custoMedioAntes`, `custoMedioDepois`
e `politicaCusto` **saem do JSON** para quem não tem `produto.ver_custo`.
Ausentes, não zerados. Ver [REPORTS.md §6](REPORTS.md).

Quem grava o movimento vê o custo — foi quem acabou de informá-lo.

## 7. Testes obrigatórios

Os que já existem em `apps/api/src/estoque/estoque.e2e.test.ts`:

1. Média ponderada recalculada na entrada, inalterada na saída.
2. Entrada com saldo zerado adota o custo da entrada (`CUSTO_REDEFINIDO`), e a
   política gravada diz isso.
3. Razão encadeia: posterior de um é anterior do seguinte, inclusive no custo.
4. Saldo negativo permitido, marcado e avisado.
5. Entrada posterior regulariza e informa quantas unidades cobriu.
6. Transferência move quantidade e leva o custo.
7. Contagem para mais e para menos, ao custo vigente.
8. Contagem que bate não gera movimento.
9. **Dez saídas simultâneas** encadeiam e fecham no saldo certo.
10. Vendedora não movimenta; estoquista não alcança outra loja.
11. Loja própria + local de outra é recusado.
12. Custo ausente do JSON para quem não tem a permissão.
13. Quantidade zero, negativa e custo negativo recusados; custo zero aceito.
