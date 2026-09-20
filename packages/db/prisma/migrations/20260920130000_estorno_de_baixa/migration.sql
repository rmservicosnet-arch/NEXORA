-- Estorno de baixa de titulo.
--
-- Uma baixa errada digitada pela equipe nao tinha como ser desfeita: nao havia
-- rota, e a mensagem que recusava o cancelamento de uma venda mandava
-- "estornar a baixa" — um botao que nao existia.
--
-- A baixa NAO e apagada. Ela e marcada como estornada, e o movimento de caixa
-- e o lancamento de carteira que ela gerou recebem os lancamentos contrarios
-- nos razoes deles. Apagar a linha diria que o dinheiro nunca se moveu, e ele
-- se moveu.

ALTER TABLE baixa_titulo
  ADD COLUMN estornada_em     timestamptz(3),
  ADD COLUMN estorno_motivo   varchar(400),
  ADD COLUMN estornada_por_id uuid;

-- So a baixa VIVA conta para o valor pago do titulo. O indice parcial e o que
-- torna barata a pergunta que a listagem faz em toda pagina.
CREATE INDEX baixa_titulo_vivas_idx
  ON baixa_titulo (tenant_id, titulo_id)
  WHERE estornada_em IS NULL;
