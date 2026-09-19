-- Exclusão lógica e autoria das imagens de produto, mais a garantia de que
-- existe no máximo UMA imagem principal por produto.
--
-- docs/MEDIA.md §3 já exigia as três coisas; o schema inicial não tinha
-- nenhuma. Migração aditiva: nenhuma coluna sai, nenhum dado é reescrito.

ALTER TABLE "produto_imagem"
  ADD COLUMN IF NOT EXISTS "excluido_em" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "criado_por"  UUID;

-- Por que índice parcial e não `UNIQUE (tenant_id, produto_id, principal)`:
-- aquele permitiria uma única imagem NÃO principal por produto, que é o
-- oposto do desejado. O índice precisa valer só onde `principal` é verdadeiro.
--
-- E precisa ignorar as excluídas: trocar a foto principal é apagar a antiga e
-- eleger outra, e as duas coexistem enquanto a primeira ainda está na tabela.
CREATE UNIQUE INDEX IF NOT EXISTS "produto_imagem_principal_unica"
  ON "produto_imagem" ("tenant_id", "produto_id")
  WHERE "principal" AND "excluido_em" IS NULL;

-- Consulta quente do catálogo e da listagem: as fotos vivas de um produto, na
-- ordem. Sem isto, a listagem de produtos varre imagens excluídas à toa.
CREATE INDEX IF NOT EXISTS "produto_imagem_vivas_idx"
  ON "produto_imagem" ("tenant_id", "produto_id", "ordem")
  WHERE "excluido_em" IS NULL;
