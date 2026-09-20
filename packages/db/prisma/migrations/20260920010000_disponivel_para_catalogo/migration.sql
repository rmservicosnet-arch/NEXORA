-- Disponibilidade que o PORTAL consegue calcular.
--
-- O problema: `estoque_reserva` tem politica RESTRICTIVE que devolve ZERO
-- linhas sempre que `app.cliente_id` esta definido — ou seja, em todo o
-- portal. A decisao e correta (reserva revela quantidade, e o cliente so ve
-- disponivel/indisponivel, docs/ORDERS.md §7). O efeito colateral nao era:
-- sob o contexto do cliente, `saldo - reservas` virava `saldo - 0`, e o
-- catalogo anunciava "pronta entrega" para item inteiramente reservado por
-- pedidos ja confirmados de outros clientes.
--
-- A conferencia da EQUIPE nunca foi afetada: ela roda como funcionario, onde
-- as reservas aparecem. Nunca houve compromisso de estoque a descoberto — o
-- defeito era informar mal o comprador.
--
-- A saida nao e abrir a tabela para o cliente. E uma funcao que devolve
-- apenas um NUMERO: ele nao enumera reservas, nao descobre de quem sao, nem
-- quantas existem. Recebe a mesma resposta que a equipe receberia.
CREATE OR REPLACE FUNCTION public.disponivel_no_local(p_variacao uuid, p_local uuid)
RETURNS numeric
LANGUAGE sql
STABLE
-- SECURITY DEFINER ignora o RLS. Por isso o filtro de tenant e feito AQUI,
-- a mao, em cada subconsulta: sem ele esta funcao seria exatamente o vazamento
-- entre empresas que o RLS existe para impedir. `app.tenant_id` vem do token
-- validado, posto pelo guard — nunca do corpo da requisicao.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce((
      SELECT s.quantidade
        FROM saldo_estoque s
       WHERE s.variacao_id = p_variacao
         AND s.local_id = p_local
         AND s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    ), 0)
    -
    coalesce((
      SELECT sum(r.quantidade)
        FROM estoque_reserva r
       WHERE r.variacao_id = p_variacao
         AND r.local_id = p_local
         AND r.status = 'ATIVA'
         -- Reserva vencida nao segura estoque. O prazo esta gravado desde o
         -- inicio e ninguem o lia.
         AND r.expira_em > now()
         AND r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    ), 0);
$$;

-- Sem tenant no contexto a funcao nao serve a ninguem: `NULL::uuid` nao casa
-- com nada, e o resultado e zero. E o mesmo comportamento do RLS.
COMMENT ON FUNCTION public.disponivel_no_local(uuid, uuid) IS
  'Saldo menos reservas ativas nao vencidas, no tenant do contexto. SECURITY DEFINER: filtra tenant internamente.';

REVOKE ALL ON FUNCTION public.disponivel_no_local(uuid, uuid) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.disponivel_no_local(uuid, uuid) TO estoque_app';
  END IF;
END
$grant$;
