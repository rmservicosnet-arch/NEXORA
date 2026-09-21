-- Situacao em categoria e marca.
--
-- As duas so podiam ser EXCLUIDAS, e so quando ninguem as usava. Com produto
-- apontando nao havia saida nenhuma: a categoria errada ficava na lista de
-- escolha para sempre.
--
-- Apagar com vinculo deixaria os produtos sem categoria, e quem olhasse
-- depois nao saberia que ja tiveram uma. Desativar e a operacao reversivel —
-- some das escolhas NOVAS e nao mexe no que ja existe. E o mesmo raciocinio
-- de suspender uma empresa em vez de excluir.
ALTER TABLE "categoria" ADD COLUMN "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO';
ALTER TABLE "marca"     ADD COLUMN "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO';

CREATE INDEX "categoria_tenant_id_status_idx" ON "categoria" ("tenant_id", "status");
CREATE INDEX "marca_tenant_id_status_idx"     ON "marca" ("tenant_id", "status");
