-- Invariantes da carteira, no banco.
--
-- O schema.prisma já afirmava, em comentário, que a justificativa em
-- `AJUSTE_*` e `BONIFICACAO` era "garantida por CHECK na migração". Não era:
-- não havia CHECK nenhum. Isto fecha a diferença entre o que estava escrito e
-- o que o banco realmente exigia.
--
-- Por que no banco e não só na aplicação: a carteira é dinheiro. Uma correção
-- feita por script de manutenção, por um `psql` às três da manhã ou por uma
-- rota futura que alguém esqueceu de validar passa por cima da aplicação —
-- mas não passa por cima do banco.

-- 1. Valor sempre positivo. O sinal está em `sentido`, nunca no número.
--
-- Um valor negativo com sentido DEBITO viraria um crédito disfarçado, e a
-- soma do extrato continuaria "fechando" — o pior tipo de erro de dinheiro.
ALTER TABLE "carteira_movimento"
  ADD CONSTRAINT "carteira_movimento_valor_positivo"
  CHECK ("valor" > 0);

-- 2. O sentido tem de combinar com o tipo.
--
-- Sem isto, um `QUITACAO` gravado como DEBITO aumentaria a dívida de quem
-- acabou de pagar. É o tipo de inversão que passa em revisão de código e só
-- aparece no extrato do cliente.
ALTER TABLE "carteira_movimento"
  ADD CONSTRAINT "carteira_movimento_sentido_combina_com_tipo"
  CHECK (
    ("sentido" = 'CREDITO' AND "tipo" IN (
      'DEPOSITO', 'QUITACAO', 'DEVOLUCAO_VENDA', 'BONIFICACAO',
      'ESTORNO_DEBITO', 'AJUSTE_CREDITO'
    ))
    OR
    ("sentido" = 'DEBITO' AND "tipo" IN (
      'PAGAMENTO_VENDA', 'VENDA_A_PRAZO', 'TAXA',
      'ESTORNO_CREDITO', 'AJUSTE_DEBITO'
    ))
  );

-- 3. Justificativa obrigatória nos tipos que CRIAM dinheiro sem contrapartida.
--
-- `AJUSTE_CREDITO`, `AJUSTE_DEBITO` e `BONIFICACAO` não têm venda, depósito
-- nem quitação por trás: alguém decidiu. Sem motivo escrito, a auditoria fica
-- com um valor e nenhuma explicação. Ver docs/WALLET.md §7.
ALTER TABLE "carteira_movimento"
  ADD CONSTRAINT "carteira_movimento_justificativa_obrigatoria"
  CHECK (
    "tipo" NOT IN ('AJUSTE_CREDITO', 'AJUSTE_DEBITO', 'BONIFICACAO')
    OR ("justificativa" IS NOT NULL AND length(btrim("justificativa")) >= 5)
  );

-- 4. Limite de crédito nunca negativo.
--
-- `limite_credito` diz QUANTO o saldo pode ficar negativo, então é sempre
-- positivo ou zero. Um limite negativo tornaria `saldo + limite` menor que o
-- saldo, e o cliente com dinheiro em conta não conseguiria comprar.
ALTER TABLE "carteira"
  ADD CONSTRAINT "carteira_limite_nao_negativo"
  CHECK ("limite_credito" >= 0);
