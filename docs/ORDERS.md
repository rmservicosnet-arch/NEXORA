# Pedidos com confirmação

> Fase 4. **A API está implementada**: catálogo do portal, carrinho, envio,
> edição pela equipe, aceite do cliente, confirmação com reserva, devolução,
> recusa, cancelamento e faturamento. 21 testes de ponta a ponta. O que falta
> está em §10.

## 1. O problema

O PDV e o pedido são fluxos **diferentes**, não o mesmo fluxo com status.

| | PDV | Pedido |
|---|---|---|
| Quem opera | Funcionário, no balcão | Cliente, pelo aplicativo |
| Instante da decisão | Um só | Dois: solicitação e confirmação |
| Estoque | Baixa imediata | Sem efeito até a confirmação |
| Preço | Vigente agora | Congelado na solicitação, com validade |
| Pode faltar item | Não (o produto está na mão) | Sim — é o caso comum |

Entre "solicitado" e "confirmado" existe um intervalo. Nele o estoque muda, o
preço muda e o item acaba. Todo o desenho abaixo existe para tratar esse
intervalo sem mentir para nenhum dos dois lados.

### O PDV não é alterado

**Requisito explícito: o PDV permanece como está.** Ele é o modo de venda
interno da loja e continua com baixa imediata de estoque, financeiro e
comissão no ato.

Nada neste documento acrescenta etapa, status ou confirmação ao PDV. O módulo
de pedidos é um fluxo **paralelo**, com entidades próprias (`pedido`,
`pedido_item`, `estoque_reserva`), que só toca o mundo do PDV num ponto: ao ser
faturado, o pedido **gera uma venda** — a mesma entidade `venda` que o PDV
produz, pelo mesmo serviço, com as mesmas regras de baixa, custo e comissão.

Consequência prática: relatório de faturamento, custo médio e comissão não
precisam saber se a venda nasceu no balcão ou num pedido. E o PDV não paga
nenhum custo de complexidade pelo módulo novo.

## 2. Decisões tomadas

| Decisão | Escolha |
|---|---|
| Quem solicita | **Cliente externo**, com login próprio |
| Reserva de estoque | **A partir da confirmação da equipe.** O pedido em espera não reserva nada |
| Falta de item | **Confirmação parcial**: confirma o disponível, devolve o resto |
| Estoque visível ao cliente | **Apenas disponível / indisponível.** Nunca a quantidade |
| Modo de checkout | **Configurável por empresa** (ver §7) |

### Por que não reservar na solicitação

Era a alternativa natural, e foi descartada deliberadamente. Reservar na
solicitação transformaria todo carrinho enviado em estoque travado — inclusive
os pedidos que nunca serão confirmados. Numa loja com giro alto, isso gera
falta artificial.

A consequência aceita: **dois pedidos podem disputar a mesma última peça.** O
primeiro a ser confirmado leva; o segundo recebe aquele item devolvido. É
exatamente o fluxo de devolução parcial descrito acima, e ele já precisa
existir de qualquer forma.

## 3. Ciclo de vida

```
        CARRINHO  (rascunho do cliente — ainda não é pedido)
            │ enviar
            ▼
   AGUARDANDO_CONFIRMACAO ──── recusar ────────► RECUSADO        (final)
       │        │
       │        └─ devolver tudo ──► DEVOLVIDO ──┬─ reenviar ──► AGUARDANDO_CONFIRMACAO
       │                                         └─ cancelar ──► CANCELADO  (final)
       │ confirmar
       ▼
   CONFIRMADO  ou  CONFIRMADO_PARCIALMENTE     ◄── reserva de estoque criada AQUI
       │                    │
       │                    └─ itens devolvidos ficam no mesmo pedido, marcados
       │ faturar
       ▼
   FATURADO ──► gera VENDA: consome a reserva, baixa estoque,
       │        gera financeiro e comissão
       ▼
   CONCLUIDO  (final)

   CONFIRMADO ── cancelar ──► CANCELADO  (libera a reserva)
   CONFIRMADO ── expirar  ──► EXPIRADO   (libera a reserva)
```

