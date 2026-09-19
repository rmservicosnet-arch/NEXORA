# Arquitetura

> Documento vivo. Deve refletir a implementação real. Se código e documento
> divergirem, o documento está errado e precisa ser corrigido no mesmo commit.

## 1. Visão geral

Plataforma SaaS multiempresa para varejo de artigos esportivos (judô, artes
marciais e correlatos), com estoque multi-loja, PDV, catálogo e financeiro.

O sistema é genérico: nada no domínio assume o segmento esportivo. "Kimono
tamanho A2 azul" é apenas um produto com variações.

## 2. Stack

| Camada | Tecnologia | Versão fixada | Justificativa |
|---|---|---|---|
| Runtime | Node.js | 24.x | Requisito do Prisma 7 (`>=24.0`) |
| Linguagem | TypeScript | 5.9.3 | Ver ADR-002 |
| Backend | NestJS | 12.0.3 | DI + guards/interceptors para tenancy, RBAC e auditoria transversais |
| ORM | Prisma | 7.10.0 | Ver ADR-003 |
| Banco | PostgreSQL | 18.6 | RLS nativo, `numeric` exato, `FOR UPDATE` |
| Frontend | React + Vite | 19.x / 8.x | — |
| UI | Tailwind + Radix | 4.x | Ver ADR-004 |
| Validação | Zod | 4.x | Schema único compartilhado API ↔ Web ↔ Mobile |
| Mobile | Nativo — ver ADR-007 | Fase 6 | **Nunca** WebView empacotado |

## 3. Estrutura do monorepo

```
estoque/
├─ apps/
│  ├─ api/          NestJS — única fonte de verdade das regras de negócio
│  ├─ web/          React + Vite
│  └─ mobile/       React Native + Expo          (Fase 6)
├─ packages/
│  ├─ contracts/    Schemas Zod + tipos compartilhados
│  ├─ core/         Regras puras e determinísticas (custo médio, preço, comissão)
│  └─ ui/           Design System
├─ prisma/          schema.prisma + migrações versionadas
└─ docs/
```

Gerenciador: **npm workspaces**. Sem ferramenta extra de monorepo até que o
tempo de build justifique.

### Por que `packages/core` existe

Cálculo de custo médio, resolução de preço e apuração de comissão são funções
**puras**: recebem dados, devolvem resultado, sem I/O. Isoladas em `core`, elas
são testáveis exaustivamente sem banco, sem HTTP e sem mocks.

`apps/api` orquestra (transação, lock, persistência). `packages/core` decide.

## 4. Regra inegociável: o cliente não decide nada

Nenhuma regra de estoque, preço, desconto, financeiro ou comissão pode ser
avaliada no frontend ou no mobile como fonte de verdade.

O cliente pode **prever** um total para dar feedback imediato ao operador do
PDV. O valor que vale é sempre o que o backend devolve. Em caso de divergência,
o backend vence e o PDV reexibe o total corrigido antes de permitir a
finalização.

Motivo: o cliente é território do usuário. Um PDV com DevTools aberto não pode
conceder desconto que o servidor não autorizou.

## 5. Camadas do backend

```
HTTP
 └─ Guard: JwtAuthGuard        valida token, popula RequestContext
     └─ Guard: TenantGuard     resolve tenant/loja/local a partir do token
         └─ Guard: PermissionsGuard   verifica permissão da rota
             └─ Controller     apenas transporte: valida DTO, delega
                 └─ Service    orquestra caso de uso e transação
                     └─ core/  regra pura
                     └─ Prisma extension  injeta tenant_id
                         └─ PostgreSQL  RLS como última defesa
```

Interceptor de auditoria envolve o conjunto e grava toda mutação.

## 6. Autenticação

- Senha: **Argon2id** (`memoryCost` 19 MiB, `timeCost` 2, `parallelism` 1 —
  parâmetros mínimos do OWASP). Nunca MD5, SHA ou bcrypt novo.
