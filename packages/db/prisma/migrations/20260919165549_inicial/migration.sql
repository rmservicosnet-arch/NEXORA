-- CreateEnum
CREATE TYPE "TipoPrincipal" AS ENUM ('FUNCIONARIO', 'CLIENTE');

-- CreateEnum
CREATE TYPE "ModoCheckout" AS ENUM ('PAGAMENTO_IMEDIATO', 'PEDIDO_COM_CONFIRMACAO');

-- CreateEnum
CREATE TYPE "MomentoCobranca" AS ENUM ('NA_CONFIRMACAO', 'NO_FATURAMENTO');

-- CreateEnum
CREATE TYPE "ModoCaixa" AS ENUM ('POR_OPERADOR', 'COMPARTILHADO_POR_LOJA');

-- CreateEnum
CREATE TYPE "StatusRegistro" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "StatusProduto" AS ENUM ('RASCUNHO', 'ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "StatusImagem" AS ENUM ('PROCESSANDO', 'PRONTA', 'FALHA');

-- CreateEnum
CREATE TYPE "SentidoMovimento" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('ENTRADA_COMPRA', 'ENTRADA_DEVOLUCAO_CLIENTE', 'ENTRADA_TRANSFERENCIA', 'ENTRADA_AJUSTE', 'ENTRADA_INVENTARIO', 'SAIDA_VENDA', 'SAIDA_DEVOLUCAO_FORNECEDOR', 'SAIDA_TRANSFERENCIA', 'SAIDA_AJUSTE', 'SAIDA_PERDA', 'SAIDA_AVARIA', 'SAIDA_CONSUMO', 'SAIDA_INVENTARIO');

-- CreateEnum
CREATE TYPE "PoliticaCusto" AS ENUM ('MEDIA_PONDERADA', 'CUSTO_REDEFINIDO', 'CUSTO_HISTORICO', 'SEM_EFEITO');

-- CreateEnum
CREATE TYPE "OrigemVenda" AS ENUM ('PDV', 'PEDIDO');

-- CreateEnum
CREATE TYPE "StatusVenda" AS ENUM ('RASCUNHO', 'CONCLUIDA', 'CANCELADA', 'DEVOLVIDA_PARCIAL', 'DEVOLVIDA_TOTAL');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'BOLETO', 'PRAZO', 'CARTEIRA');

-- CreateEnum
CREATE TYPE "SentidoCarteira" AS ENUM ('CREDITO', 'DEBITO');

