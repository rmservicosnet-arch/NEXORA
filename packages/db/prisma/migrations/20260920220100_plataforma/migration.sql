-- ===========================================================================
-- A PLATAFORMA: tabelas e as leituras que cruzam empresas.
--
-- O valor 'PLATAFORMA' do enum AtorTipo entra na migracao anterior, sozinho:
-- o PostgreSQL nao deixa usar um valor de enum na transacao que o criou.
-- ===========================================================================

-- Sem `tenant_id` nas duas, de proposito: o bloco que habilita RLS varre
-- `pg_attribute` atras daquela coluna, e quem vive aqui nao pertence a empresa
-- nenhuma. Tambem ficam fora de `credencial_login`, que existe para responder
-- "de qual empresa e este e-mail" -- pergunta que nao se faz a plataforma.
CREATE TABLE "plataforma_admin" (
  "id"              uuid         NOT NULL DEFAULT uuidv7(),
  "nome"            varchar(160) NOT NULL,
  "email"           varchar(180) NOT NULL,
  "senha_hash"      varchar(255) NOT NULL,
  "status"          "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
  "ultimo_login_em" timestamptz(3),
  "criado_em"       timestamptz(3) NOT NULL DEFAULT now(),
  -- `@updatedAt` do Prisma nao gera default no banco: sem este `now()`, um
  -- INSERT em SQL puro falha.
  "alterado_em"     timestamptz(3) NOT NULL DEFAULT now(),

  CONSTRAINT "plataforma_admin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plataforma_admin_email_key" ON "plataforma_admin" ("email");

-- Espelha `sessao_refresh`, inclusive a revogacao por reuso que derruba a
-- familia inteira. Tabela separada porque aquela carrega `tenant_id` NOT NULL.
CREATE TABLE "plataforma_sessao" (
  "id"               uuid        NOT NULL DEFAULT uuidv7(),
  "admin_id"         uuid        NOT NULL,
  "token_hash"       varchar(64) NOT NULL,
  "familia_id"       uuid        NOT NULL,
  "expira_em"        timestamptz(3) NOT NULL,
  "revogado_em"      timestamptz(3),
  "motivo_revogacao" varchar(60),
  "user_agent"       varchar(255),
  "ip"               varchar(64),
  "criado_em"        timestamptz(3) NOT NULL DEFAULT now(),

  CONSTRAINT "plataforma_sessao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plataforma_sessao_admin_id_fkey" FOREIGN KEY ("admin_id")
    REFERENCES "plataforma_admin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plataforma_sessao_token_hash_key" ON "plataforma_sessao" ("token_hash");
CREATE INDEX "plataforma_sessao_admin_id_idx"   ON "plataforma_sessao" ("admin_id");
CREATE INDEX "plataforma_sessao_familia_id_idx" ON "plataforma_sessao" ("familia_id");
CREATE INDEX "plataforma_sessao_expira_em_idx"  ON "plataforma_sessao" ("expira_em");

-- ---------------------------------------------------------------------------
-- 2. As leituras que cruzam empresas
--
-- AVISO, e ele e o oposto do de sempre: em `disponivel_no_local` o SECURITY
-- DEFINER precisa filtrar `tenant_id` a mao, ou vira o vazamento que o RLS
-- impede. AQUI cruzar e o proposito -- e por isso a protecao tem de estar em
-- outro lugar:
--
--   1. Cada funcao devolve um recorte FIXO e administrativo: nome, contagem,
--      situacao. Nenhuma devolve dado de negocio -- nem produto, nem cliente,
--      nem item de venda. Nao da para enumerar o que uma empresa vende.
--   2. `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` so para o papel da aplicacao.
--   3. Quem pode CHAMAR e decidido na API, pelo dominio do token. Um token de
--      funcionario nao alcanca a rota: falha na AUTENTICACAO, nao na
--      permissao -- o segredo de assinatura e outro. E o desenho do ADR-009.
--   4. Toda chamada vira linha em `audit_log` da empresa afetada.
--
-- A alternativa que `docs/TENANCY.md` sugeria -- um `prismaUnscoped` -- exigia
-- conexao com papel BYPASSRLS dentro da API. `criarPrisma` recusa esse papel e
-- derruba a inicializacao, e o CLAUDE.md poe isso entre as regras que nao se
-- negociam. O documento foi corrigido no mesmo commit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.plataforma_empresas()
RETURNS TABLE (
  id         uuid,
  nome       varchar,
  slug       varchar,
  documento  varchar,
  status     text,
  criado_em  timestamptz,
  lojas      bigint,
  usuarios   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id,
    t.nome,
    t.slug,
    t.documento,
    t.status::text,
    t.criado_em,
    -- Contagem so do que esta ATIVO: 19 lojas desativadas de teste empurrando
    -- as de verdade para fora ja aconteceu numa tela. O numero que a
    -- plataforma mostra e o que a empresa realmente opera.
    (SELECT count(*) FROM loja l    WHERE l.tenant_id = t.id AND l.status = 'ATIVO'),
    (SELECT count(*) FROM usuario u WHERE u.tenant_id = t.id AND u.status = 'ATIVO')
  FROM tenant t
  ORDER BY t.status, t.nome;
$$;

COMMENT ON FUNCTION public.plataforma_empresas() IS
  'Lista administrativa de TODAS as empresas. SECURITY DEFINER: cruza tenants de proposito. So a API de plataforma chama.';

CREATE OR REPLACE FUNCTION public.plataforma_resumo()
RETURNS TABLE (
  empresas        bigint,
  ativas          bigint,
  suspensas       bigint,
  usuarios_ativos bigint,
  lojas_ativas    bigint,
  vendido_30d     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM tenant),
    (SELECT count(*) FROM tenant WHERE status = 'ATIVO'),
    (SELECT count(*) FROM tenant WHERE status = 'INATIVO'),
    -- Os tres contam SO as empresas ativas, e a tela diz isso no rotulo.
    -- Somar usuario de empresa suspensa daria um total que nao corresponde a
    -- nenhuma linha da lista ao lado.
    (SELECT count(*) FROM usuario u JOIN tenant t ON t.id = u.tenant_id
      WHERE u.status = 'ATIVO' AND t.status = 'ATIVO'),
    (SELECT count(*) FROM loja l JOIN tenant t ON t.id = l.tenant_id
      WHERE l.status = 'ATIVO' AND t.status = 'ATIVO'),
    -- Faturado e `total - devolvido`, sobre tudo o que nao foi cancelado:
    -- somar so a CONCLUIDA faria uma venda com devolucao parcial sumir
    -- inteira, inclusive a parte que ficou com o cliente.
    coalesce((
      SELECT sum(v.total - coalesce(v.valor_devolvido, 0))
        FROM venda v JOIN tenant t ON t.id = v.tenant_id
       WHERE t.status = 'ATIVO'
         -- Lista explicita, nunca `<> 'CANCELADA'`: venda em RASCUNHO nao e
         -- faturamento, e uma negacao passa a incluir todo status FUTURO sem
         -- ninguem decidir -- o mesmo erro do curinga de permissao.
         AND v.status IN ('CONCLUIDA', 'DEVOLVIDA_PARCIAL', 'DEVOLVIDA_TOTAL')
         AND v.criado_em >= now() - interval '30 days'
    ), 0);
$$;

COMMENT ON FUNCTION public.plataforma_resumo() IS
  'Indicadores da plataforma inteira. SECURITY DEFINER: cruza tenants de proposito.';

CREATE OR REPLACE FUNCTION public.plataforma_empresa(p_tenant uuid)
RETURNS TABLE (
  id            uuid,
  nome          varchar,
  slug          varchar,
  documento     varchar,
  status        text,
  criado_em     timestamptz,
  fuso_horario  varchar,
  moeda         varchar,
  lojas         bigint,
  usuarios      bigint,
  produtos      bigint,
  ultima_venda  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id, t.nome, t.slug, t.documento, t.status::text, t.criado_em,
    c.fuso_horario, c.moeda,
    (SELECT count(*) FROM loja l    WHERE l.tenant_id = t.id AND l.status = 'ATIVO'),
    (SELECT count(*) FROM usuario u WHERE u.tenant_id = t.id AND u.status = 'ATIVO'),
    (SELECT count(*) FROM produto p WHERE p.tenant_id = t.id AND p.status = 'ATIVO'),
    (SELECT max(v.criado_em) FROM venda v
      WHERE v.tenant_id = t.id
        AND v.status IN ('CONCLUIDA', 'DEVOLVIDA_PARCIAL', 'DEVOLVIDA_TOTAL'))
  FROM tenant t
  LEFT JOIN tenant_configuracao c ON c.tenant_id = t.id
  WHERE t.id = p_tenant;
$$;

COMMENT ON FUNCTION public.plataforma_empresa(uuid) IS
  'Ficha administrativa de uma empresa. SECURITY DEFINER: le fora do RLS de proposito.';

CREATE OR REPLACE FUNCTION public.plataforma_admins_da_empresa(p_tenant uuid)
RETURNS TABLE (
  id              uuid,
  nome            varchar,
  email           varchar,
  ultimo_login_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Quem carrega o perfil ADMIN_EMPRESA. E a resposta de "a quem eu redefino
  -- a senha quando a empresa perde o acesso".
  SELECT u.id, u.nome, u.email, u.ultimo_login_em
    FROM usuario u
    JOIN usuario_perfil up ON up.usuario_id = u.id
    JOIN perfil p          ON p.id = up.perfil_id
   WHERE u.tenant_id = p_tenant
     AND p.chave = 'ADMIN_EMPRESA'
     AND u.status = 'ATIVO'
   ORDER BY u.nome;
$$;

COMMENT ON FUNCTION public.plataforma_admins_da_empresa(uuid) IS
  'Administradores de uma empresa. SECURITY DEFINER: le fora do RLS de proposito.';

CREATE OR REPLACE FUNCTION public.plataforma_auditoria(p_tenant uuid, p_limite int)
RETURNS TABLE (
  id         uuid,
  acao       varchar,
  entidade   varchar,
  ator_nome  varchar,
  motivo     varchar,
  criado_em  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- So o que a PLATAFORMA fez. A trilha interna da empresa nao e da conta de
  -- quem administra a plataforma: quem quiser auditar as vendas dela entra
  -- pelo suporte, e essa entrada tambem vira linha aqui.
  SELECT a.id, a.acao, a.entidade, a.ator_nome, a.motivo, a.criado_em
    FROM audit_log a
   WHERE a.tenant_id = p_tenant
     AND a.ator_tipo = 'PLATAFORMA'
   ORDER BY a.criado_em DESC
   LIMIT greatest(1, least(coalesce(p_limite, 20), 200));
$$;

COMMENT ON FUNCTION public.plataforma_auditoria(uuid, int) IS
  'O que a plataforma fez numa empresa. SECURITY DEFINER: le fora do RLS de proposito.';

-- ---------------------------------------------------------------------------
-- 3. Quem pode executar
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.plataforma_empresas()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plataforma_resumo()                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plataforma_empresa(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plataforma_admins_da_empresa(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plataforma_auditoria(uuid, int)       FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plataforma_empresas() TO estoque_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plataforma_resumo() TO estoque_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plataforma_empresa(uuid) TO estoque_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plataforma_admins_da_empresa(uuid) TO estoque_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plataforma_auditoria(uuid, int) TO estoque_app';
  END IF;
END
$grant$;
