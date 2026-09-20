import { z } from 'zod';

/**
 * Contratos do pedido com confirmacao.
 *
 * PDV e pedido sao fluxos DIFERENTES, nao o mesmo fluxo com status. Ver
 * ADR-008 e docs/ORDERS.md §1. Nada aqui acrescenta etapa ao PDV.
 */

const dinheiro = (rotulo: string) =>
  z.string().regex(/^\d+(\.\d{1,2})?$/, `${rotulo} precisa ser um valor em reais`);

const quantidade = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Quantidade precisa ser um numero decimal em texto')
  .refine((v) => Number(v) > 0, 'A quantidade precisa ser maior que zero');

export const statusPedidoSchema = z.enum([
  'RASCUNHO',
  'AGUARDANDO_CONFIRMACAO',
  'AGUARDANDO_ACEITE_CLIENTE',
  'CONFIRMADO',
  'CONFIRMADO_PARCIALMENTE',
  'DEVOLVIDO',
  'RECUSADO',
  'FATURADO',
  'CONCLUIDO',
  'CANCELADO',
  'EXPIRADO',
]);
export type StatusPedido = z.infer<typeof statusPedidoSchema>;

export const statusPedidoItemSchema = z.enum([
  'PENDENTE',
  'CONFIRMADO',
  'DEVOLVIDO',
  'REMOVIDO',
  'CANCELADO',
]);
export type StatusPedidoItem = z.infer<typeof statusPedidoItemSchema>;

export const origemPedidoItemSchema = z.enum(['SOLICITADO_CLIENTE', 'ADICIONADO_EQUIPE']);
export type OrigemPedidoItem = z.infer<typeof origemPedidoItemSchema>;

// ---------------------------------------------------------------------------
// Portal do cliente
// ---------------------------------------------------------------------------

/**
 * O que o cliente ve no catalogo.
 *
 * `disponivel` e um BOOLEANO. O cliente nunca ve quantidade, em loja nenhuma —
 * docs/ORDERS.md §7. Saber que restam duas pecas e informacao comercial da
 * loja, nao do comprador.
 */
export const itemCatalogoSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  imagemPrincipalId: z.string().nullable(),
  preco: z.string(),
  disponivel: z.boolean(),
});
export type ItemCatalogo = z.infer<typeof itemCatalogoSchema>;

export const buscaCatalogoSchema = z.object({
  termo: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().min(1).max(60).default(24),
});
export type BuscaCatalogo = z.infer<typeof buscaCatalogoSchema>;

export const novoPedidoSchema = z.object({
  itens: z
    .array(z.object({ variacaoId: z.string().uuid(), quantidade }))
    .min(1, 'O carrinho precisa de ao menos um item')
    .max(200),
  observacao: z.string().trim().max(400).optional(),
});
export type NovoPedido = z.infer<typeof novoPedidoSchema>;

/**
 * Reenvio de um pedido devolvido.
 *
 * `itens` e opcional: sem ele, o pedido volta como estava. Com ele, o cliente
 * ajusta as quantidades antes de reenviar — que e o caso comum, porque o
 * motivo da devolucao costuma ser falta de saldo.
 *
 * Nao da para ACRESCENTAR item aqui. Item novo e outro pedido, ou inclusao
 * pela equipe: reenvio e a mesma conversa continuando, nao uma nova.
 */
export const reenvioPedidoSchema = z.object({
  itens: z
    .array(z.object({ itemId: z.string().uuid(), quantidade }))
    .max(200)
    .optional(),
  observacao: z.string().trim().max(400).optional(),
});
export type ReenvioPedido = z.infer<typeof reenvioPedidoSchema>;

export const aceitePedidoSchema = z.object({
  /** `false` devolve o pedido a equipe com o motivo do cliente. */
  aceita: z.boolean(),
  motivo: z.string().trim().max(400).optional(),
});
export type AceitePedido = z.infer<typeof aceitePedidoSchema>;

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

export const itemConfirmacaoSchema = z.object({
  itemId: z.string().uuid(),
  /** Zero devolve o item inteiro. Menor que o solicitado e parcial. */
  quantidadeConfirmada: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida'),
  motivoDevolucao: z.string().trim().max(200).optional(),
});
export type ItemConfirmacao = z.infer<typeof itemConfirmacaoSchema>;

export const confirmacaoPedidoSchema = z.object({
  itens: z.array(itemConfirmacaoSchema).min(1),
  /**
   * Obrigatoria quando algum item e confirmado acima do disponivel.
   * Permitido quando autorizado, nunca silencioso.
   */
  justificativaSemSaldo: z.string().trim().max(400).optional(),
});
export type ConfirmacaoPedido = z.infer<typeof confirmacaoPedidoSchema>;

export const inclusaoItemSchema = z.object({
  variacaoId: z.string().uuid(),
  quantidade,
  /** O que foi combinado com o solicitante. Vai para a linha do tempo. */
  motivo: z.string().trim().min(5, 'Descreva o que foi combinado').max(200),
});
export type InclusaoItem = z.infer<typeof inclusaoItemSchema>;

export const remocaoItemSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva o que foi combinado').max(200),
});
export type RemocaoItem = z.infer<typeof remocaoItemSchema>;

export const devolucaoPedidoSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva o motivo').max(400),
});
export type DevolucaoPedido = z.infer<typeof devolucaoPedidoSchema>;

