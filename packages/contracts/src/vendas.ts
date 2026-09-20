import { z } from 'zod';

/**
 * Contratos da venda de balcão (PDV).
 *
 * PDV é venda **imediata**: sai daqui com o estoque baixado e o pagamento
 * registrado. Não existe rascunho que fica pendurado — pedido que aguarda
 * confirmação é outra entidade, com outro fluxo. Ver ADR-008 e docs/ORDERS.md.
 */

const dinheiro = (rotulo: string) =>
  z.string().regex(/^\d+(\.\d{1,2})?$/, `${rotulo} precisa ser um valor em reais, como "89.90"`);

const quantidade = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Quantidade precisa ser um número decimal em texto')
  .refine((v) => Number(v) > 0, 'A quantidade precisa ser maior que zero');

export const formaPagamentoSchema = z.enum([
  'DINHEIRO',
  'PIX',
  'DEBITO',
  'CREDITO',
  'TRANSFERENCIA',
  'BOLETO',
  'PRAZO',
  'CARTEIRA',
]);
export type FormaPagamento = z.infer<typeof formaPagamentoSchema>;

export const statusVendaSchema = z.enum([
  'RASCUNHO',
  'CONCLUIDA',
  'CANCELADA',
  'DEVOLVIDA_PARCIAL',
  'DEVOLVIDA_TOTAL',
]);
export type StatusVenda = z.infer<typeof statusVendaSchema>;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export const itemVendaSchema = z.object({
  variacaoId: z.string().uuid(),
  quantidade,
  /**
   * Preço manual. Ausente = o da tabela.
   *
   * Informar exige `preco.aplicar_desconto`, e o item fica marcado como
   * `MANUAL` — o relatório de desconto precisa saber quais preços alguém
   * digitou à mão.
   */
  precoUnitario: dinheiro('Preço').optional(),
  descontoItem: dinheiro('Desconto').optional(),
});
export type ItemVenda = z.infer<typeof itemVendaSchema>;

export const pagamentoVendaSchema = z.object({
  forma: formaPagamentoSchema,
  valor: dinheiro('Valor'),
  parcelas: z.number().int().min(1).max(36).default(1),
  bandeira: z.string().trim().max(30).optional(),
  /** Só os quatro últimos. Nunca o cartão inteiro. */
  ultimosQuatro: z
    .string()
    .regex(/^\d{4}$/, 'Informe os quatro últimos dígitos')
    .optional(),
  autorizacao: z.string().trim().max(60).optional(),
  /**
   * So em `PRAZO`, e so para cliente SEM carteira: e o vencimento do titulo
   * que a venda gera. Omitido, vale o prazo padrao de 30 dias.
   *
   * Cliente COM carteira nao usa este campo — a divida dele vira debito no
   * razao da carteira, que nao tem vencimento por compra. docs/WALLET.md §6.
   */
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD')
    .optional(),
});
export type PagamentoVenda = z.infer<typeof pagamentoVendaSchema>;

export const novaVendaSchema = z.object({
  lojaId: z.string().uuid(),
  /** Ausente = o local padrão de venda da loja. */
  localId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  /** Ausente = a tabela do cliente, ou a padrão da empresa. */
  tabelaPrecoId: z.string().uuid().optional(),
  itens: z.array(itemVendaSchema).min(1, 'A venda precisa de ao menos um item').max(200),
  desconto: dinheiro('Desconto').optional(),
  acrescimo: dinheiro('Acréscimo').optional(),
  pagamentos: z
    .array(pagamentoVendaSchema)
    .min(1, 'Informe ao menos uma forma de pagamento')
    .max(10),
  observacao: z.string().trim().max(400).optional(),
});
export type NovaVenda = z.infer<typeof novaVendaSchema>;

export const cancelamentoVendaSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva o motivo do cancelamento').max(400),
});
export type CancelamentoVenda = z.infer<typeof cancelamentoVendaSchema>;

/**
 * Devolução PARCIAL de uma venda.
 *
 * Item a item, com quantidade. Devolver dois de dez não é cancelar a venda:
 * cancelar apaga o faturamento inteiro e o resto da mercadoria continua com o
 * cliente.
 *
 * Para onde vai o dinheiro é decidido pelo servidor, na ordem inversa da
 * venda: abate primeiro o que o cliente ainda DEVE — título em aberto, depois
 * débito na carteira — e só o que sobrar volta como dinheiro.
 */
export const devolucaoVendaSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva o motivo da devolução').max(400),
  itens: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantidade,
      }),
    )
    .min(1, 'Escolha ao menos um item'),
});
export type DevolucaoVenda = z.infer<typeof devolucaoVendaSchema>;

/** O que a devolução fez com o dinheiro. A tela mostra linha a linha. */
export const destinoDevolucaoSchema = z.object({
  onde: z.enum(['TITULO', 'CARTEIRA', 'CAIXA']),
  valor: z.string(),
  descricao: z.string(),
});
export type DestinoDevolucao = z.infer<typeof destinoDevolucaoSchema>;

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

