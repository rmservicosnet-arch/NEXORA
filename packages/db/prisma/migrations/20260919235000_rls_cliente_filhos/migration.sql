-- Escopo de cliente nas tabelas FILHAS.
--
-- A migracao `rls_politicas` aplicou `isolamento_cliente` apenas onde havia
-- uma coluna `cliente_id`. `pedido_item`, `pedido_evento` e
-- `carteira_movimento` nao tem essa coluna — o vinculo com o cliente passa
-- pelo pai. Resultado: no portal, com `app.cliente_id` preenchido, o pedido do
-- outro cliente era invisivel, mas os ITENS dele nao.
--
-- A aplicacao filtra corretamente. O ponto do RLS e justamente ser a camada
-- que continua valendo quando a aplicacao esquece. Ver docs/TENANCY.md §2 e
-- docs/ORDERS.md §7.
--
-- RESTRICTIVE, como a do pai: politicas restritivas se somam com AND, e o
-- escopo de cliente precisa valer JUNTO com o de empresa, nao no lugar dele.
--
-- A subconsulta le `pedido`, que tambem tem RLS. Para o pedido de outro
-- cliente a linha nem aparece, o EXISTS da falso e a filha fica bloqueada —
-- a protecao se compoe sozinha.

CREATE POLICY isolamento_cliente ON public.pedido_item AS RESTRICTIVE
  USING (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pedido p
       WHERE p.id = pedido_item.pedido_id
         AND p.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  )
  WITH CHECK (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pedido p
       WHERE p.id = pedido_item.pedido_id
         AND p.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  );

CREATE POLICY isolamento_cliente ON public.pedido_evento AS RESTRICTIVE
  USING (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pedido p
       WHERE p.id = pedido_evento.pedido_id
         AND p.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  )
  WITH CHECK (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.pedido p
       WHERE p.id = pedido_evento.pedido_id
         AND p.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  );

CREATE POLICY isolamento_cliente ON public.carteira_movimento AS RESTRICTIVE
  USING (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.carteira c
       WHERE c.id = carteira_movimento.carteira_id
         AND c.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  )
  WITH CHECK (
    nullif(current_setting('app.cliente_id', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM public.carteira c
       WHERE c.id = carteira_movimento.carteira_id
         AND c.cliente_id = nullif(current_setting('app.cliente_id', true), '')::uuid
    )
  );

-- `estoque_reserva` tambem aponta para pedido, e o cliente NAO deve ve-la:
-- reserva revela quantidade, e docs/ORDERS.md §7 diz que o cliente ve apenas
-- disponivel/indisponivel. Aqui o escopo e mais duro: no portal, nenhuma.
CREATE POLICY isolamento_cliente ON public.estoque_reserva AS RESTRICTIVE
  USING (nullif(current_setting('app.cliente_id', true), '') IS NULL)
  WITH CHECK (nullif(current_setting('app.cliente_id', true), '') IS NULL);

-- Conferencia: toda tabela com vinculo a cliente precisa da politica.
DO $conferencia$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(t.tabela, ', ')
    INTO faltando
    FROM (VALUES ('pedido'), ('pedido_item'), ('pedido_evento'),
                 ('carteira'), ('carteira_movimento'), ('estoque_reserva')) AS t(tabela)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = t.tabela
        AND p.policyname = 'isolamento_cliente'
   );

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Sem politica de escopo de cliente: %', faltando;
  END IF;
END
$conferencia$;
