# Notificações push

> Requisito: a equipe aprova pedidos pelo celular e precisa ser avisada quando
> um pedido chega. Sem notificação, o fluxo de confirmação não funciona — o
> pedido fica parado até alguém lembrar de abrir o aplicativo.

## 1. Dois aplicativos, um código

Decisão: **dois aplicativos publicados, construídos do mesmo monorepo.**

```
apps/
  mobile-equipe/    funcionário: fila de pedidos, confirmação, notificações
  mobile-cliente/   cliente: catálogo, carrinho, acompanhamento do pedido
packages/
  contracts/  core/  ui-native/        compartilhados pelos dois
```

**Por que não um app só com dois modos:** são públicos e propósitos
incompatíveis. O app do cliente é vitrine — precisa ser leve, abrir rápido e
passar por revisão de loja como aplicativo de catálogo. O app da equipe é
ferramenta interna, com permissões e dados que não devem sequer existir no
binário que o cliente instala.

Compartilham contratos, regras e componentes. Divergem apenas em navegação,
telas e permissões. O custo é uma segunda configuração de build, não uma
segunda base de código.

**Reversível:** se a operação mostrar que um app só resolve, a fusão é
barata — o código já é comum. O contrário não seria.

## 2. Eventos que geram notificação

| Evento | Vai para | Urgência |
|---|---|---|
| `PEDIDO_RECEBIDO` | Equipe com `pedido.visualizar_fila` na loja do pedido | Alta |
| `PEDIDO_AGUARDANDO_HA_MUITO` | Mesma equipe, após N horas sem ação | Média |
| `PEDIDO_CONFIRMADO` | Cliente que fez o pedido | Alta |
| `PEDIDO_CONFIRMADO_PARCIAL` | Cliente — com o que faltou | Alta |
| `PEDIDO_DEVOLVIDO` | Cliente — com o motivo | Alta |
| `PEDIDO_RECUSADO` | Cliente | Alta |
| `RESERVA_EXPIRANDO` | Equipe responsável pela confirmação | Média |
| `SALDO_NEGATIVO_CRIADO` | Gestor da loja | Baixa |

A lista é fechada. Notificação nova exige entrada aqui e na tabela de
preferências — não se adiciona `sendPush()` solto no meio de um serviço.

## 3. Privacidade no payload

**Regra: o payload de push não carrega valor, nome de cliente nem item.**

A notificação aparece na tela bloqueada, visível a qualquer um que olhe o
aparelho — inclusive no balcão, com fila em volta.

```
❌ "Academia Ippon enviou pedido de R$ 5.842,30"
✅ "Novo pedido aguardando confirmação · Loja Centro"
```

O conteúdo real é carregado pelo aplicativo **depois** da autenticação, ao
abrir o pedido. O push transporta apenas: tipo do evento, `tenant_id`,
`pedido_id` e a loja.

`tenant_settings.push_detalhado` permite à empresa optar por payload com
detalhe, assumindo o risco. Padrão: desligado.

## 4. Registro de dispositivo

```
dispositivo_push
  id, tenant_id
  principal_tipo    FUNCIONARIO | CLIENTE
  principal_id      → usuario.id ou cliente_acesso.id
  token             text        → token FCM/APNs, único
  plataforma        ANDROID | IOS
  app               EQUIPE | CLIENTE
  versao_app        text
  ativo             boolean
  registrado_em, ultimo_uso_em
```

Regras:

- Token é **único globalmente**. Ao registrar um token que já existe para outro
  principal, o registro anterior é desativado. Aparelho trocado de dono não
  continua recebendo pedido da empresa antiga.
- Logout desativa o token do dispositivo imediatamente.
- Token rejeitado pelo provedor (`NotRegistered`) é desativado na hora.
- Dispositivo sem uso por 90 dias é desativado.

O `principal_tipo` acompanha a separação de domínios do `ADR-009`. Um
dispositivo registrado como `CLIENTE` nunca entra na seleção de destinatários
de um evento da equipe.

## 5. Envio

**Fora da transação do pedido.**

```
1. Serviço confirma o pedido e commita a transação
2. Grava evento em notificacao_saida (mesma transação)
3. Worker lê a fila e envia
```

Se o push falhar, o pedido já está confirmado. Se o envio estivesse dentro da
transação, uma indisponibilidade do FCM impediria confirmar pedidos — o que é
inaceitável para uma loja em operação.

```
notificacao_saida
  id, tenant_id
  evento            enum (§2)
  pedido_id         uuid NULL
  destinatarios     jsonb      → resolvidos no momento do enfileiramento
  status            PENDENTE | ENVIADA | FALHA | DESCARTADA
  tentativas        int
  chave_idempotencia text UNIQUE
  criada_em, enviada_em
```

`chave_idempotencia` = `evento + pedido_id + principal_id`. Reprocessar a fila
não notifica ninguém duas vezes sobre o mesmo fato.

Retentativa com recuo exponencial, máximo 5 tentativas. Depois disso a
notificação vira `FALHA` e o aviso permanece **dentro** do aplicativo — o
contador da fila de pedidos não depende de push ter funcionado.

### Push é aviso, não é a verdade

O aplicativo nunca confia no push para saber o estado. Ao abrir, ele consulta a
fila. Push acelera; não substitui. Aparelho em modo avião a manhã inteira abre
o app e vê os 7 pedidos, sem nenhum ter sido perdido.

## 6. Deep link

```
estoquelojas://pedido/<pedido_id>
https://app.<dominio>/pedido/<pedido_id>     (fallback universal link)
```

Ao tocar na notificação, o aplicativo abre direto a confirmação do pedido. Se
não houver sessão, guarda o destino, pede login e então navega.

Validação no servidor, sempre: o `pedido_id` do link é verificado contra o
tenant e o escopo do usuário. Link de pedido de outra empresa retorna **404**,
não 403 — mesma regra de `TENANCY.md`.

## 7. Preferências

Por principal, não global:

```
notificacao_preferencia
  principal_tipo, principal_id, evento
  push        boolean
  email       boolean
  silencio_inicio, silencio_fim    → horário de silêncio (time, opcional)
```

Eventos marcados como **Alta** urgência podem ser silenciados pelo usuário,
mas não desaparecem: continuam como contador e lista dentro do aplicativo.

Horário de silêncio respeita o fuso da loja, não o do servidor.

## 8. Provedor

Expo Notifications sobre FCM (Android) e APNs (iOS). Ambos nativos, sem
WebView — coerente com o `ADR-007`.

O envio sai de um serviço próprio do backend (`NotificacaoService`), não
espalhado nos serviços de domínio. Trocar de provedor mexe em um arquivo.

## 9. Testes obrigatórios

1. Pedido confirmado com FCM fora do ar: o pedido é confirmado mesmo assim.
2. Fila reprocessada não gera notificação duplicada.
3. Token de dispositivo do cliente nunca recebe evento da equipe.
4. Payload enviado não contém valor, nome de cliente nem nome de produto (com
   `push_detalhado` desligado).
5. Logout desativa o token; nenhuma notificação posterior chega ao aparelho.
6. Token registrado por outro principal desativa o registro anterior.
7. Deep link para pedido de outro tenant retorna 404.
8. Aplicativo aberto sem push recebido mostra a fila correta.
9. Horário de silêncio usa o fuso da loja.
