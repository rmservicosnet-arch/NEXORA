/**
 * Catálogo de permissões do sistema.
 *
 * É vocabulário global, não dado de empresa: a tabela `permissao` não tem
 * `tenant_id`. Cada empresa monta seus perfis escolhendo destas chaves.
 *
 * Uma permissão só entra aqui quando existe código que a verifica. Lista de
 * permissões que ninguém checa dá falsa sensação de controle.
 */

export interface DefinicaoPermissao {
  readonly chave: string;
  readonly grupo: string;
  readonly descricao: string;
}

export const PERMISSOES: readonly DefinicaoPermissao[] = [
  // --- Produtos e preços ---------------------------------------------------
  { chave: 'produto.visualizar', grupo: 'produto', descricao: 'Ver produtos e variações' },
  { chave: 'produto.criar', grupo: 'produto', descricao: 'Cadastrar produtos' },
  { chave: 'produto.editar', grupo: 'produto', descricao: 'Alterar produtos' },
  { chave: 'produto.inativar', grupo: 'produto', descricao: 'Inativar produtos' },
  { chave: 'produto.ver_custo', grupo: 'produto', descricao: 'Ver custo e custo médio' },
  { chave: 'produto.gerenciar_fotos', grupo: 'produto', descricao: 'Enviar e remover fotos' },
  { chave: 'produto.publicar_catalogo', grupo: 'produto', descricao: 'Publicar no catálogo' },
  { chave: 'preco.visualizar', grupo: 'preco', descricao: 'Ver tabelas de preço' },
  { chave: 'preco.editar', grupo: 'preco', descricao: 'Alterar preços' },
  { chave: 'preco.aplicar_desconto', grupo: 'preco', descricao: 'Conceder desconto na venda' },

  // --- Estoque -------------------------------------------------------------
  { chave: 'estoque.visualizar', grupo: 'estoque', descricao: 'Ver saldos e movimentações' },
  { chave: 'estoque.entrada_manual', grupo: 'estoque', descricao: 'Lançar entrada manual' },
  { chave: 'estoque.ajustar', grupo: 'estoque', descricao: 'Ajustar saldo com justificativa' },
  { chave: 'estoque.transferir', grupo: 'estoque', descricao: 'Transferir entre locais' },
  { chave: 'estoque.inventariar', grupo: 'estoque', descricao: 'Abrir e contar inventário' },
  { chave: 'estoque.aprovar_inventario', grupo: 'estoque', descricao: 'Aprovar inventário' },
  {
    chave: 'estoque.vender_sem_saldo',
    grupo: 'estoque',
    descricao: 'Concluir venda com saldo negativo',
  },
  { chave: 'estoque.regularizar', grupo: 'estoque', descricao: 'Regularizar saldo negativo' },

  // --- Vendas --------------------------------------------------------------
  { chave: 'venda.criar', grupo: 'venda', descricao: 'Operar o PDV e concluir vendas' },
  { chave: 'venda.cancelar', grupo: 'venda', descricao: 'Cancelar venda' },
  { chave: 'venda.estornar', grupo: 'venda', descricao: 'Estornar venda concluída' },
  { chave: 'venda.devolver', grupo: 'venda', descricao: 'Registrar devolução' },
  { chave: 'venda.ver_todas', grupo: 'venda', descricao: 'Ver vendas de outros vendedores' },

  // --- Pedidos -------------------------------------------------------------
  { chave: 'pedido.visualizar_fila', grupo: 'pedido', descricao: 'Ver a fila de pedidos' },
  { chave: 'pedido.editar_itens', grupo: 'pedido', descricao: 'Incluir e remover itens' },
  { chave: 'pedido.confirmar', grupo: 'pedido', descricao: 'Confirmar pedido' },
  { chave: 'pedido.confirmar_parcial', grupo: 'pedido', descricao: 'Confirmar em parte' },
  {
    chave: 'pedido.confirmar_sem_saldo',
    grupo: 'pedido',
    descricao: 'Confirmar item sem disponibilidade',
  },
  { chave: 'pedido.devolver', grupo: 'pedido', descricao: 'Devolver pedido ao cliente' },
  { chave: 'pedido.recusar', grupo: 'pedido', descricao: 'Recusar pedido' },
  { chave: 'pedido.faturar', grupo: 'pedido', descricao: 'Faturar pedido confirmado' },
  {
    chave: 'pedido.cancelar_confirmado',
    grupo: 'pedido',
    descricao: 'Cancelar pedido já confirmado',
  },

  // --- Carteira ------------------------------------------------------------
  { chave: 'carteira.visualizar', grupo: 'carteira', descricao: 'Ver saldo e extrato' },
  { chave: 'carteira.lancar_quitacao', grupo: 'carteira', descricao: 'Lançar quitação' },
  { chave: 'carteira.lancar_deposito', grupo: 'carteira', descricao: 'Lançar depósito' },
  {
    chave: 'carteira.ajustar',
    grupo: 'carteira',
    descricao: 'Ajuste manual — cria dinheiro, exige justificativa',
  },
  { chave: 'carteira.definir_limite', grupo: 'carteira', descricao: 'Definir limite de crédito' },
  { chave: 'carteira.exceder_limite', grupo: 'carteira', descricao: 'Autorizar débito acima do limite' },
  { chave: 'carteira.estornar', grupo: 'carteira', descricao: 'Estornar movimento' },

  // --- Financeiro, caixa e comissão ---------------------------------------
  { chave: 'financeiro.visualizar', grupo: 'financeiro', descricao: 'Ver contas a pagar e receber' },
  { chave: 'financeiro.baixar', grupo: 'financeiro', descricao: 'Baixar título' },
  { chave: 'financeiro.estornar', grupo: 'financeiro', descricao: 'Estornar baixa' },
  { chave: 'caixa.abrir', grupo: 'caixa', descricao: 'Abrir caixa' },
  { chave: 'caixa.fechar', grupo: 'caixa', descricao: 'Fechar caixa' },
  { chave: 'caixa.sangria', grupo: 'caixa', descricao: 'Registrar sangria' },
  { chave: 'caixa.suprimento', grupo: 'caixa', descricao: 'Registrar suprimento' },
  { chave: 'caixa.conferir', grupo: 'caixa', descricao: 'Conferir fechamento de outros' },
  { chave: 'comissao.visualizar', grupo: 'comissao', descricao: 'Ver comissões' },
  { chave: 'comissao.aprovar', grupo: 'comissao', descricao: 'Aprovar apuração' },
  { chave: 'comissao.pagar', grupo: 'comissao', descricao: 'Marcar comissão como paga' },

  // --- Compras e cadastros -------------------------------------------------
  { chave: 'compra.visualizar', grupo: 'compra', descricao: 'Ver pedidos de compra' },
  { chave: 'compra.criar', grupo: 'compra', descricao: 'Criar pedido de compra' },
  { chave: 'compra.receber', grupo: 'compra', descricao: 'Receber mercadoria' },
  { chave: 'compra.cancelar', grupo: 'compra', descricao: 'Cancelar pedido de compra' },
  { chave: 'cliente.visualizar', grupo: 'cliente', descricao: 'Ver clientes' },
  { chave: 'cliente.criar', grupo: 'cliente', descricao: 'Cadastrar clientes' },
  { chave: 'cliente.editar', grupo: 'cliente', descricao: 'Alterar clientes' },
  { chave: 'cliente.inativar', grupo: 'cliente', descricao: 'Inativar clientes' },
  {
    chave: 'cliente.gerenciar_acesso',
    grupo: 'cliente',
    descricao: 'Criar e revogar o login do cliente no portal',
  },

  // --- Relatórios ----------------------------------------------------------
  { chave: 'relatorio.visualizar', grupo: 'relatorio', descricao: 'Acessar relatórios' },
  {
    chave: 'relatorio.ver_custo',
    grupo: 'relatorio',
    descricao: 'Ver custo, margem e valor de estoque',
  },
  { chave: 'relatorio.ver_todas_lojas', grupo: 'relatorio', descricao: 'Ver todas as lojas' },
  {
    chave: 'relatorio.ver_todos_vendedores',
    grupo: 'relatorio',
    descricao: 'Ver números de outros vendedores',
  },
  { chave: 'relatorio.exportar', grupo: 'relatorio', descricao: 'Exportar CSV e XLSX' },

  // --- Administração -------------------------------------------------------
  { chave: 'usuario.visualizar', grupo: 'usuario', descricao: 'Ver usuários' },
  { chave: 'usuario.criar', grupo: 'usuario', descricao: 'Criar usuários' },
  { chave: 'usuario.editar', grupo: 'usuario', descricao: 'Alterar usuários' },
  { chave: 'usuario.inativar', grupo: 'usuario', descricao: 'Inativar usuários' },
  { chave: 'usuario.definir_perfil', grupo: 'usuario', descricao: 'Atribuir perfis' },
  { chave: 'configuracao.visualizar', grupo: 'configuracao', descricao: 'Ver configurações' },
  { chave: 'configuracao.editar', grupo: 'configuracao', descricao: 'Alterar configurações' },
  { chave: 'auditoria.visualizar', grupo: 'auditoria', descricao: 'Ver a trilha de auditoria' },
  { chave: 'integracao.visualizar', grupo: 'integracao', descricao: 'Ver integrações' },
  { chave: 'integracao.configurar', grupo: 'integracao', descricao: 'Configurar integrações' },

  // --- Portal do cliente ---------------------------------------------------
  { chave: 'portal.acessar', grupo: 'portal', descricao: 'Acessar o portal do cliente' },
];