- Access token: JWT, vida curta (15 min), carrega `sub`, `tenantId`, `roles`.
- Refresh token: opaco, rotativo, armazenado **hasheado** no banco, entregue em
  cookie `httpOnly` + `SameSite=Strict` + `Secure`.
- Reuso de refresh token detectado ⇒ revoga toda a família de tokens da sessão.

O access token carrega `tenantId` porque ele é assinado pelo servidor. É a
única origem confiável de tenant. Ver `TENANCY.md`.

## 7. Dinheiro e quantidade

**Nunca `float`. Nunca `number` para valor monetário.**

| Grandeza | Tipo PostgreSQL | Tipo TS |
|---|---|---|
| Preço, valor, total | `numeric(14,2)` | `Decimal` |
| Custo unitário, custo médio | `numeric(18,6)` | `Decimal` |
| Quantidade | `numeric(18,6)` | `Decimal` |
| Percentual (comissão, desconto) | `numeric(9,6)` | `Decimal` |

Custo usa 6 casas porque custo médio ponderado é resultado de divisão e
truncá-lo em 2 casas acumula erro a cada movimentação. Preço usa 2 porque é o
valor efetivamente cobrado.

Quantidade é decimal — não inteiro — para suportar unidades fracionárias
(metro de tecido, quilo). Produtos unitários simplesmente usam escala zero.

Arredondamento: **half-up**, aplicado apenas na apresentação e na gravação do
valor final cobrado. Cálculos intermediários mantêm a precisão total.

## 8. Rastreabilidade

Três mecanismos distintos, com propósitos distintos:

| Mecanismo | O que registra | Mutável? |
|---|---|---|
| `stock_movement` | Todo fato de estoque | **Não.** Append-only |
| `audit_log` | Toda mutação de dado sensível | **Não.** Append-only |
| `updated_at` / `updated_by` | Estado atual da linha | Sim |

Estorno **nunca** apaga o registro original. Gera um lançamento contrário que
referencia o original. O histórico é a verdade; o saldo é derivado dele.

## 9. Decisões arquiteturais (ADR)

### ADR-001 — Greenfield
**Contexto:** o prompt original assumia projeto existente. A inspeção do
diretório em 19/09/2026 encontrou 0 arquivos.
**Decisão:** construir do zero, sem restrição de compatibilidade retroativa.

### ADR-002 — TypeScript 5.9.3, não 7.0.2
**Contexto:** `typescript@latest` é 7.0.2, a reimplementação nativa.
**Decisão:** fixar 5.9.3 (último estável da linha 5.x).
**Motivo:** NestJS depende de `emitDecoratorMetadata` e de metadados de
decorator em runtime. Essa é precisamente a superfície de maior risco da port
nativa. O projeto não pode pagar esse risco na fundação.
**Revisão:** reavaliar quando NestJS declarar suporte explícito a TS 7.

### ADR-003 — Prisma 7.10.0, não 8.0.0-rc
**Contexto:** a tag `latest` de `prisma` (CLI) aponta para `8.0.0-rc.15`, um
release candidate, enquanto `@prisma/client` estável é `7.10.0`.
**Decisão:** fixar ambos em `7.10.0`, sem intervalo (`~` ou `^`).
**Motivo:** CLI e client do Prisma precisam ser da mesma versão. Instalar
`latest` produziria um par incompatível e um RC em produção.

### ADR-004 — Tailwind + Radix, componentes próprios
**Decisão:** Radix UI para comportamento e acessibilidade (headless), Tailwind
para estilo, componentes visuais próprios em `packages/ui`.
**Motivo:** o PDV é a tela mais crítica do produto e exige controle total de
layout, foco e teclado. Bibliotecas opinativas (MUI, AntD) seriam combatidas
exatamente onde mais importa.

### ADR-005 — Schema único + `tenant_id` + RLS
Ver `TENANCY.md` para o detalhamento completo.

