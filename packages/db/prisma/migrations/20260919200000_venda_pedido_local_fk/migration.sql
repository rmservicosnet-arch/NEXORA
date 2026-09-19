-- Chave estrangeira do local em `venda` e `pedido`.
--
-- As duas tabelas nasceram com `local_id uuid` e nenhuma restrição. Na prática
-- isso é um texto: aceitaria o id de um local excluído, de outra loja ou de
-- outra empresa, e o relatório de saída por local passaria a mentir sem nada
-- acusar.
--
-- `RESTRICT` e não `CASCADE`: apagar um local não pode apagar o histórico de
-- vendas feitas a partir dele. Local que saiu de uso é inativado, não removido.
--
-- Aditiva: nenhuma coluna sai, nenhum dado é reescrito. As duas tabelas estão
-- vazias, então a restrição entra sem validar linha nenhuma.

ALTER TABLE "venda"
  ADD CONSTRAINT "venda_local_id_fkey"
  FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pedido"
  ADD CONSTRAINT "pedido_local_id_fkey"
  FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Consulta do relatório de vendas por local.
CREATE INDEX IF NOT EXISTS "venda_tenant_local_idx" ON "venda" ("tenant_id", "local_id");