Transição não listada é **proibida**, validada no servidor. Não existe "mudar
o status na mão".

### Status por item

O status do pedido não basta — a confirmação parcial acontece **item a item**.

`pedido_item.status`: `PENDENTE` · `CONFIRMADO` · `DEVOLVIDO` · `CANCELADO`

Item `DEVOLVIDO` carrega `motivo_devolucao` e `quantidade_confirmada` (que pode
ser menor que a solicitada — confirmação parcial de quantidade, não só de item).

O status do pedido é derivado e **também armazenado**, porque relatório e fila
de trabalho não podem depender de recalcular agregado a cada consulta.

## 4. Reserva de estoque

Criada na confirmação. Nunca antes.

```
estoque_reserva
  id, tenant_id
  variacao_id, local_id
  pedido_id, pedido_item_id
  quantidade        numeric(18,6)
  status            ATIVA | CONSUMIDA | LIBERADA | EXPIRADA
  criada_em, criada_por
  expira_em         timestamptz NULL
  consumida_em      timestamptz NULL
```

**Saldo disponível = saldo atual − reservas ATIVAS.**

Esse é o número que decide a disponibilidade no catálogo do cliente, e é o
número que a equipe vê ao confirmar. O saldo físico continua sendo o de
`stock_balance` — reserva **não** é movimentação de estoque e **não** entra em
`stock_movement`. Ela é um compromisso, não um fato.

Essa distinção importa: o razão de estoque continua sendo o histórico do que
de fato entrou e saiu. Reserva que expira não deixa rastro no razão, porque
nada se moveu.

### Confirmar sem saldo

A empresa permite saldo negativo. Logo, a equipe **pode** confirmar um item sem
disponibilidade. Mas isso:

- exige a permissão `pedido.confirmar_sem_saldo`;
- pede justificativa;
- marca o item como `confirmado_sem_saldo`;
- aparece no pedido, na reserva e na auditoria.

Permitido, nunca silencioso — a mesma regra do resto do sistema.

### Expiração da reserva confirmada

Pedido confirmado que nunca é faturado trava estoque. `expira_em` é preenchido
a partir de `prazo_reserva_horas` (configuração da empresa).

**Sub-decisão pendente:** valor padrão do prazo. Proposta: **168 horas (7
dias)**, com alerta ao responsável a partir de 120 horas. Precisa ser
confirmado por quem conhece o giro da loja.

## 5. Preço congelado

`pedido_item` grava `preco_unitario`, `tabela_preco_id` e `preco_origem` no
instante do envio. Mudança posterior na tabela **não** altera pedido existente
— mesma regra das vendas históricas.

`pedido.valido_ate` = envio + `prazo_validade_pedido_horas` (padrão proposto:
**72 horas**).

Na confirmação, se o pedido estiver vencido:

| Situação | Comportamento |
|---|---|
| Preço atual **menor ou igual** | Confirma pelo preço menor. O cliente não perde |
| Preço atual **maior** | Não confirma sozinho. Devolve ao cliente com o novo preço, para aceite |

Confirmar um pedido vencido a um preço maior sem o cliente saber é cobrar algo
que ele não pediu.

## 6. A equipe pode editar o pedido

Requisito: a equipe recebe o pedido, entra em contato com o solicitante,
alinha outros itens e **inclui ela mesma**. O aplicativo do cliente reflete a
mudança.

Enquanto o pedido está em `AGUARDANDO_CONFIRMACAO`, quem tem
`pedido.editar_itens` pode:

| Ação | Efeito |
|---|---|
| **Incluir item** | Entra com `origem = ADICIONADO_EQUIPE` e `quantidadeSolicitada = 0` — o cliente não pediu aquilo |
| **Remover item** | `status = REMOVIDO`, com `motivoRemocao` e `removidoPorId` |
| **Ajustar quantidade** | `quantidadeConfirmada`, como na conferência normal |