-- CreateEnum
CREATE TYPE "TipoMovimentoCarteira" AS ENUM ('DEPOSITO', 'QUITACAO', 'DEVOLUCAO_VENDA', 'BONIFICACAO', 'ESTORNO_DEBITO', 'AJUSTE_CREDITO', 'PAGAMENTO_VENDA', 'VENDA_A_PRAZO', 'TAXA', 'ESTORNO_CREDITO', 'AJUSTE_DEBITO');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('RASCUNHO', 'AGUARDANDO_CONFIRMACAO', 'AGUARDANDO_ACEITE_CLIENTE', 'CONFIRMADO', 'CONFIRMADO_PARCIALMENTE', 'DEVOLVIDO', 'RECUSADO', 'FATURADO', 'CONCLUIDO', 'CANCELADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "StatusPedidoItem" AS ENUM ('PENDENTE', 'CONFIRMADO', 'DEVOLVIDO', 'REMOVIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "OrigemPedidoItem" AS ENUM ('SOLICITADO_CLIENTE', 'ADICIONADO_EQUIPE');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('ATIVA', 'CONSUMIDA', 'LIBERADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "AtorTipo" AS ENUM ('FUNCIONARIO', 'CLIENTE', 'SISTEMA');

-- CreateEnum
CREATE TYPE "Plataforma" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "AppDestino" AS ENUM ('EQUIPE', 'CLIENTE');

-- CreateEnum
CREATE TYPE "EventoNotificacao" AS ENUM ('PEDIDO_RECEBIDO', 'PEDIDO_AGUARDANDO_HA_MUITO', 'PEDIDO_ALTERADO_PELA_EQUIPE', 'PEDIDO_AGUARDANDO_ACEITE', 'PEDIDO_ACEITO_PELO_CLIENTE', 'PEDIDO_CONFIRMADO', 'PEDIDO_CONFIRMADO_PARCIAL', 'PEDIDO_DEVOLVIDO', 'PEDIDO_RECUSADO', 'RESERVA_EXPIRANDO', 'SALDO_NEGATIVO_CRIADO');

-- CreateEnum
CREATE TYPE "StatusNotificacao" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "nome" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "documento" VARCHAR(20),
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_configuracao" (
    "tenant_id" UUID NOT NULL,
    "permitir_saldo_negativo" BOOLEAN NOT NULL DEFAULT true,
    "modo_checkout" "ModoCheckout" NOT NULL DEFAULT 'PEDIDO_COM_CONFIRMACAO',
    "momento_cobranca" "MomentoCobranca" NOT NULL DEFAULT 'NO_FATURAMENTO',
    "validade_pedido_horas" INTEGER NOT NULL DEFAULT 72,
    "prazo_reserva_horas" INTEGER NOT NULL DEFAULT 168,
    "exigir_aceite_aumento" BOOLEAN NOT NULL DEFAULT true,
    "modo_caixa" "ModoCaixa" NOT NULL DEFAULT 'POR_OPERADOR',
    "push_detalhado" BOOLEAN NOT NULL DEFAULT false,
    "fuso_horario" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "moeda" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_configuracao_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "loja" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_estoque" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "padrao_venda" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "local_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "plataforma_admin" BOOLEAN NOT NULL DEFAULT false,
    "ultimo_login_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_acesso" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "ultimo_login_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cliente_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao_refresh" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "principal_tipo" "TipoPrincipal" NOT NULL,
    "usuario_id" UUID,
    "cliente_acesso_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "familia_id" UUID NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogado_em" TIMESTAMPTZ(3),
    "motivo_revogacao" VARCHAR(60),
    "user_agent" VARCHAR(255),
    "ip" VARCHAR(64),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessao_refresh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissao" (
    "chave" VARCHAR(60) NOT NULL,
    "grupo" VARCHAR(40) NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,

    CONSTRAINT "permissao_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "perfil" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "chave" VARCHAR(40) NOT NULL,
    "descricao" VARCHAR(200),
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfil_permissao" (
    "perfil_id" UUID NOT NULL,
    "permissao_chave" VARCHAR(60) NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "perfil_permissao_pkey" PRIMARY KEY ("perfil_id","permissao_chave")
);

-- CreateTable
CREATE TABLE "usuario_perfil" (
    "usuario_id" UUID NOT NULL,
    "perfil_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "usuario_perfil_pkey" PRIMARY KEY ("usuario_id","perfil_id")
);

-- CreateTable
CREATE TABLE "usuario_loja_acesso" (
    "usuario_id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "usuario_loja_acesso_pkey" PRIMARY KEY ("usuario_id","loja_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "ator_tipo" "AtorTipo" NOT NULL,
    "ator_id" UUID,
    "ator_nome" VARCHAR(160),
    "acao" VARCHAR(80) NOT NULL,
    "entidade" VARCHAR(60) NOT NULL,
    "entidade_id" UUID,
    "antes" JSONB,
    "depois" JSONB,
    "motivo" VARCHAR(400),
    "correlacao_id" UUID,
    "ip" VARCHAR(64),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chave_idempotencia" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "chave" VARCHAR(120) NOT NULL,
    "rota" VARCHAR(120) NOT NULL,
    "corpo_hash" VARCHAR(64) NOT NULL,
    "resposta_status" INTEGER,
    "resposta" JSONB,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chave_idempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "documento" VARCHAR(20),
    "email" VARCHAR(180),
    "telefone" VARCHAR(30),
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "tabela_preco_id" UUID,
    "modo_checkout" "ModoCheckout",
    "usa_carteira" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedor" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "documento" VARCHAR(20),
    "email" VARCHAR(180),
    "telefone" VARCHAR(30),
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categoria" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "pai_id" UUID,

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marca" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,

    CONSTRAINT "marca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "sku_base" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(180) NOT NULL,
    "descricao" TEXT,
    "status" "StatusProduto" NOT NULL DEFAULT 'RASCUNHO',
    "categoria_id" UUID,
    "marca_id" UUID,
    "unidade" VARCHAR(6) NOT NULL DEFAULT 'UN',
    "publicado_no_catalogo" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variacao" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "codigo_barras" VARCHAR(60),
    "descricao" VARCHAR(160) NOT NULL,
    "atributos" JSONB NOT NULL DEFAULT '{}',
    "estoque_minimo" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_imagem" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "variacao_id" UUID,
    "chave_objeto" VARCHAR(400) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "texto_alternativo" VARCHAR(255) NOT NULL DEFAULT '',
    "largura" INTEGER,
    "altura" INTEGER,
    "bytes" BIGINT,
    "hash_conteudo" VARCHAR(64),
    "status" "StatusImagem" NOT NULL DEFAULT 'PROCESSANDO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produto_imagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tabela_preco" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "chave" VARCHAR(40) NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "vigencia_inicio" TIMESTAMPTZ(3),
    "vigencia_fim" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tabela_preco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preco_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "tabela_preco_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "preco" DECIMAL(14,2) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "preco_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preco_historico" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "preco_item_id" UUID NOT NULL,
    "preco_anterior" DECIMAL(14,2),
    "preco_novo" DECIMAL(14,2) NOT NULL,
    "alterado_por_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preco_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldo_estoque" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "local_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "custo_medio" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saldo_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimento_estoque" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "local_id" UUID NOT NULL,
    "sentido" "SentidoMovimento" NOT NULL,
    "tipo" "TipoMovimento" NOT NULL,
    "quantidade" DECIMAL(18,6) NOT NULL,
    "saldo_anterior" DECIMAL(18,6) NOT NULL,
    "saldo_posterior" DECIMAL(18,6) NOT NULL,
    "custo_unitario" DECIMAL(18,6) NOT NULL,
    "custo_medio_antes" DECIMAL(18,6) NOT NULL,
    "custo_medio_depois" DECIMAL(18,6) NOT NULL,
    "politica_custo" "PoliticaCusto" NOT NULL,
    "saldo_negativo" BOOLEAN NOT NULL DEFAULT false,
    "documento_tipo" VARCHAR(40),
    "documento_id" UUID,
    "documento_numero" VARCHAR(40),
    "estorno_de_id" UUID,
    "justificativa" VARCHAR(400),
    "ator_tipo" "AtorTipo" NOT NULL,
    "ator_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estoque_reserva" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "local_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "pedido_item_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,6) NOT NULL,
    "status" "StatusReserva" NOT NULL DEFAULT 'ATIVA',
    "expira_em" TIMESTAMPTZ(3),
    "consumida_em" TIMESTAMPTZ(3),
    "liberada_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criada_por_id" UUID,

    CONSTRAINT "estoque_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "local_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "origem" "OrigemVenda" NOT NULL DEFAULT 'PDV',
    "status" "StatusVenda" NOT NULL DEFAULT 'RASCUNHO',
    "cliente_id" UUID,
    "vendedor_id" UUID NOT NULL,
    "tabela_preco_id" UUID,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "acrescimo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "pedido_id" UUID,
    "concluida_em" TIMESTAMPTZ(3),
    "cancelada_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" VARCHAR(400),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "venda_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,6) NOT NULL,
    "preco_unitario" DECIMAL(14,2) NOT NULL,
    "desconto_item" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_item" DECIMAL(14,2) NOT NULL,
    "tabela_preco_id" UUID,
    "preco_origem" VARCHAR(20) NOT NULL DEFAULT 'TABELA',
    "custo_unitario" DECIMAL(18,6) NOT NULL,
    "quantidade_devolvida" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venda_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_pagamento" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "venda_id" UUID NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "bandeira" VARCHAR(30),
    "ultimos_quatro" VARCHAR(4),
    "autorizacao" VARCHAR(60),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venda_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "local_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'RASCUNHO',
    "cliente_id" UUID NOT NULL,
    "cliente_acesso_id" UUID,
    "tabela_preco_id" UUID,
    "valor_solicitado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valor_confirmado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "editado_pela_equipe_em" TIMESTAMPTZ(3),
    "editado_por_id" UUID,
    "resumo_alteracao" VARCHAR(400),
    "aceite_cliente_em" TIMESTAMPTZ(3),
    "aceite_cliente_por_id" UUID,
    "valido_ate" TIMESTAMPTZ(3),
    "enviado_em" TIMESTAMPTZ(3),
    "confirmado_em" TIMESTAMPTZ(3),
    "confirmado_por_id" UUID,
    "faturado_em" TIMESTAMPTZ(3),
    "encerrado_em" TIMESTAMPTZ(3),
    "motivo" VARCHAR(400),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "variacao_id" UUID NOT NULL,
    "origem" "OrigemPedidoItem" NOT NULL DEFAULT 'SOLICITADO_CLIENTE',
    "quantidade_solicitada" DECIMAL(18,6) NOT NULL,
    "quantidade_confirmada" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "preco_unitario" DECIMAL(14,2) NOT NULL,
    "total_item" DECIMAL(14,2) NOT NULL,
    "preco_congelado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusPedidoItem" NOT NULL DEFAULT 'PENDENTE',
    "motivo_devolucao" VARCHAR(200),
    "confirmado_sem_saldo" BOOLEAN NOT NULL DEFAULT false,
    "adicionado_por_id" UUID,
    "removido_por_id" UUID,
    "removido_em" TIMESTAMPTZ(3),
    "motivo_remocao" VARCHAR(200),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pedido_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_evento" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "de_status" "StatusPedido",
    "para_status" "StatusPedido" NOT NULL,
    "ator_tipo" "AtorTipo" NOT NULL,
    "ator_id" UUID,
    "ator_nome" VARCHAR(160),
    "motivo" VARCHAR(400),
    "itens_afetados" JSONB,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carteira" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "saldo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "limite_credito" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "bloqueada_para_compra" BOOLEAN NOT NULL DEFAULT false,
    "observacao" VARCHAR(400),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carteira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carteira_movimento" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "carteira_id" UUID NOT NULL,
    "sentido" "SentidoCarteira" NOT NULL,
    "tipo" "TipoMovimentoCarteira" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "saldo_anterior" DECIMAL(14,2) NOT NULL,
    "saldo_posterior" DECIMAL(14,2) NOT NULL,
    "excedeu_limite" BOOLEAN NOT NULL DEFAULT false,
    "venda_id" UUID,
    "pedido_id" UUID,
    "forma_pagamento" "FormaPagamento",
    "documento" VARCHAR(60),
    "estorno_de_id" UUID,
    "justificativa" VARCHAR(400),
    "ator_tipo" "AtorTipo" NOT NULL,
    "ator_id" UUID,
    "ator_nome" VARCHAR(160),
    "chave_idempotencia" VARCHAR(120),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carteira_movimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivo_push" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "principal_tipo" "TipoPrincipal" NOT NULL,
    "principal_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "plataforma" "Plataforma" NOT NULL,
    "app" "AppDestino" NOT NULL,
    "versao_app" VARCHAR(20),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMPTZ(3),
    "desativado_em" TIMESTAMPTZ(3),

    CONSTRAINT "dispositivo_push_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao_saida" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "evento" "EventoNotificacao" NOT NULL,
    "pedido_id" UUID,
    "destinatarios" JSONB NOT NULL,
    "carga" JSONB NOT NULL,
    "status" "StatusNotificacao" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" VARCHAR(400),
    "chave_idempotencia" VARCHAR(160) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviada_em" TIMESTAMPTZ(3),

    CONSTRAINT "notificacao_saida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao_preferencia" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "principal_tipo" "TipoPrincipal" NOT NULL,
    "principal_id" UUID NOT NULL,
    "evento" "EventoNotificacao" NOT NULL,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "silencio_inicio" VARCHAR(5),
    "silencio_fim" VARCHAR(5),

    CONSTRAINT "notificacao_preferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "loja_tenant_id_status_idx" ON "loja"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loja_tenant_id_codigo_key" ON "loja"("tenant_id", "codigo");

-- CreateIndex
CREATE INDEX "local_estoque_tenant_id_loja_id_idx" ON "local_estoque"("tenant_id", "loja_id");

-- CreateIndex
CREATE UNIQUE INDEX "local_estoque_tenant_id_loja_id_codigo_key" ON "local_estoque"("tenant_id", "loja_id", "codigo");

-- CreateIndex
CREATE INDEX "usuario_tenant_id_status_idx" ON "usuario"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_tenant_id_email_key" ON "usuario"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "cliente_acesso_tenant_id_cliente_id_idx" ON "cliente_acesso"("tenant_id", "cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_acesso_tenant_id_email_key" ON "cliente_acesso"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_refresh_token_hash_key" ON "sessao_refresh"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_refresh_tenant_id_familia_id_idx" ON "sessao_refresh"("tenant_id", "familia_id");

-- CreateIndex
CREATE INDEX "sessao_refresh_usuario_id_idx" ON "sessao_refresh"("usuario_id");

-- CreateIndex
CREATE INDEX "sessao_refresh_cliente_acesso_id_idx" ON "sessao_refresh"("cliente_acesso_id");

-- CreateIndex
CREATE INDEX "sessao_refresh_expira_em_idx" ON "sessao_refresh"("expira_em");

-- CreateIndex
CREATE INDEX "permissao_grupo_idx" ON "permissao"("grupo");

-- CreateIndex
CREATE UNIQUE INDEX "perfil_tenant_id_chave_key" ON "perfil"("tenant_id", "chave");

-- CreateIndex
CREATE INDEX "perfil_permissao_tenant_id_idx" ON "perfil_permissao"("tenant_id");

-- CreateIndex
CREATE INDEX "usuario_perfil_tenant_id_idx" ON "usuario_perfil"("tenant_id");

-- CreateIndex
CREATE INDEX "usuario_loja_acesso_tenant_id_loja_id_idx" ON "usuario_loja_acesso"("tenant_id", "loja_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_criado_em_idx" ON "audit_log"("tenant_id", "criado_em");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entidade_entidade_id_idx" ON "audit_log"("tenant_id", "entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_acao_idx" ON "audit_log"("tenant_id", "acao");

-- CreateIndex
CREATE INDEX "chave_idempotencia_criado_em_idx" ON "chave_idempotencia"("criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "chave_idempotencia_tenant_id_chave_rota_key" ON "chave_idempotencia"("tenant_id", "chave", "rota");

-- CreateIndex
CREATE INDEX "cliente_tenant_id_nome_idx" ON "cliente"("tenant_id", "nome");

-- CreateIndex
CREATE INDEX "cliente_tenant_id_status_idx" ON "cliente"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_tenant_id_documento_key" ON "cliente"("tenant_id", "documento");

-- CreateIndex
CREATE INDEX "fornecedor_tenant_id_nome_idx" ON "fornecedor"("tenant_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedor_tenant_id_documento_key" ON "fornecedor"("tenant_id", "documento");

-- CreateIndex
CREATE INDEX "categoria_tenant_id_idx" ON "categoria"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "categoria_tenant_id_nome_pai_id_key" ON "categoria"("tenant_id", "nome", "pai_id");

-- CreateIndex
CREATE UNIQUE INDEX "marca_tenant_id_nome_key" ON "marca"("tenant_id", "nome");

-- CreateIndex
CREATE INDEX "produto_tenant_id_status_idx" ON "produto"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "produto_tenant_id_categoria_id_idx" ON "produto"("tenant_id", "categoria_id");

-- CreateIndex
CREATE INDEX "produto_tenant_id_publicado_no_catalogo_idx" ON "produto"("tenant_id", "publicado_no_catalogo");

-- CreateIndex
CREATE UNIQUE INDEX "produto_tenant_id_sku_base_key" ON "produto"("tenant_id", "sku_base");

-- CreateIndex
CREATE INDEX "variacao_tenant_id_produto_id_idx" ON "variacao"("tenant_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "variacao_tenant_id_sku_key" ON "variacao"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "variacao_tenant_id_codigo_barras_key" ON "variacao"("tenant_id", "codigo_barras");

-- CreateIndex
CREATE INDEX "produto_imagem_tenant_id_produto_id_ordem_idx" ON "produto_imagem"("tenant_id", "produto_id", "ordem");

-- CreateIndex
CREATE INDEX "produto_imagem_tenant_id_variacao_id_idx" ON "produto_imagem"("tenant_id", "variacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "tabela_preco_tenant_id_chave_key" ON "tabela_preco"("tenant_id", "chave");

-- CreateIndex
CREATE INDEX "preco_item_tenant_id_variacao_id_idx" ON "preco_item"("tenant_id", "variacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "preco_item_tabela_preco_id_variacao_id_key" ON "preco_item"("tabela_preco_id", "variacao_id");

-- CreateIndex
CREATE INDEX "preco_historico_tenant_id_preco_item_id_criado_em_idx" ON "preco_historico"("tenant_id", "preco_item_id", "criado_em");

-- CreateIndex
CREATE INDEX "saldo_estoque_tenant_id_local_id_idx" ON "saldo_estoque"("tenant_id", "local_id");

-- CreateIndex
CREATE INDEX "saldo_estoque_tenant_id_variacao_id_idx" ON "saldo_estoque"("tenant_id", "variacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "saldo_estoque_variacao_id_local_id_key" ON "saldo_estoque"("variacao_id", "local_id");

-- CreateIndex
CREATE INDEX "movimento_estoque_tenant_id_variacao_id_local_id_criado_em_idx" ON "movimento_estoque"("tenant_id", "variacao_id", "local_id", "criado_em");

-- CreateIndex
CREATE INDEX "movimento_estoque_tenant_id_criado_em_idx" ON "movimento_estoque"("tenant_id", "criado_em");

-- CreateIndex
CREATE INDEX "movimento_estoque_tenant_id_documento_tipo_documento_id_idx" ON "movimento_estoque"("tenant_id", "documento_tipo", "documento_id");

-- CreateIndex
CREATE INDEX "movimento_estoque_tenant_id_saldo_negativo_idx" ON "movimento_estoque"("tenant_id", "saldo_negativo");

-- CreateIndex
CREATE UNIQUE INDEX "estoque_reserva_pedido_item_id_key" ON "estoque_reserva"("pedido_item_id");

-- CreateIndex
CREATE INDEX "estoque_reserva_tenant_id_variacao_id_local_id_status_idx" ON "estoque_reserva"("tenant_id", "variacao_id", "local_id", "status");

-- CreateIndex
CREATE INDEX "estoque_reserva_tenant_id_status_expira_em_idx" ON "estoque_reserva"("tenant_id", "status", "expira_em");

-- CreateIndex
CREATE INDEX "estoque_reserva_pedido_id_idx" ON "estoque_reserva"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "venda_pedido_id_key" ON "venda"("pedido_id");

-- CreateIndex
CREATE INDEX "venda_tenant_id_loja_id_status_idx" ON "venda"("tenant_id", "loja_id", "status");

-- CreateIndex
CREATE INDEX "venda_tenant_id_concluida_em_idx" ON "venda"("tenant_id", "concluida_em");

-- CreateIndex
CREATE INDEX "venda_tenant_id_vendedor_id_idx" ON "venda"("tenant_id", "vendedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "venda_tenant_id_numero_key" ON "venda"("tenant_id", "numero");

-- CreateIndex
CREATE INDEX "venda_item_tenant_id_venda_id_idx" ON "venda_item"("tenant_id", "venda_id");

-- CreateIndex
CREATE INDEX "venda_item_tenant_id_variacao_id_idx" ON "venda_item"("tenant_id", "variacao_id");

-- CreateIndex
CREATE INDEX "venda_pagamento_tenant_id_venda_id_idx" ON "venda_pagamento"("tenant_id", "venda_id");

-- CreateIndex
CREATE INDEX "pedido_tenant_id_status_enviado_em_idx" ON "pedido"("tenant_id", "status", "enviado_em");

-- CreateIndex
CREATE INDEX "pedido_tenant_id_loja_id_status_idx" ON "pedido"("tenant_id", "loja_id", "status");

-- CreateIndex
CREATE INDEX "pedido_tenant_id_cliente_id_idx" ON "pedido"("tenant_id", "cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_tenant_id_numero_key" ON "pedido"("tenant_id", "numero");

-- CreateIndex
CREATE INDEX "pedido_item_tenant_id_pedido_id_idx" ON "pedido_item"("tenant_id", "pedido_id");

-- CreateIndex
CREATE INDEX "pedido_item_tenant_id_variacao_id_idx" ON "pedido_item"("tenant_id", "variacao_id");

-- CreateIndex
CREATE INDEX "pedido_evento_tenant_id_pedido_id_criado_em_idx" ON "pedido_evento"("tenant_id", "pedido_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "carteira_cliente_id_key" ON "carteira"("cliente_id");

-- CreateIndex
CREATE INDEX "carteira_tenant_id_status_idx" ON "carteira"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "carteira_movimento_tenant_id_carteira_id_criado_em_idx" ON "carteira_movimento"("tenant_id", "carteira_id", "criado_em");

-- CreateIndex
CREATE INDEX "carteira_movimento_tenant_id_tipo_idx" ON "carteira_movimento"("tenant_id", "tipo");

-- CreateIndex
CREATE INDEX "carteira_movimento_tenant_id_venda_id_idx" ON "carteira_movimento"("tenant_id", "venda_id");

-- CreateIndex
CREATE INDEX "carteira_movimento_tenant_id_excedeu_limite_idx" ON "carteira_movimento"("tenant_id", "excedeu_limite");

-- CreateIndex
CREATE UNIQUE INDEX "carteira_movimento_tenant_id_chave_idempotencia_key" ON "carteira_movimento"("tenant_id", "chave_idempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivo_push_token_key" ON "dispositivo_push"("token");

-- CreateIndex
CREATE INDEX "dispositivo_push_tenant_id_principal_tipo_principal_id_ativ_idx" ON "dispositivo_push"("tenant_id", "principal_tipo", "principal_id", "ativo");

-- CreateIndex
CREATE INDEX "dispositivo_push_tenant_id_app_ativo_idx" ON "dispositivo_push"("tenant_id", "app", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "notificacao_saida_chave_idempotencia_key" ON "notificacao_saida"("chave_idempotencia");

-- CreateIndex
CREATE INDEX "notificacao_saida_status_criado_em_idx" ON "notificacao_saida"("status", "criado_em");

-- CreateIndex
CREATE INDEX "notificacao_saida_tenant_id_evento_idx" ON "notificacao_saida"("tenant_id", "evento");

-- CreateIndex
CREATE INDEX "notificacao_preferencia_tenant_id_idx" ON "notificacao_preferencia"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "notificacao_preferencia_principal_tipo_principal_id_evento_key" ON "notificacao_preferencia"("principal_tipo", "principal_id", "evento");

-- AddForeignKey
ALTER TABLE "tenant_configuracao" ADD CONSTRAINT "tenant_configuracao_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loja" ADD CONSTRAINT "loja_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_estoque" ADD CONSTRAINT "local_estoque_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_acesso" ADD CONSTRAINT "cliente_acesso_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_refresh" ADD CONSTRAINT "sessao_refresh_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_refresh" ADD CONSTRAINT "sessao_refresh_cliente_acesso_id_fkey" FOREIGN KEY ("cliente_acesso_id") REFERENCES "cliente_acesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil" ADD CONSTRAINT "perfil_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_permissao_chave_fkey" FOREIGN KEY ("permissao_chave") REFERENCES "permissao"("chave") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_perfil" ADD CONSTRAINT "usuario_perfil_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_perfil" ADD CONSTRAINT "usuario_perfil_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_loja_acesso" ADD CONSTRAINT "usuario_loja_acesso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_loja_acesso" ADD CONSTRAINT "usuario_loja_acesso_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_tabela_preco_id_fkey" FOREIGN KEY ("tabela_preco_id") REFERENCES "tabela_preco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marca" ADD CONSTRAINT "marca_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "marca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao" ADD CONSTRAINT "variacao_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_imagem" ADD CONSTRAINT "produto_imagem_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_imagem" ADD CONSTRAINT "produto_imagem_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabela_preco" ADD CONSTRAINT "tabela_preco_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco_item" ADD CONSTRAINT "preco_item_tabela_preco_id_fkey" FOREIGN KEY ("tabela_preco_id") REFERENCES "tabela_preco"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco_item" ADD CONSTRAINT "preco_item_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco_historico" ADD CONSTRAINT "preco_historico_preco_item_id_fkey" FOREIGN KEY ("preco_item_id") REFERENCES "preco_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_estorno_de_id_fkey" FOREIGN KEY ("estorno_de_id") REFERENCES "movimento_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque_reserva" ADD CONSTRAINT "estoque_reserva_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque_reserva" ADD CONSTRAINT "estoque_reserva_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque_reserva" ADD CONSTRAINT "estoque_reserva_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque_reserva" ADD CONSTRAINT "estoque_reserva_pedido_item_id_fkey" FOREIGN KEY ("pedido_item_id") REFERENCES "pedido_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_tabela_preco_id_fkey" FOREIGN KEY ("tabela_preco_id") REFERENCES "tabela_preco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_item" ADD CONSTRAINT "venda_item_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_item" ADD CONSTRAINT "venda_item_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_pagamento" ADD CONSTRAINT "venda_pagamento_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cliente_acesso_id_fkey" FOREIGN KEY ("cliente_acesso_id") REFERENCES "cliente_acesso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_tabela_preco_id_fkey" FOREIGN KEY ("tabela_preco_id") REFERENCES "tabela_preco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_evento" ADD CONSTRAINT "pedido_evento_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira" ADD CONSTRAINT "carteira_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira_movimento" ADD CONSTRAINT "carteira_movimento_carteira_id_fkey" FOREIGN KEY ("carteira_id") REFERENCES "carteira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira_movimento" ADD CONSTRAINT "carteira_movimento_estorno_de_id_fkey" FOREIGN KEY ("estorno_de_id") REFERENCES "carteira_movimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
