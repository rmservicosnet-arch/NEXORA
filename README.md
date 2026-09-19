# Estoque

Plataforma SaaS multiempresa para varejo: estoque multi-loja, PDV, catálogo,
pedidos com confirmação, carteira de cliente e financeiro.

O domínio é genérico — nada assume o segmento esportivo. "Kimono A2 azul" é
apenas um produto com variações.

## Começar

Precisa de **Node 24+** e **PostgreSQL 18+** (o `uuidv7()` é nativo da 18).

```bash
npm install
Copy-Item .env.example .env      # e preencha POSTGRES_SUPERUSER_URL
npm run db:setup                 # banco + dois usuários com privilégios separados
npm run db:migrate               # tabelas e políticas de RLS
npm run db:seed                  # empresa de demonstração
npm run dev                      # API em :3333, web em :5173
```

Acesso de desenvolvimento (senhas de seed — não use fora da sua máquina):

| Quem | E-mail | Senha |
|---|---|---|
| Administrador | `rodrigo@lojacentro.com.br` | `Estoque@2026` |
| Financeiro | `beatriz@lojacentro.com.br` | `Estoque@2026` |
| Estoquista (uma loja só) | `sergio@lojacentro.com.br` | `Estoque@2026` |
| Cliente (portal) | `carlos@academiaippon.com.br` | `Cliente@2026` |

Entre com dois deles e compare o menu: ele muda conforme as permissões.

## Estrutura

```
apps/
  api/        NestJS — autenticação, guards, regras de negócio
  web/        React + Vite
packages/
  core/       regras puras: custo médio, preço, comissão
  contracts/  schemas Zod compartilhados
  db/         schema Prisma, migrações, cliente com escopo de tenant
docs/         as decisões, e o porquê delas
scripts/      preparação e conferência do banco
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API e web juntas |
| `npm test` | Toda a suíte |
| `npm run typecheck` | `tsc -b` no monorepo inteiro |
| `npm run lint` | ESLint |
| `npm run db:setup` | Cria banco e os dois usuários. Idempotente |
| `npm run db:migrate` | Aplica migrações |
| `npm run db:seed` | Recria a empresa de demonstração |
| `npm run db:verificar` | Confere privilégios e prova o isolamento |

## Três coisas que o projeto leva a sério

**Dinheiro não é `float`.** `dec()` recusa um `number` com casas decimais —
ou é inteiro, ou vem como string. O lint proíbe `parseFloat` e `Math.round`
em código monetário. `0.1 + 0.2` não é `0.3`, e balanço não perdoa.

**O isolamento entre empresas é do banco, não da aplicação.** Row-Level
Security em 36 tabelas, com `FORCE`. Consulta sem contexto devolve **zero**
linhas, nunca todas. A aplicação se recusa a iniciar se conectar com um papel
que tenha `BYPASSRLS`.

**O histórico não se reescreve.** Razão de estoque, extrato de carteira e
trilha de auditoria são *append-only*. Estorno gera lançamento contrário; o
original permanece. Relatório de período passado consultado hoje e daqui a um
ano devolve o mesmo número.

## Documentação

Leia nesta ordem para entender o sistema:

| | |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Stack e as decisões arquiteturais (ADRs) |
| [TENANCY](docs/TENANCY.md) | Isolamento em três camadas e os critérios de aceite |
| [COST_POLICY](docs/COST_POLICY.md) | Custo médio ponderado, inclusive com saldo negativo |
| [ORDERS](docs/ORDERS.md) | Pedidos com confirmação, edição pela equipe e aceite |
| [WALLET](docs/WALLET.md) | Carteira do cliente e a convenção de sinal |
| [REPORTS](docs/REPORTS.md) | Catálogo de relatórios e o que os torna reprodutíveis |
| [MEDIA](docs/MEDIA.md) · [MOBILE](docs/MOBILE.md) · [NOTIFICATIONS](docs/NOTIFICATIONS.md) | Imagens, aplicativo nativo, push |
| [DESIGN_SYSTEM](DESIGN_SYSTEM.md) | Tokens, componentes e as regras de interface |

## Situação

**Fase 1 concluída.** Isolamento multiempresa, autenticação nos dois domínios,
permissões, custo médio ponderado, e a web com login e shell.

Os sete critérios de aceite de `TENANCY.md` passam em teste automatizado.

Falta: produtos, estoque, PDV, pedidos, carteira, relatórios e o aplicativo
nativo. As decisões dessas fases já estão escritas em `docs/`.
