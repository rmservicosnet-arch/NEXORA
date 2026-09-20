-- Compras: o documento de entrada de mercadoria COM CUSTO.
--
-- Aditiva. Nada é removido nem reescrito: duas tabelas novas e um enum novo.
-- Ver docs/COST_POLICY.md — é o `custo_unitario` daqui que forma o custo médio.

CREATE TYPE "StatusCompra" AS ENUM ('RASCUNHO', 'RECEBIDA', 'ESTORNADA');

CREATE TABLE "compra" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "local_id" UUID NOT NULL,
    "fornecedor_id" UUID NOT NULL,
    "numero_nota" VARCHAR(40),
    "emitida_em" TIMESTAMPTZ(3),
    "status" "StatusCompra" NOT NULL DEFAULT 'RASCUNHO',
    "valor_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacao" VARCHAR(400),
    "recebida_em" TIMESTAMPTZ(3),
    "recebida_por_id" UUID,
    "estornada_em" TIMESTAMPTZ(3),
    "estornada_por_id" UUID,
    "motivo_estorno" VARCHAR(400),
    -- `@updatedAt` do Prisma não gera default no banco: sem o `DEFAULT now()`
    -- todo INSERT em SQL puro falharia.
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compra_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compra_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "compra_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,6) NOT NULL,
    "custo_unitario" DECIMAL(18,6) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "custo_medio_antes" DECIMAL(18,6),
    "custo_medio_depois" DECIMAL(18,6),
    "movimento_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compra_item_pkey" PRIMARY KEY ("id")
);

-- A MESMA nota do MESMO fornecedor lançada duas vezes dobra a mercadoria e
-- estraga o custo médio de cada item dela. Rascunho sem número não colide:
-- no PostgreSQL, NULLs não se repetem para efeito de unicidade.
CREATE UNIQUE INDEX "compra_tenant_id_fornecedor_id_numero_nota_key"
    ON "compra"("tenant_id", "fornecedor_id", "numero_nota");

CREATE INDEX "compra_tenant_id_status_emitida_em_idx" ON "compra"("tenant_id", "status", "emitida_em");
CREATE INDEX "compra_tenant_id_fornecedor_id_idx" ON "compra"("tenant_id", "fornecedor_id");
CREATE INDEX "compra_item_tenant_id_compra_id_idx" ON "compra_item"("tenant_id", "compra_id");
CREATE INDEX "compra_item_tenant_id_variacao_id_idx" ON "compra_item"("tenant_id", "variacao_id");

ALTER TABLE "compra" ADD CONSTRAINT "compra_loja_id_fkey"
    FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compra" ADD CONSTRAINT "compra_local_id_fkey"
    FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compra" ADD CONSTRAINT "compra_fornecedor_id_fkey"
    FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compra_item" ADD CONSTRAINT "compra_item_compra_id_fkey"
    FOREIGN KEY ("compra_id") REFERENCES "compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compra_item" ADD CONSTRAINT "compra_item_variacao_id_fkey"
    FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS
--
-- O mesmo laço de `rls_politicas`: toda tabela com `tenant_id` ganha a
-- política. Repetido aqui porque tabela nova nasce SEM política, e uma tabela
-- de compras sem isolamento mostraria a nota de uma empresa para outra.
-- ---------------------------------------------------------------------------
DO $migracao$
DECLARE
  alvo RECORD;
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

-- O portal do cliente não enxerga compra nenhuma: custo de fornecedor é
-- informação da loja. Sem a política restritiva, `app.cliente_id` preenchido
-- não bloquearia nada — a tabela não tem `cliente_id` para filtrar.
DO $migracao$
DECLARE
  alvo TEXT;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['compra', 'compra_item']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS isolamento_cliente ON public.%I', alvo);
    EXECUTE format($politica$
      CREATE POLICY isolamento_cliente ON public.%I AS RESTRICTIVE
        USING (nullif(current_setting('app.cliente_id', true), '') IS NULL)
    $politica$, alvo);
  END LOOP;
END
$migracao$;

-- Conferência: derruba a migração se alguma tabela nova ficou sem política.
-- Falhar aqui é barato; descobrir em produção, não.
DO $migracao$
DECLARE
  faltando TEXT;
BEGIN
  SELECT string_agg(t.tabela, ', ') INTO faltando
    FROM (VALUES ('compra'), ('compra_item')) AS t(tabela)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = t.tabela
        AND p.policyname = 'isolamento_tenant'
   );

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela sem isolamento de tenant: %', faltando;
  END IF;
END
$migracao$;