export const itemVendaResumoSchema = z.object({
  id: z.string(),
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  quantidade: z.string(),
  /**
   * Quanto deste item já voltou.
   *
   * A coluna existia no banco desde o início e nenhuma tela a lia: devolver
   * dois de dez só era possível cancelando a venda inteira.
   */
  quantidadeDevolvida: z.string(),
  precoUnitario: z.string(),
  descontoItem: z.string(),
  totalItem: z.string(),
  precoOrigem: z.string(),
  /** Custo congelado no instante da saída. Só com `produto.ver_custo`. */
  custoUnitario: z.string().optional(),
});
export type ItemVendaResumo = z.infer<typeof itemVendaResumoSchema>;

export const vendaSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  status: statusVendaSchema,
  origem: z.enum(['PDV', 'PEDIDO']),
  lojaId: z.string(),
  loja: z.string(),
  local: z.string(),
  clienteId: z.string().nullable(),
  cliente: z.string().nullable(),
  vendedorId: z.string(),
  vendedor: z.string(),
  tabelaPreco: z.string().nullable(),
  subtotal: z.string(),
  desconto: z.string(),
  acrescimo: z.string(),
  total: z.string(),
  /** Quanto o cliente entregou a mais em dinheiro. */
  troco: z.string(),
  concluidaEm: z.string().nullable(),
  canceladaEm: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  itens: z.array(itemVendaResumoSchema),
  pagamentos: z.array(
    z.object({
      forma: formaPagamentoSchema,
      valor: z.string(),
      parcelas: z.number().int(),
      bandeira: z.string().nullable(),
      ultimosQuatro: z.string().nullable(),
    }),
  ),
  /** Margem da venda inteira. Só com `produto.ver_custo`. */
  custoTotal: z.string().optional(),
  margem: z.string().optional(),
});
export type Venda = z.infer<typeof vendaSchema>;

/**
 * O que a devolução devolveu, e para onde.
 *
 * Os destinos vêm na RESPOSTA, não só na tela: quem chama a API precisa saber
 * que R$ 180,00 abateram um título e R$ 40,00 saíram da gaveta. Devolver só o
 * total faria o dinheiro mudar de lugar em silêncio.
 */
export const resultadoDevolucaoSchema = z.object({
  venda: vendaSchema,
  valorDevolvido: z.string(),
  destinos: z.array(destinoDevolucaoSchema),
});
export type ResultadoDevolucao = z.infer<typeof resultadoDevolucaoSchema>;

export const resultadoVendaSchema = z.object({
  venda: vendaSchema,
  /** Saldo negativo, item sem base de custo — o que o operador precisa ver. */
  avisos: z.array(z.object({ codigo: z.string(), mensagem: z.string() })),
});
export type ResultadoVenda = z.infer<typeof resultadoVendaSchema>;

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export const filtroVendasSchema = z.object({
  lojaId: z.string().uuid().optional(),
  vendedorId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  status: statusVendaSchema.optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiltroVendas = z.infer<typeof filtroVendasSchema>;

export const paginaVendasSchema = z.object({
  itens: z.array(vendaSchema),
  proximoCursor: z.string().nullable(),
  /** Soma das vendas concluídas no filtro. */
  totalVendido: z.string(),
});
export type PaginaVendas = z.infer<typeof paginaVendasSchema>;

/**
 * Busca do PDV.
 *
 * Separada da busca de estoque porque responde outra pergunta: ali é "onde
 * está a mercadoria", aqui é "por quanto eu vendo isto, e tem no balcão".
 */
export const buscaItemVendaSchema = z.object({
  /**
   * Vazio e valido: o PDV abre com a grade do que ha no balcao. Exigir termo
   * obrigava a saber o nome antes de procurar — e no balcao nem sempre se
   * sabe.
   */
  termo: z.string().trim().max(120).default(''),
  lojaId: z.string().uuid(),
  tabelaPrecoId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(30).default(15),
});
export type BuscaItemVenda = z.infer<typeof buscaItemVendaSchema>;

export const itemParaVendaSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  codigoBarras: z.string().nullable(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  imagemPrincipalId: z.string().nullable(),
  /** Nulo quando o item não tem preço na tabela escolhida. */
  preco: z.string().nullable(),
  /** Saldo no local de venda da loja — o que existe no balcão, não na rede. */
  saldo: z.string(),
  casouCodigoBarras: z.boolean(),
});
export type ItemParaVenda = z.infer<typeof itemParaVendaSchema>;

/** O que o PDV precisa saber antes de abrir. */
export const contextoPdvSchema = z.object({
  lojas: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
      localPadraoId: z.string().nullable(),
      localPadrao: z.string().nullable(),
    }),
  ),
  tabelas: z.array(
    z.object({ id: z.string(), nome: z.string(), chave: z.string(), padrao: z.boolean() }),
  ),
  podeDarDesconto: z.boolean(),
  podeVenderSemSaldo: z.boolean(),
});
export type ContextoPdv = z.infer<typeof contextoPdvSchema>;
