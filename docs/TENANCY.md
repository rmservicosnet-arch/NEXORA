# Isolamento multiempresa (Multi-tenancy)

> Este é o documento mais importante do projeto do ponto de vista de risco.
> Uma falha aqui expõe dados de uma empresa para outra. Nenhuma exceção às
> regras abaixo pode ser introduzida sem um ADR explícito.

## 1. Estratégia: schema único + `tenant_id` + RLS

Todas as empresas compartilham o mesmo schema PostgreSQL. Cada tabela de
domínio carrega `tenant_id`. Row-Level Security do PostgreSQL atua como
camada final de defesa.

**Alternativas descartadas:**

| Opção | Por que não |
|---|---|
| Schema por empresa | Migração precisa rodar em N schemas; Prisma não suporta nativamente; operação cara a partir de dezenas de tenants |
| Banco por empresa | Isolamento máximo, custo e complexidade operacional incompatíveis com o estágio do produto |
| Apenas `tenant_id` na aplicação | Um único `where` esquecido vaza dados sem nenhuma rede de proteção |

## 2. Defesa em três camadas

Cada camada assume que a anterior falhou.

### Camada 1 — Origem do tenant

`tenant_id` é derivado **exclusivamente** do JWT validado pelo servidor.

```
REGRA: nenhum tenant_id vindo de body, query string, path param ou header
       é jamais lido para decidir escopo de dados.
```

Se uma requisição contiver `tenantId` no payload e ele divergir do token,
isso é tratado como **tentativa de acesso cruzado**: a requisição é rejeitada
com 403 e um registro `CROSS_TENANT_ATTEMPT` é gravado em `audit_log`.

Não é paranoia: é a diferença entre um bug e um incidente de vazamento.

### Camada 2 — Prisma Client Extension

Uma extension intercepta toda operação e injeta `tenant_id` em `where` e em
`data`, a partir do contexto da requisição (AsyncLocalStorage).

Consultas que precisam cruzar tenants existem — são poucas e todas
administrativas (métricas da plataforma, suporte). Elas usam um cliente
distinto e explícito, `prismaUnscoped`, cujo uso:

- exige perfil `PLATFORM_ADMIN`;
- é registrado em `audit_log` sempre;
- é proibido por regra de lint fora de `apps/api/src/platform/`.

### Camada 3 — Row-Level Security

Toda tabela com `tenant_id` tem RLS habilitado:

```sql
ALTER TABLE produto ENABLE ROW LEVEL SECURITY;
ALTER TABLE produto FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON produto
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`FORCE` é essencial: sem ele, o dono da tabela ignora a policy.

A aplicação conecta com um usuário **sem** `BYPASSRLS` e **sem** ser dono das
tabelas. Migrações rodam com um usuário separado e privilegiado.

### Como o `app.tenant_id` chega ao banco

O Prisma usa um pool de conexões. Uma conexão é reutilizada entre requisições
de tenants diferentes. Portanto:

```
REGRA: app.tenant_id é definido com SET LOCAL, sempre dentro de uma transação.
```

`SET LOCAL` expira no fim da transação. `SET` comum vazaria o tenant da
requisição anterior para a próxima que pegasse a mesma conexão do pool — que é
exatamente o vazamento que a camada 3 deveria impedir.

Consequência prática: **toda leitura e escrita de dado de tenant acontece
dentro de uma transação.** Isso é imposto pela camada de repositório, não
deixado à disciplina de quem escreve a query.

## 3. Escopo além do tenant

Tenant não é o único escopo. Um vendedor da Loja Centro não deve movimentar o
estoque da Loja Shopping.

```
Plataforma
 └─ Tenant (empresa)
     └─ Loja
         └─ Local de estoque
```

O token carrega o tenant. Loja e local são verificados por requisição contra
os vínculos do usuário (`user_store_access`). `TenantGuard` resolve o tenant;
`StoreScopeGuard` valida loja e local quando a rota os recebe.

## 4. Contextos sem requisição HTTP

Jobs, filas, webhooks e integrações **não têm** um JWT. Eles ainda precisam de
tenant.

```
REGRA: todo job carrega tenant_id explícito no payload e abre seu próprio
       contexto com SET LOCAL antes de tocar em qualquer dado.
```

Um job sem `tenant_id` no payload é rejeitado na enfileiração, não na execução.
Falhar cedo e alto.

## 5. Vazamento por canais secundários

Isolamento não é só `SELECT`. Também vaza por:

| Canal | Mitigação |
|---|---|
| Logs | Nunca logar payload cru. Campos pessoais e monetários são mascarados |
| Mensagens de erro | Erro de banco nunca chega ao cliente. Resposta genérica + `correlationId` |
| IDs sequenciais | Chaves primárias são **UUID v7**, não `serial`. Sem enumeração |
| 404 vs 403 | Recurso de outro tenant retorna **404**, não 403. 403 confirmaria que o recurso existe |
| Contadores e agregados | Toda agregação passa pelo mesmo escopo das listagens |
| Cache | Chave de cache **sempre** prefixada com `tenant_id` |

## 6. Critério de aceite — Fase 1

**Situação: os sete cumpridos e cobertos por teste automatizado.**

| # | Onde está o teste |
|---|---|
| 1, 2, 4, 5, 7 | `packages/db/src/isolamento.test.ts` |
| 3, 6 | `apps/api/src/auth/auth.e2e.test.ts` |

Mais a conferência de ambiente em `npm run db:verificar`, que prova o mesmo
contra o banco real, sem passar pela aplicação.

### Nuance do critério 3, descoberta ao testar

A recusa de `tenantId` forjado acontece no guard de autenticação, que só roda
em **rota protegida**. Em rota pública — `/auth/login` e `/auth/refresh` — não
existe token, logo não existe tenant de referência com que comparar.

Isso não é brecha. `/auth/refresh` é pública de propósito (o token de acesso
pode estar expirado, que é o motivo de renovar) e se protege por outro meio: o
refresh token carrega o tenant e seu hash precisa bater com uma sessão viva e
não revogada. Um `tenantId` enviado no corpo dessa rota é simplesmente
ignorado.

A primeira versão do teste supôs o contrário e falhou. Ficou registrado como
teste explícito, para ninguém "corrigir" isso depois.

### Os sete

O isolamento só é considerado implementado quando estes testes passarem:

1. Usuário do tenant A recebe **404** ao buscar recurso do tenant B por ID.
2. Listagens nunca retornam linha de outro tenant, em nenhum endpoint.
3. `tenantId` forjado no body é ignorado e gera `CROSS_TENANT_ATTEMPT`.
4. Query executada sem `app.tenant_id` definido retorna **zero linhas** — não
   todas. (Valida que a policy RLS está ativa e que `FORCE` está aplicado.)
5. Job enfileirado sem `tenant_id` é rejeitado.
6. Usuário sem vínculo com a loja recebe 403 ao movimentar o estoque dela.
7. Conexão da aplicação não possui `BYPASSRLS` nem é dona das tabelas.

Estes testes rodam no CI e falham o build. Não são documentação — são portão.