export const CHAVES_PERMISSAO = PERMISSOES.map((p) => p.chave);

function apenas(...prefixos: string[]): string[] {
  return CHAVES_PERMISSAO.filter((c) => prefixos.some((p) => c === p || c.startsWith(`${p}.`)));
}

function visualizacoes(): string[] {
  return CHAVES_PERMISSAO.filter((c) => c.endsWith('.visualizar'));
}

export interface DefinicaoPerfil {
  readonly chave: string;
  readonly nome: string;
  readonly descricao: string;
  readonly permissoes: readonly string[];
}

/**
 * Perfis de sistema.
 *
 * `ADMIN_EMPRESA` recebe tudo, menos `portal.acessar` — que pertence ao
 * domínio do cliente, não ao do funcionário. Misturar os dois seria abrir a
 * porta que o ADR-009 fechou.
 */
export const PERFIS: readonly DefinicaoPerfil[] = [
  {
    chave: 'ADMIN_EMPRESA',
    nome: 'Administrador da empresa',
    descricao: 'Acesso total, exceto o portal do cliente',
    permissoes: CHAVES_PERMISSAO.filter((c) => c !== 'portal.acessar'),
  },
  {
    chave: 'GESTOR',
    nome: 'Gestor',
    descricao: 'Opera e decide, sem administrar usuários e integrações',
    permissoes: CHAVES_PERMISSAO.filter(
      (c) =>
        c !== 'portal.acessar' &&
        !c.startsWith('usuario.') &&
        c !== 'integracao.configurar' &&
        c !== 'configuracao.editar',
    ),
  },
  {
    chave: 'VENDEDOR',
    nome: 'Vendedor',
    descricao: 'PDV, pedidos e clientes. Não vê custo nem margem',
    permissoes: [
      'produto.visualizar',
      'preco.visualizar',
      'preco.aplicar_desconto',
      'estoque.visualizar',
      'venda.criar',
      'venda.devolver',
      // Lista explícita, e não `apenas('cliente')`.
      //
      // O curinga concede TODA permissão futura do grupo. Foi assim que o
      // perfil FINANCEIRO ganhou `ajustar` sem ninguém decidir (ver abaixo), e
      // seria assim que quem atende no balcão passaria a emitir login de
      // portal só porque a permissão nasceu no grupo certo.
      'cliente.visualizar',
      'cliente.criar',
      'cliente.editar',
      'cliente.inativar',
      'pedido.visualizar_fila',
      'pedido.editar_itens',
      'pedido.confirmar',
      'pedido.confirmar_parcial',
      'pedido.devolver',
      'carteira.visualizar',
      'caixa.abrir',
      'caixa.fechar',
      'caixa.sangria',
      'caixa.suprimento',
      'comissao.visualizar',
      'relatorio.visualizar',
    ],
  },
  {
    chave: 'ESTOQUISTA',
    nome: 'Estoquista',
    descricao: 'Movimenta estoque e recebe compras',
    permissoes: [
      'produto.visualizar',
      'produto.ver_custo',
      ...apenas('estoque'),
      'compra.visualizar',
      'compra.receber',
      'pedido.visualizar_fila',
      'relatorio.visualizar',
      'relatorio.ver_custo',
    ],
  },
  {
    chave: 'FINANCEIRO',
    nome: 'Financeiro',
    descricao: 'Contas, carteira, caixa e comissões',
    permissoes: [
      'produto.visualizar',
      'produto.ver_custo',
      'cliente.visualizar',
      'venda.ver_todas',
      'pedido.visualizar_fila',
      'pedido.faturar',
      ...apenas('financeiro', 'comissao'),

      // Carteira: o Financeiro RECEBE e CONCILIA; não corrige.
      //
      // `apenas('carteira')` dava a ele `ajustar`, `bonificacao` por tabela,
      // `exceder_limite` e `estornar` — ou seja, criar dinheiro sem
      // contrapartida e apagar o efeito de um lançamento. Quem concilia a
      // conta não pode também ajustá-la em silêncio: é a separação de funções
      // que torna a conciliação uma conferência de verdade.
      //
      // docs/WALLET.md §9 sempre disse que esses quatro eram do Gestor. O
      // seed é que discordava.
      'carteira.visualizar',
      'carteira.lancar_quitacao',
      'carteira.lancar_deposito',

      'caixa.conferir',
      'compra.visualizar',
      'relatorio.visualizar',
      'relatorio.ver_custo',
      'relatorio.ver_todas_lojas',
      'relatorio.ver_todos_vendedores',
      'relatorio.exportar',
    ],
  },
  {
    chave: 'AUDITOR',
    nome: 'Auditor',
    descricao: 'Apenas leitura, em tudo',
    permissoes: [
      ...visualizacoes().filter((c) => c !== 'portal.acessar'),
      'produto.ver_custo',
      'venda.ver_todas',
      'pedido.visualizar_fila',
      'relatorio.ver_custo',
      'relatorio.ver_todas_lojas',
      'relatorio.ver_todos_vendedores',
      'relatorio.exportar',
    ],
  },
  {
    chave: 'CONSULTA',
    nome: 'Consulta',
    descricao: 'Leitura do essencial, sem custo',
    permissoes: ['produto.visualizar', 'preco.visualizar', 'estoque.visualizar', 'relatorio.visualizar'],
  },
  {
    chave: 'CLIENTE_PORTAL',
    nome: 'Cliente (portal)',
    descricao: 'Perfil do cliente externo. Nunca atribuído a funcionário',
    permissoes: ['portal.acessar'],
  },
];