Remoção é **lógica**. Nunca `DELETE`. O item sai da conta e permanece na
linha do tempo, com autor e motivo.

### `REMOVIDO` não é `DEVOLVIDO`

A distinção parece sutil e não é:

| Status | Significa | Entra no relatório de ruptura? |
|---|---|---|
| `DEVOLVIDO` | Não havia saldo. Falha de atendimento | **Sim** |
| `REMOVIDO` | Houve acordo com o cliente | **Não** |

Colapsar os dois num status só inutiliza o relatório de ruptura: toda
negociação normal apareceria como falta de estoque, e a loja perderia o sinal
do que realmente precisa repor.

### Preço do item incluído

Precificado **no momento da inclusão**, pela tabela do pedido, e congelado em
`precoCongeladoEm`. Não herda o congelamento do envio original.

Um pedido enviado há três dias, com item incluído hoje: os itens originais
mantêm o preço de três dias atrás; o novo entra pelo preço de hoje. Cada linha
carrega seu próprio instante.

### Consentimento — a regra que decide o fluxo

Terminada a edição, compara-se `valorConfirmado` com `valorSolicitado`:

| Situação | O que acontece |
|---|---|
| Total **igual ou menor** | Segue para confirmação. Cliente é notificado (`PEDIDO_ALTERADO_PELA_EQUIPE`) |
| Total **maior**, com `exigirAceiteAumento` (padrão) | Vai para `AGUARDANDO_ACEITE_CLIENTE`. O app mostra o comparativo e o cliente aceita com um toque |
| Total **maior**, sem exigir aceite | Confirma direto. O evento registra quem decidiu |

**Por que o padrão exige aceite:** o alinhamento aconteceu por telefone ou
WhatsApp, fora do sistema. Confirmar um valor acima do que o cliente enviou,
sem nenhum registro de que ele concordou, deixa a loja sem defesa numa
contestação. Um toque no aplicativo resolve isso e custa segundos.

A empresa pode desligar (`exigirAceiteAumento = false`) — e aí assume que o
registro do acordo existe em outro lugar.

### Transições que isso acrescenta

```
AGUARDANDO_CONFIRMACAO ──equipe edita, total subiu──► AGUARDANDO_ACEITE_CLIENTE
                                                          │
   ┌──────────────────────────────────────────────────────┤
   │ cliente aceita → volta a AGUARDANDO_CONFIRMACAO (equipe confirma)
   │ cliente recusa → DEVOLVIDO (com motivo do cliente)
   └ prazo vence   → EXPIRADO
```

O aceite do cliente **não** confirma o pedido nem reserva estoque. Ele apenas
autoriza o novo valor. A confirmação continua sendo ato da equipe — e é lá que
a reserva nasce, como em todo o resto deste documento.

### O que o cliente vê

A linha do tempo do pedido, no aplicativo, em texto direto:

```
Marina Alves incluiu 2 × Faixa Preta 280cm          hoje, 15:12
Marina Alves removeu Camiseta Treino M · Preto      hoje, 15:12
   "Sem previsão de reposição — combinado por telefone"
Total passou de R$ 5.842,30 para R$ 6.061,14
```

Nomes de quem fez, o que mudou e por quê. Sem isso, o cliente abre o app, vê
outro valor e liga para reclamar.

## 7. Cliente externo é outro domínio de autenticação

Esta é a mudança mais séria que o requisito traz.

Hoje o `TenantGuard` assume que todo usuário autenticado é funcionário da
empresa. Um cliente com login não é isso.

**Decisão: dois domínios de autenticação separados, não um campo `tipo`.**

| | Funcionário | Cliente |
|---|---|---|
| Tabela | `usuario` | `cliente_acesso` |
| Login | `POST /auth/login` | `POST /portal/auth/login` |
| `aud` do token | `funcionario` | `cliente` |
| Escopo no token | `tenant_id`, `lojas[]`, `perfis[]` | `tenant_id`, `cliente_id` |
| Guard | `FuncionarioGuard` | `ClienteGuard` |