export const faturamentoPedidoSchema = z.object({
  pagamentos: z
    .array(
      z.object({
        forma: z.enum([
          'DINHEIRO',
          'PIX',
          'DEBITO',
          'CREDITO',
          'TRANSFERENCIA',
          'BOLETO',
          'PRAZO',
          'CARTEIRA',
        ]),
        valor: dinheiro('Valor'),
        parcelas: z.number().int().min(1).max(36).default(1),
      }),
    )
    .min(1, 'Informe como o pedido foi pago'),
});
export type FaturamentoPedido = z.infer<typeof faturamentoPedidoSchema>;

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const pedidoItemSchema = z.object({
  id: z.string(),
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  imagemPrincipalId: z.string().nullable(),
  origem: origemPedidoItemSchema,
  status: statusPedidoItemSchema,
  quantidadeSolicitada: z.string(),
  quantidadeConfirmada: z.string(),
  precoUnitario: z.string(),
  totalItem: z.string(),
  motivoDevolucao: z.string().nullable(),
  motivoRemocao: z.string().nullable(),
  confirmadoSemSaldo: z.boolean(),
  /**
   * Disponivel no local do pedido, no instante da consulta.
   *
   * So aparece para a EQUIPE. No portal este campo nao vem — o cliente ve
   * disponivel/indisponivel no catalogo, nunca quantidade.
   */
  disponivelAgora: z.string().optional(),
});
export type PedidoItem = z.infer<typeof pedidoItemSchema>;

/** Uma linha da linha do tempo, em texto direto. docs/ORDERS.md §6. */
export const eventoPedidoSchema = z.object({
  id: z.string(),
  criadoEm: z.string(),
  deStatus: statusPedidoSchema.nullable(),
  paraStatus: statusPedidoSchema,
  ator: z.string().nullable(),
  atorTipo: z.enum(['FUNCIONARIO', 'CLIENTE', 'SISTEMA']),
  motivo: z.string().nullable(),
});
export type EventoPedido = z.infer<typeof eventoPedidoSchema>;

export const pedidoSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  status: statusPedidoSchema,
  lojaId: z.string(),
  loja: z.string(),
  clienteId: z.string(),
  cliente: z.string(),
  /** Para o "Falar com o cliente" da tela de conferencia. */
  clienteTelefone: z.string().nullable(),
  solicitante: z.string().nullable(),
  tabelaPreco: z.string().nullable(),
  /**
   * A tabela pelo id, nao so pelo nome.
   *
   * A tela da equipe busca itens para incluir e precisa pedir o preco DESTA
   * tabela. Sem o id ela cai na tabela padrao, mostra um preco ao operador e
   * grava outro no pedido — dois numeros para o mesmo ato.
   */
  tabelaPrecoId: z.string().nullable(),
  /** Congelado no envio. A referencia contra a qual se compara toda edicao. */
  valorSolicitado: z.string(),
  valorConfirmado: z.string(),
  /** `valorConfirmado − valorSolicitado`. Positivo exige aceite do cliente. */
  diferenca: z.string(),
  resumoAlteracao: z.string().nullable(),
  motivo: z.string().nullable(),
  validoAte: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  confirmadoEm: z.string().nullable(),
  faturadoEm: z.string().nullable(),
  aceiteClienteEm: z.string().nullable(),
  vendaNumero: z.number().int().nullable(),
  itens: z.array(pedidoItemSchema),
  eventos: z.array(eventoPedidoSchema),
});
export type Pedido = z.infer<typeof pedidoSchema>;

export const filtroPedidosSchema = z.object({
  status: statusPedidoSchema.optional(),
  /**
   * Varios status de uma vez, separados por virgula.
   *
   * As abas da fila agrupam: "Confirmados" e CONFIRMADO mais
   * CONFIRMADO_PARCIALMENTE; "Devolvidos" e DEVOLVIDO mais RECUSADO. Sem
   * isto, a contagem da aba (que ja agrupava) discordava da lista que ela
   * abria — o numero dizia uma coisa e as linhas outra.
   */
  statusEm: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(statusPedidoSchema).min(1).max(11).optional()),
  lojaId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  /** Apenas os que esperam acao da equipe. E a fila de trabalho. */
  apenasFila: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiltroPedidos = z.infer<typeof filtroPedidosSchema>;

/**
 * Quantos pedidos em cada situacao, independente do filtro aplicado.
 *
 * As abas da fila mostram numero: contar a pagina carregada daria um numero
 * que muda com o `limite` — e uma aba "Faturados 30" que na verdade sao 240.
 */
export const contagensPedidosSchema = z.object({
  aguardando: z.number().int(),
  comOCliente: z.number().int(),
  confirmados: z.number().int(),
  devolvidos: z.number().int(),
  faturados: z.number().int(),
});
export type ContagensPedidos = z.infer<typeof contagensPedidosSchema>;

export const paginaPedidosSchema = z.object({
  itens: z.array(pedidoSchema),
  proximoCursor: z.string().nullable(),
  /** Quantos aguardam acao da equipe agora. Vai no selo do menu. */
  naFila: z.number().int(),
  contagens: contagensPedidosSchema,
});
export type PaginaPedidos = z.infer<typeof paginaPedidosSchema>;

/**
 * O que o checkout produziu.
 *
 * `modoCheckout = PAGAMENTO_IMEDIATO` gera VENDA; `PEDIDO_COM_CONFIRMACAO`
 * gera PEDIDO. A tela precisa saber qual dos dois aconteceu para dizer a
 * coisa certa ao cliente. docs/ORDERS.md §8.
 */
export const resultadoCheckoutSchema = z.object({
  tipo: z.enum(['PEDIDO', 'VENDA']),
  pedido: pedidoSchema.nullable(),
  vendaNumero: z.number().int().nullable(),
  mensagem: z.string(),
});
export type ResultadoCheckout = z.infer<typeof resultadoCheckoutSchema>;
