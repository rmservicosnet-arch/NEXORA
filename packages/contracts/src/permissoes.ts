/**
 * Chaves de permissão conhecidas pelo cliente.
 *
 * A lista canônica vive no banco (`packages/db/prisma/permissoes.ts`). Esta
 * existe para o front conseguir escrever `PERM.estoque.visualizar` e errar no
 * `tsc` em vez de em produção — uma string digitada errada num
 * `PermissionGuard` falha aberta, escondendo um botão que deveria aparecer,
 * ou pior, mostrando um que não deveria.
 *
 * **Esconder botão é cortesia de UX, não segurança.** Toda ação é revalidada
 * no servidor. Ver DESIGN_SYSTEM.md §8.
 */

export const PERM = {
  produto: {
    visualizar: 'produto.visualizar',
    criar: 'produto.criar',
    editar: 'produto.editar',
    inativar: 'produto.inativar',
    verCusto: 'produto.ver_custo',
    gerenciarFotos: 'produto.gerenciar_fotos',
    publicarCatalogo: 'produto.publicar_catalogo',
  },
  preco: {
    visualizar: 'preco.visualizar',
    editar: 'preco.editar',
    aplicarDesconto: 'preco.aplicar_desconto',
  },
  estoque: {
    visualizar: 'estoque.visualizar',
    entradaManual: 'estoque.entrada_manual',
    ajustar: 'estoque.ajustar',
    transferir: 'estoque.transferir',
    inventariar: 'estoque.inventariar',
    venderSemSaldo: 'estoque.vender_sem_saldo',
    regularizar: 'estoque.regularizar',
  },
  venda: {
    criar: 'venda.criar',
    cancelar: 'venda.cancelar',
    estornar: 'venda.estornar',
    devolver: 'venda.devolver',
    verTodas: 'venda.ver_todas',
  },
  pedido: {
    visualizarFila: 'pedido.visualizar_fila',
    editarItens: 'pedido.editar_itens',
    confirmar: 'pedido.confirmar',
    confirmarParcial: 'pedido.confirmar_parcial',
    confirmarSemSaldo: 'pedido.confirmar_sem_saldo',
    devolver: 'pedido.devolver',
    recusar: 'pedido.recusar',
    faturar: 'pedido.faturar',
    cancelarConfirmado: 'pedido.cancelar_confirmado',
  },
  carteira: {
    visualizar: 'carteira.visualizar',
    lancarQuitacao: 'carteira.lancar_quitacao',
    lancarDeposito: 'carteira.lancar_deposito',
    ajustar: 'carteira.ajustar',
    definirLimite: 'carteira.definir_limite',
    excederLimite: 'carteira.exceder_limite',
    estornar: 'carteira.estornar',
  },
  financeiro: {
    visualizar: 'financeiro.visualizar',
    baixar: 'financeiro.baixar',
  },
  caixa: {
    abrir: 'caixa.abrir',
    fechar: 'caixa.fechar',
    sangria: 'caixa.sangria',
    suprimento: 'caixa.suprimento',
    conferir: 'caixa.conferir',
  },
  cliente: {
    visualizar: 'cliente.visualizar',
    criar: 'cliente.criar',
    editar: 'cliente.editar',
    /**
     * Emitir e revogar o login do cliente no portal.
     *
     * Separada de `editar` de proposito: corrigir um telefone e criar uma
     * credencial de acesso nao sao o mesmo grau de autoridade.
     */
    gerenciarAcesso: 'cliente.gerenciar_acesso',
  },
  compra: {
    visualizar: 'compra.visualizar',
    receber: 'compra.receber',
  },
  relatorio: {
    visualizar: 'relatorio.visualizar',
    verCusto: 'relatorio.ver_custo',
    verTodasLojas: 'relatorio.ver_todas_lojas',
    verTodosVendedores: 'relatorio.ver_todos_vendedores',
    exportar: 'relatorio.exportar',
  },
  usuario: {
    visualizar: 'usuario.visualizar',
    criar: 'usuario.criar',
    editar: 'usuario.editar',
  },
  configuracao: {
    visualizar: 'configuracao.visualizar',
    editar: 'configuracao.editar',
  },
  auditoria: {
    visualizar: 'auditoria.visualizar',
  },
  portal: {
    acessar: 'portal.acessar',
  },
} as const;

type ValoresDe<T> = T extends string
  ? T
  : T[keyof T] extends object
    ? ValoresDe<T[keyof T]>
    : T[keyof T];

export type ChavePermissao = ValoresDe<typeof PERM>;

/** Tem todas as permissões pedidas — não qualquer uma. */
export function temPermissao(
  permissoes: Iterable<string>,
  ...exigidas: readonly string[]
): boolean {
  const conjunto = permissoes instanceof Set ? permissoes : new Set(permissoes);
  return exigidas.every((chave) => conjunto.has(chave));
}