Um token de cliente é **estruturalmente incapaz** de passar no
`FuncionarioGuard`: a claim `aud` não confere. Não depende de ninguém lembrar
de filtrar por `tipo` numa consulta.

Tabela única com discriminador foi considerada e descartada: ela funciona
enquanto todo RBAC estiver correto, e falha inteira no primeiro `where`
esquecido. O custo de duas tabelas é pequeno; o custo do vazamento não é.

### RLS para o cliente

Consultas do portal recebem escopo adicional:

```sql
CREATE POLICY cliente_isolation ON pedido
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.cliente_id', true) IS NULL
      OR cliente_id = current_setting('app.cliente_id', true)::uuid
    )
  );
```

`app.cliente_id` vazio = contexto de funcionário. Preenchido = contexto de
cliente, restrito aos próprios pedidos.

### O que o cliente nunca pode acessar

Não é lista de telas escondidas — é regra de servidor:

- Custo, custo médio e margem de qualquer produto.
- Quantidade em estoque, em qualquer loja. **Só disponível / indisponível.**
- Qualquer dado de outro cliente.
- Vendas, caixa, comissões, financeiro da empresa.
- Tabelas de preço às quais não está vinculado.

O último é sutil e é o que mais vaza na prática: o cliente vinculado à tabela
Aluno não pode consultar o preço Revendedor trocando um parâmetro.

## 8. Modo de checkout — a configuração pedida

`tenant_settings.modo_checkout`:

| Valor | O carrinho gera |
|---|---|
| `PAGAMENTO_IMEDIATO` | **Venda** direto, com pagamento e baixa de estoque. Sem aprovação |
| `PEDIDO_COM_CONFIRMACAO` | **Pedido** em `AGUARDANDO_CONFIRMACAO`. Sem efeito em estoque ou financeiro |

Em `PEDIDO_COM_CONFIRMACAO`, quando a cobrança é gerada:

`tenant_settings.momento_cobranca`:

| Valor | Contas a receber nasce |
|---|---|
| `NA_CONFIRMACAO` | Quando a equipe confirma — cliente recebe link de pagamento |
| `NO_FATURAMENTO` | Quando o pedido vira venda (padrão) |

**Extensão natural, decisão pendente:** sobrepor `modo_checkout` por cliente ou
por tabela de preços. Uma loja que atende varejo e atacado tende a querer
pagamento imediato no varejo e pedido com confirmação no revendedor. O modelo
suporta (coluna anulável em `cliente` sobrepondo o padrão da empresa), mas não
implemento sem confirmação.

## 9. Idempotência e concorrência

Herda as regras gerais do sistema, com dois pontos próprios:

1. **Envio do carrinho** carrega `Idempotency-Key`. Cliente com conexão ruim
   toca "enviar" três vezes e gera **um** pedido.
2. **Confirmação** trava as linhas de `stock_balance` envolvidas com
   `SELECT … FOR UPDATE`, ordenadas por id. Dois atendentes confirmando
   pedidos que disputam a mesma peça: um confirma, o outro recebe o item como
   indisponível. Nunca os dois.
3. **Faturamento** é idempotente por `pedido_id`. Reprocessar não gera segunda
   venda, segunda baixa, segundo financeiro nem segunda comissão.

## 10. Auditoria

`pedido_evento`, append-only, um registro por transição:

```
pedido_evento
  id, tenant_id, pedido_id
  de_status, para_status
  ator_tipo        FUNCIONARIO | CLIENTE | SISTEMA
  ator_id
  motivo           text NULL
  itens_afetados   jsonb NULL
  criado_em
```

`ator_tipo = SISTEMA` cobre expiração de reserva e de validade — transições
que ninguém disparou e que, sem registro, viram mistério no suporte.

## 11. Permissões novas

Somam-se às da Fase 1:

| Permissão | Quem costuma ter |
|---|---|
| `pedido.visualizar_fila` | Gestor, Vendedor, Estoquista |
| `pedido.editar_itens` | Gestor, Vendedor |
| `pedido.confirmar` | Gestor, Vendedor |
| `pedido.confirmar_parcial` | Gestor, Vendedor |
| `pedido.confirmar_sem_saldo` | Gestor |
| `pedido.devolver` | Gestor, Vendedor |
| `pedido.recusar` | Gestor |
| `pedido.faturar` | Gestor, Financeiro |
| `pedido.cancelar_confirmado` | Gestor |
| `portal.acessar` | Cliente (perfil do portal) |

## 12. Testes obrigatórios

Além dos da Fase 1:

1. Pedido enviado **não** altera `stock_balance` nem cria `stock_movement`.
2. Confirmação cria reserva; saldo disponível cai; saldo físico não.
3. Dois pedidos sobre a última peça: o primeiro confirma, o segundo recebe o
   item devolvido. Nunca ambos confirmados.
4. Reserva expirada devolve o disponível e **não** aparece no razão de estoque.
5. Faturamento consome a reserva e gera exatamente uma venda, uma baixa, um
   financeiro e uma comissão — mesmo reprocessado.
6. Token de cliente recebe 403 em qualquer rota de funcionário.
7. Cliente A recebe 404 ao buscar pedido do cliente B por id.
8. Nenhuma resposta do portal contém custo, margem ou quantidade de estoque.
9. Cliente vinculado à tabela Aluno não obtém preço de outra tabela, nem
   forçando o parâmetro.
10. Pedido vencido com preço maior não é confirmado sem aceite do cliente.
11. Envio do carrinho com a mesma `Idempotency-Key` gera um único pedido.
12. Transição de status fora do diagrama é rejeitada.
13. Item removido pela equipe sai de `valorConfirmado` mas continua existindo,
    com autor e motivo.
14. Item removido por acordo (`REMOVIDO`) **não** aparece no relatório de
    ruptura; item sem saldo (`DEVOLVIDO`) aparece.
15. Item incluído pela equipe é precificado no instante da inclusão, não pelo
    congelamento do envio.
16. Edição que aumenta o total leva a `AGUARDANDO_ACEITE_CLIENTE` e **não**
    cria reserva de estoque.
17. Edição que reduz ou mantém o total segue direto para confirmação.
18. Com `exigirAceiteAumento = false`, o aumento confirma direto e o evento
    registra quem decidiu.
19. Cliente não consegue aceitar alteração de pedido de outro cliente.
20. Editar pedido que já saiu de `AGUARDANDO_CONFIRMACAO` é rejeitado.


## 10. O que já existe, e o que não

### Implementado

| | Rota |
|---|---|
| Catálogo do cliente | `GET /portal/pedidos/catalogo` |
| Enviar carrinho | `POST /portal/pedidos` |
| Meus pedidos / um pedido | `GET /portal/pedidos[/:id]` |
| Aceitar ou recusar o novo valor | `POST /portal/pedidos/:id/aceite` |
| Fila da equipe | `GET /pedidos?apenasFila=true` |
| Incluir / remover item | `POST /pedidos/:id/itens[/:itemId/remover]` |
| Confirmar (total ou parcial) | `POST /pedidos/:id/confirmar` |
| Devolver / recusar / cancelar | `POST /pedidos/:id/{devolver,recusar,cancelar}` |
| Faturar → vira venda | `POST /pedidos/:id/faturar` |

`modoCheckout` é respeitado, **e a sobreposição por cliente vence a da
empresa** — `cliente.modoCheckout` já existia no schema e era a "extensão
natural, decisão pendente" deste documento. Uma loja que atende varejo e
atacado configura cada um.

`PAGAMENTO_IMEDIATO` gera **venda debitada na carteira do cliente**. Não existe
"pagamento automático" sem uma conta de onde tirar o dinheiro; sem carteira, a
API recusa com motivo. Um gateway resolveria de outro jeito — e não existe.

