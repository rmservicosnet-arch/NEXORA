-- Chaves estrangeiras de `venda_id` e `pedido_id` em `carteira_movimento`.
--
-- Mesmo furo que `venda.local_id` tinha: sem restrição, o id é só um texto. O
-- extrato do cliente podia apontar para uma venda de outra empresa, ou para
-- nenhuma, e o relatório de conciliação passaria a mentir sem nada acusar.
--
-- `RESTRICT`: apagar uma venda não pode arrastar o movimento de dinheiro que
-- ela gerou. Venda cancelada muda de status; não some.

ALTER TABLE "carteira_movimento"
  ADD CONSTRAINT "carteira_movimento_venda_id_fkey"
  FOREIGN KEY ("venda_id") REFERENCES "venda"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "carteira_movimento"
  ADD CONSTRAINT "carteira_movimento_pedido_id_fkey"
  FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
