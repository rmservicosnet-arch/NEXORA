-- Estoque compartilhado entre lojas.
--
-- Ate aqui um local pertencia a UMA loja: `local_estoque.loja_id`. Quem tem um
-- deposito central atendendo tres lojas nao tinha como dizer isso — cada loja
-- so enxergava o proprio estoque, e a unica saida era transferir de um lado
-- para o outro o dia inteiro.
--
-- O dono continua sendo `local_estoque.loja_id`: e onde a mercadoria esta.
-- Esta tabela diz quais OUTRAS lojas tambem vendem dali, e qual delas usa o
-- local como padrao de venda.
--
-- `padrao_venda` aqui e o mesmo conceito da coluna em `local_estoque`, visto
-- do outro lado: uma loja sem local proprio precisa apontar de onde o PDV
-- baixa. Sem isso a loja existiria e nao venderia.

CREATE TABLE "local_estoque_loja" (
    "local_id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "padrao_venda" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "local_estoque_loja_pkey" PRIMARY KEY ("local_id","loja_id")
);

CREATE INDEX "local_estoque_loja_tenant_id_loja_id_idx"
    ON "local_estoque_loja"("tenant_id", "loja_id");

ALTER TABLE "local_estoque_loja"
    ADD CONSTRAINT "local_estoque_loja_local_id_fkey"
    FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "local_estoque_loja"
    ADD CONSTRAINT "local_estoque_loja_loja_id_fkey"
    FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma loja tem UM padrao de venda compartilhado, no maximo. Indice parcial,
-- como o de `local_estoque`: duas linhas padrao fariam o PDV escolher
-- qualquer uma das duas.
CREATE UNIQUE INDEX "local_estoque_loja_padrao_unico"
    ON "local_estoque_loja"("loja_id")
    WHERE "padrao_venda";

-- RLS, na mesma forma das demais: a tabela carrega `tenant_id`, entao ganha a
-- politica de isolamento de empresa. Ver docs/TENANCY.md §2.
ALTER TABLE public.local_estoque_loja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_estoque_loja FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isolamento_tenant ON public.local_estoque_loja;
CREATE POLICY isolamento_tenant ON public.local_estoque_loja
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
