-- O perfil do cliente: o que ele É para a loja.
--
-- Diferente da TABELA DE PREÇO, que diz quanto ele paga, e diferente do
-- `perfil` da equipe, que é papel de permissão. Existe porque um programa de
-- premiação precisa de uma classificação ESTÁVEL: mover um professor para uma
-- tabela promocional por um mês não pode tirá-lo do ranking de revendedores.
--
-- Aditiva. Nada é removido nem reescrito.

CREATE TYPE "PerfilCliente" AS ENUM ('CONSUMIDOR', 'PROFESSOR', 'REVENDEDOR');

ALTER TABLE "cliente"
  ADD COLUMN "perfil" "PerfilCliente" NOT NULL DEFAULT 'CONSUMIDOR';

CREATE INDEX "cliente_tenant_id_perfil_idx" ON "cliente"("tenant_id", "perfil");

-- ---------------------------------------------------------------------------
-- Carga inicial, UMA vez.
--
-- Todo mundo nascer CONSUMIDOR deixaria o ranking vazio no primeiro dia e a
-- classificação inteira para fazer à mão. A tabela de preço é o melhor palpite
-- que existe hoje sobre quem é quem — e é só isso: um palpite inicial. Daqui
-- em diante o perfil é editado na tela de clientes e NÃO acompanha mais a
-- tabela. Rodar isto de novo desfaria correções manuais; por isso é aqui, na
-- migração, e não numa rotina.
-- ---------------------------------------------------------------------------
UPDATE "cliente" c
   SET "perfil" = 'REVENDEDOR'
  FROM "tabela_preco" t
 WHERE t.id = c.tabela_preco_id
   AND upper(t.nome) LIKE 'REVENDEDOR%';

UPDATE "cliente" c
   SET "perfil" = 'PROFESSOR'
  FROM "tabela_preco" t
 WHERE t.id = c.tabela_preco_id
   AND upper(t.nome) LIKE 'PROFESSOR%';
