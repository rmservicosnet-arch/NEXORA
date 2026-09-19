-- Caixa: controle do dinheiro físico da gaveta.
--
-- Cartão e PIX não passam por aqui — vão para a adquirente, não para a
-- gaveta. Ver docs/CASHBOX.md.
--
-- Aditiva: duas tabelas novas, duas colunas novas em `venda`, nenhuma coluna
-- removida, nenhum dado reescrito.

CREATE TYPE "StatusCaixa" AS ENUM ('ABERTO', 'FECHADO', 'CONFERIDO');
CREATE TYPE "TipoMovimentoCaixa" AS ENUM ('SANGRIA', 'SUPRIMENTO');

CREATE TABLE "caixa" (
    "id"                      UUID           NOT NULL DEFAULT uuidv7(),
    "tenant_id"               UUID           NOT NULL,
    "loja_id"                 UUID           NOT NULL,
    "numero"                  INTEGER        NOT NULL,
    "operador_id"             UUID           NOT NULL,
    "status"                  "StatusCaixa"  NOT NULL DEFAULT 'ABERTO',
    "valor_abertura"          DECIMAL(14,2)  NOT NULL,
    "valor_contado"           DECIMAL(14,2),
    "valor_esperado"          DECIMAL(14,2),
    "diferenca"               DECIMAL(14,2),
    "observacao_abertura"     VARCHAR(400),
    "observacao_fechamento"   VARCHAR(400),
    "aberto_em"               TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechado_em"              TIMESTAMPTZ(3),
    "conferido_por_id"        UUID,
    "conferido_em"            TIMESTAMPTZ(3),
    "observacao_conferencia"  VARCHAR(400),
    "criado_em"               TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em"             TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caixa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movimento_caixa" (
    "id"        UUID                 NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID                 NOT NULL,
    "caixa_id"  UUID                 NOT NULL,
    "tipo"      "TipoMovimentoCaixa" NOT NULL,
    "valor"     DECIMAL(14,2)        NOT NULL,
    "motivo"    VARCHAR(400)         NOT NULL,
    "ator_id"   UUID,
    "criado_em" TIMESTAMPTZ(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimento_caixa_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "venda"
  ADD COLUMN "troco"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "caixa_id" UUID;

-- ---------------------------------------------------------------------------
-- Chaves e índices
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "caixa_tenant_id_numero_key" ON "caixa"("tenant_id", "numero");
CREATE INDEX "caixa_tenant_id_loja_id_status_idx" ON "caixa"("tenant_id", "loja_id", "status");
CREATE INDEX "caixa_tenant_id_operador_id_status_idx" ON "caixa"("tenant_id", "operador_id", "status");
CREATE INDEX "movimento_caixa_tenant_id_caixa_id_criado_em_idx" ON "movimento_caixa"("tenant_id", "caixa_id", "criado_em");
CREATE INDEX "venda_tenant_id_caixa_id_idx" ON "venda"("tenant_id", "caixa_id");

-- UM caixa aberto por operador e loja, garantido pelo banco.
--
-- Índice ÚNICO PARCIAL: a restrição vale só onde `status = 'ABERTO'`. Sem o
-- `WHERE`, o operador não conseguiria abrir um segundo caixa NUNCA MAIS, nem
-- depois de fechar o primeiro.
--
-- No modo COMPARTILHADO_POR_LOJA a regra é "um por loja", que este índice não
-- expressa — ela é verificada na aplicação. A diferença está registrada em
-- docs/CASHBOX.md §2.
CREATE UNIQUE INDEX "caixa_aberto_por_operador"
  ON "caixa" ("tenant_id", "loja_id", "operador_id")
  WHERE "status" = 'ABERTO';

ALTER TABLE "caixa" ADD CONSTRAINT "caixa_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "caixa" ADD CONSTRAINT "caixa_loja_id_fkey"
  FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caixa" ADD CONSTRAINT "caixa_operador_id_fkey"
  FOREIGN KEY ("operador_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caixa" ADD CONSTRAINT "caixa_conferido_por_id_fkey"
  FOREIGN KEY ("conferido_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "movimento_caixa" ADD CONSTRAINT "movimento_caixa_caixa_id_fkey"
  FOREIGN KEY ("caixa_id") REFERENCES "caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT: fechar o caixa não pode ser impedido, mas apagá-lo com vendas
-- apontando para ele, sim. Caixa conferido é documento.
ALTER TABLE "venda" ADD CONSTRAINT "venda_caixa_id_fkey"
  FOREIGN KEY ("caixa_id") REFERENCES "caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security nas tabelas novas
--
-- O MESMO laço da migração `rls_politicas`, de novo. Ele é idempotente e
-- alcança qualquer tabela com `tenant_id` — inclusive as que acabaram de
-- nascer. Repetir é barato; esquecer significa uma tabela de DINHEIRO sem
-- isolamento entre empresas.
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

-- Conferência: derruba a migração se alguma tabela com `tenant_id` ficou sem
-- política. Falhar aqui é barato; descobrir em produção, não.
DO $conferencia$
DECLARE
  desprotegidas text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO desprotegidas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
                       AND a.attname = 'tenant_id'
                       AND NOT a.attisdropped
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 'isolamento_tenant'
     );

  IF desprotegidas IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas com tenant_id e sem política de isolamento: %', desprotegidas;
  END IF;
END
$conferencia$;