### ADR-008 — Pedido e venda são entidades distintas

**Contexto:** clientes externos montam carrinho no aplicativo e enviam um
pedido, que a equipe confirma antes de virar venda.

**Decisão:** `pedido` é uma entidade própria, não um status de `venda`. O
pedido faturado **gera** uma venda, pelo mesmo serviço que o PDV usa.

**Motivo:** pedido em espera não é faturamento. Tratá-lo como venda com status
corromperia relatório de receita, custo médio e apuração de comissão — todos
consultam `venda`. E forçaria o PDV a conviver com estados que ele não tem.

**Consequência:** o PDV permanece inalterado. Ver `docs/ORDERS.md`.

### ADR-009 — Dois domínios de autenticação: funcionário e cliente

**Contexto:** o cliente externo passa a ter login. Ele não é funcionário da
empresa e não pode acessar custo, estoque ou dados de outros clientes.

**Decisão:** domínios separados — tabela `usuario` (funcionários) e
`cliente_acesso` (clientes), rotas de login distintas, e claim `aud` do token
com valor `funcionario` ou `cliente`. Guards distintos.

**Alternativa descartada:** tabela única com coluna `tipo`. Funciona enquanto
todo RBAC estiver correto e falha inteira no primeiro `where` esquecido.

**Motivo:** um token de cliente fica estruturalmente incapaz de passar no
guard de funcionário — a `aud` não confere. A garantia deixa de depender de
disciplina de quem escreve a consulta.

**Consequência:** o contexto de RLS ganha `app.cliente_id`, e o `TenantGuard`
da Fase 1 precisa nascer já preparado para os dois domínios.

### ADR-007 — Mobile é nativo; WebView empacotado é proibido

**Contexto:** requisito explícito do produto — o aplicativo deve ter estrutura
nativa, não uma aplicação web empacotada.

**Decisão (parte firme, não sujeita a revisão):** estão **proibidas** as
seguintes abordagens, em qualquer fase do projeto:

| Proibido | O que é |
|---|---|
| Capacitor / Cordova / Ionic | HTML renderizado dentro de um `WebView` |
| PWA instalada / TWA | O navegador do sistema com moldura de app |
| Qualquer tela do app servida por `WebView` | Inclusive "só para a tela X" |

Motivo técnico, além do requisito: o PDV mobile depende de câmera com leitura
contínua de código de barras. Em `WebView` isso passa por `getUserMedia` +
decodificação em JavaScript — lento, impreciso sob luz ruim e sem acesso ao
autofoco e ao scanner de hardware. É a diferença entre um leitor que funciona
no balcão e um que não funciona.

**Decisão (parte em aberto):** qual estrutura nativa adotar está pendente de
decisão do produto. As opções avaliadas estão em `docs/MOBILE.md`.

**Observação de terminologia:** React Native **não** é aplicação web
empacotada. Ele não usa `WebView`, DOM, HTML nem CSS: a lógica roda em um
motor JavaScript (Hermes) e a interface é composta por views nativas reais
(`android.view.View` / `UIView`), através do renderizador Fabric. A confusão
com Cordova/Capacitor é comum e vale registrar aqui para não se repetir.

### ADR-006 — Caixa configurável por empresa
**Decisão:** suportar dois modos (`PER_OPERATOR` e `SHARED_PER_STORE`),
definidos em `tenant_settings`.
**Motivo:** requisito de produto SaaS — lojas com balcão único e lojas com
vendedores dedicados têm operações incompatíveis.
**Consequência:** fechamento, conferência e relatórios precisam tratar os dois
modos. Ver `docs/CASH_REGISTER.md` (Fase 5).

## 10. Não implementado nesta fase

- Emissão fiscal (NFC-e/NF-e). A arquitetura mantém os campos e a separação
  necessários, mas nenhuma integração fiscal é construída agora.
- Integração WhatsApp/IA. Ver `INTEGRATIONS.md` (Fase 6).
