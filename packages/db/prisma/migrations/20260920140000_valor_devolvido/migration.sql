-- Quanto desta venda ja voltou, em dinheiro.
--
-- Derivado dos itens (`total_item / quantidade * quantidade_devolvida`), mas
-- GRAVADO: a listagem precisa somar "faturado liquido" sobre o conjunto
-- inteiro, e uma divisao por item dentro de um agregado com filtro dinamico
-- vira SQL cru que nao acompanha o `where` do Prisma.
--
-- E cache do mesmo jeito que `carteira.saldo` e cache do razao: quem o
-- atualiza e a unica operacao que o move, na mesma transacao.
ALTER TABLE venda
  ADD COLUMN valor_devolvido numeric(14,2) NOT NULL DEFAULT 0;

-- Preenche o que ja existe. Ate aqui so havia cancelamento, que devolve a
-- venda inteira e nao passa por esta coluna — entao o esperado e zero em
-- todas as linhas, e a conta confirma isso em vez de supor.
UPDATE venda v
   SET valor_devolvido = COALESCE((
         SELECT SUM(round(i.total_item / NULLIF(i.quantidade, 0) * i.quantidade_devolvida, 2))
           FROM venda_item i
          WHERE i.venda_id = v.id
            AND i.quantidade_devolvida > 0
       ), 0);
