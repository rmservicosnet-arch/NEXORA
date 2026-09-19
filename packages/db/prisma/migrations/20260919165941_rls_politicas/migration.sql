-- ===========================================================================
-- Row-Level Security — a terceira camada de isolamento
--
-- Ver docs/TENANCY.md §2. As camadas 1 e 2 (origem do tenant no token e
-- extension do Prisma) vivem na aplicação. Esta é a que continua valendo
-- quando as duas falham.
--
-- Escrita à mão porque o Prisma não modela RLS no schema.
--
-- Decisões:
--
--   * `current_setting('app.tenant_id', true)` devolve NULL quando a variável
--     não foi definida. `tenant_id = NULL` é NULL, que não é TRUE — logo a
--     linha é filtrada. Consulta sem contexto retorna ZERO linhas, nunca
--     todas. É o critério de aceite nº 4 do TENANCY.md.
--
--   * `nullif(..., '')` trata a variável definida como string vazia. Sem ele,
--     `''::uuid` lançaria erro em vez de filtrar.
--
--   * `FORCE` alcança o dono da tabela. Sem ele, o dono ignora a policy.
--     É por isso que o `estoque_migrator` recebe BYPASSRLS (ele PRECISA
--     escrever em migração e seed) e a aplicação se recusa a iniciar com um
--     papel privilegiado — ver packages/db/src/client.ts.
--
--   * A policy de cliente é RESTRICTIVE, não PERMISSIVE. Policies permissivas
--     se somam com OR; restritivas se somam com AND. Como o escopo de cliente
--     precisa valer JUNTO com o de tenant, e não no lugar dele, tem de ser
--     restritiva. Trocar isso por PERMISSIVE abriria o portal do cliente para
--     os pedidos de todo mundo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Toda tabela que carrega `tenant_id`
-- ---------------------------------------------------------------------------

DO $migracao$
DECLARE
  alvo record;
BEGIN
  FOR alvo IN
    SELECT c.relname AS tabela
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
                         AND a.attname = 'tenant_id'
                         AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', alvo.tabela);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', alvo.tabela);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', alvo.tabela);
    EXECUTE format($politica$
      CREATE POLICY isolamento_tenant ON public.%I
        USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    $politica$, alvo.tabela);
  END LOOP;
END
$migracao$;

-- ---------------------------------------------------------------------------
-- 2. A própria tabela `tenant` — o identificador está em `id`, não em
--    `tenant_id`. Uma empresa só enxerga a si mesma.
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant ON public.tenant;
CREATE POLICY isolamento_tenant ON public.tenant
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 3. Escopo de CLIENTE — camada adicional, restritiva.
--
--    `app.cliente_id` vazio  = contexto de funcionário; nada é restringido
--    `app.cliente_id` cheio  = contexto do portal; só os próprios dados
-- ---------------------------------------------------------------------------

DO $migracao$
DECLARE
  alvo record;
BEGIN
  FOR alvo IN
    SELECT c.relname AS tabela
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
                         AND a.attname = 'cliente_id'
                         AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS isolamento_cliente ON public.%I', alvo.tabela);
    EXECUTE format($politica$
      CREATE POLICY isolamento_cliente ON public.%I AS RESTRICTIVE
        USING (
          nullif(current_setting('app.cliente_id', true), '') IS NULL
          OR cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
        )
    $politica$, alvo.tabela);
  END LOOP;
END
$migracao$;

-- A tabela `cliente` guarda o identificador em `id`.
DROP POLICY IF EXISTS isolamento_cliente ON public.cliente;
CREATE POLICY isolamento_cliente ON public.cliente AS RESTRICTIVE
  USING (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR id = nullif(current_setting('app.cliente_id', true), '')::uuid
  );

-- ---------------------------------------------------------------------------
-- 4. `permissao` é catálogo global do sistema, sem tenant. Fica legível por
--    todos e gravável só por quem roda migração.
-- ---------------------------------------------------------------------------

-- Nenhuma policy: a tabela não tem RLS e é apenas leitura para a aplicação.
REVOKE INSERT, UPDATE, DELETE ON public.permissao FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. Conferência: nenhuma tabela com `tenant_id` pode ficar sem policy.
--    Falhar aqui aborta a migração — é melhor do que descobrir em produção.
-- ---------------------------------------------------------------------------

DO $migracao$
DECLARE
  desprotegidas text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO desprotegidas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
                       AND a.attname = 'tenant_id'
                       AND NOT a.attisdropped
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

  IF desprotegidas IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas com tenant_id sem RLS forçado: %', desprotegidas;
  END IF;
END
$migracao$;
