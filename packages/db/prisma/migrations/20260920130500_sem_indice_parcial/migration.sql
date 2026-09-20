-- Desfaz o indice PARCIAL criado na migracao anterior.
--
-- O Prisma nao sabe declarar `WHERE` em indice, e um indice que existe no
-- banco e nao existe no schema vira DROP na proxima `migrate dev` — sem
-- ninguem decidir. O indice `(tenant_id, titulo_id, criado_em)` que ja havia
-- cobre a mesma pergunta.
DROP INDEX IF EXISTS baixa_titulo_vivas_idx;
