-- Contas: títulos COM VENCIMENTO, a pagar e a receber.
--
-- Aditiva. O que este módulo NÃO faz: criar um segundo saldo do cliente. O
-- saldo do revendedor continua sendo o da `carteira`, que é o razão — o título
-- acrescenta o que a carteira não tem, que é a DATA. Dar baixa num título a
-- receber lança a quitação NA carteira.

CREATE TYPE "TipoTitulo" AS ENUM ('PAGAR', 'RECEBER');
CREATE TYPE "OrigemTitulo" AS ENUM ('COMPRA', 'VENDA', 'MANUAL');
CREATE TYPE "StatusTitulo" AS ENUM ('ABERTO', 'PAGO', 'CANCELADO');

CREATE TABLE "titulo_financeiro" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "tipo" "TipoTitulo" NOT NULL,
    "origem" "OrigemTitulo" NOT NULL DEFAULT 'MANUAL',
    "loja_id" UUID,
    "fornecedor_id" UUID,
    "cliente_id" UUID,
    "compra_id" UUID,
    "venda_id" UUID,
    "descricao" VARCHAR(200) NOT NULL,
    "parcela" INTEGER NOT NULL DEFAULT 1,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "vencimento" DATE NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "valor_pago" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "StatusTitulo" NOT NULL DEFAULT 'ABERTO',
    "observacao" VARCHAR(400),
    "cancelado_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" VARCHAR(400),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "titulo_financeiro_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "baixa_titulo" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "titulo_id" UUID NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "pago_em" DATE NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "movimento_caixa_id" UUID,
    "carteira_movimento_id" UUID,
    "observacao" VARCHAR(400),
    "ator_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baixa_titulo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "titulo_financeiro_tenant_id_tipo_status_vencimento_idx"
    ON "titulo_financeiro"("tenant_id", "tipo", "status", "vencimento");
CREATE INDEX "titulo_financeiro_tenant_id_fornecedor_id_idx" ON "titulo_financeiro"("tenant_id", "fornecedor_id");
CREATE INDEX "titulo_financeiro_tenant_id_cliente_id_idx" ON "titulo_financeiro"("tenant_id", "cliente_id");
CREATE INDEX "titulo_financeiro_tenant_id_compra_id_idx" ON "titulo_financeiro"("tenant_id", "compra_id");
CREATE INDEX "baixa_titulo_tenant_id_titulo_id_criado_em_idx" ON "baixa_titulo"("tenant_id", "titulo_id", "criado_em");

ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_loja_id_fkey"
    FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_fornecedor_id_fkey"
    FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_compra_id_fkey"
    FOREIGN KEY ("compra_id") REFERENCES "compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_venda_id_fkey"
    FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "baixa_titulo" ADD CONSTRAINT "baixa_titulo_titulo_id_fkey"
    FOREIGN KEY ("titulo_id") REFERENCES "titulo_financeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Um título a pagar tem fornecedor; um a receber tem cliente. Sem isto, uma
-- linha "a pagar" sem fornecedor viraria número órfão na listagem.
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_tem_contraparte" CHECK (
  (tipo = 'PAGAR'   AND (fornecedor_id IS NOT NULL OR origem = 'MANUAL')) OR
  (tipo = 'RECEBER' AND (cliente_id    IS NOT NULL OR origem = 'MANUAL'))
);

-- Pago nunca passa do valor. Baixar mais do que se deve é erro de digitação,
-- e aceitar em silêncio esconderia dinheiro que não existe.
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_pago_dentro_do_valor" CHECK (
  valor_pago >= 0 AND valor_pago <= valor
);

ALTER TABLE "baixa_titulo" ADD CONSTRAINT "baixa_valor_positivo" CHECK (valor > 0);

-- ---------------------------------------------------------------------------
-- RLS
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

-- `titulo_financeiro` TEM `cliente_id`, então o laço de `rls_politicas` lhe
-- daria a política de cliente sozinho — mas só quando essa migração rodasse.
-- Aqui é explícito: o portal vê o próprio título e nada mais.
DROP POLICY IF EXISTS isolamento_cliente ON public.titulo_financeiro;
CREATE POLICY isolamento_cliente ON public.titulo_financeiro AS RESTRICTIVE
  USING (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
  );

-- A baixa não tem `cliente_id`: a política vai pelo PAI, com EXISTS. Sem isto
-- o portal esconderia o título e mostraria as baixas dele.
DROP POLICY IF EXISTS isolamento_cliente ON public.baixa_titulo;
CREATE POLICY isolamento_cliente ON public.baixa_titulo AS RESTRICTIVE
  USING (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.titulo_financeiro t
       WHERE t.id = baixa_titulo.titulo_id
         AND t.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  );

DO $migracao$
DECLARE
  faltando TEXT;
BEGIN
  SELECT string_agg(t.tabela, ', ') INTO faltando
    FROM (VALUES ('titulo_financeiro'), ('baixa_titulo')) AS t(tabela)
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