### O que descobrimos construindo

**Não havia como preencher as tabelas de preço.** O cadastro de produto define
só o preço da tabela padrão, e não existia rota para as demais. Consequência:
um cliente vinculado à tabela Professor via um catálogo **vazio** — sem preço
na tabela dele, o item não existe para ele. Foi o primeiro teste do portal que
revelou. Existe agora `GET`/`PUT /produtos/:id/precos`, com `preco_historico`
append-only.

**As tabelas filhas não tinham escopo de cliente no RLS.** `pedido_item`,
`pedido_evento` e `carteira_movimento` não têm coluna `cliente_id` — o vínculo
passa pelo pai —, então a migração original não as alcançou. No portal, o
pedido do outro cliente era invisível, mas os **itens** dele não. A aplicação
filtrava certo; o ponto do RLS é valer quando ela esquece. Corrigido, com
`estoque_reserva` fechada por completo para o portal: reserva revela
quantidade.

### 10.1 As telas da equipe

Existem duas: `/pedidos` (a fila) e `/pedidos/:id` (o trabalho).

A fila mostra, em cada linha, **a diferença contra o que o cliente enviou**.
Só o total esconderia o que decide se o pedido pode seguir sozinho: um pedido
que subiu de valor precisa de aceite, um que desceu não.

Na tela de trabalho, a confirmação nasce preenchida com **o que o cliente
pediu — inclusive quando falta saldo**.

Isso é deliberado e custou uma correção. A primeira versão sugeria
`min(pedido, disponível)`, o que parece prudente e não é: disponível aqui é
**aviso, não teto**. A API deixa confirmar acima dele com
`pedido.confirmar_sem_saldo` e justificativa, e marca o item
`confirmadoSemSaldo`. Cortar pelo disponível fazia a falta de estoque
**devolver o item ao cliente sozinha**, no meio de um pedido que o operador
confirmaria sem olhar a linha — exatamente o "negativo é permitido, nunca
silencioso" ao contrário. Num pedido em que tudo faltava, a tela chegava a
propor uma ação que só podia dar erro (`NENHUM_ITEM_CONFIRMADO`).

Devolver passou a ser ato: digita-se zero. A falta aparece como selo
**"faltam N"** na linha — texto visível, não `title`, porque no celular não há
hover e é no celular que a equipe confirma.

### 10.2 Mobile não era adaptação, era requisito

As duas telas e o `Shell` nasceram com larguras fixas de desktop. Num telefone
de 375px a coluna de navegação de 240px comia dois terços da tela, a linha da
fila escondia o nome do cliente, e na tela de trabalho o campo de confirmar e
os botões ficavam fora da área visível. A equipe aprova pelo celular — então
isso não era um detalhe de acabamento, era a funcionalidade não existir.

Abaixo de `md` a navegação virou gaveta; abaixo de `sm` a linha da fila e a
linha do item empilham. Os invólucros com `sm:contents` somem no desktop e as
células voltam para as colunas originais, na ordem — o layout de desktop não
foi tocado.

### O que ainda não existe

- **Notificação** de pedido novo, alterado ou aguardando aceite. O modelo está
  em [NOTIFICATIONS.md](NOTIFICATIONS.md); nada dispara ainda.
- **Expiração automática** de reserva e de pedido. `expiraEm` e `validoAte` são
  gravados, mas nenhuma rotina os varre. Ver §4.
- **Reenvio** de um pedido devolvido pelo cliente.
- **`momentoCobranca = NA_CONFIRMACAO`**: hoje a cobrança é sempre no
  faturamento.
- **Revalidação de preço vencido** na confirmação (§5): `validoAte` é gravado e
  ainda não é conferido.
- **O portal do cliente.** A API está pronta e as telas da equipe existem
  (§10.1); o catálogo, o carrinho, "meus pedidos" e a tela de aceite ainda
  não foram construídos.
