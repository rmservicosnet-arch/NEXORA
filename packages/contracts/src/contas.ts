import { z } from 'zod';

/**
 * Contratos de contas — títulos COM VENCIMENTO.
 *
 * O que este módulo NÃO faz: criar um segundo saldo do cliente. O saldo do
 * revendedor continua sendo o da carteira, que é o razão; o título acrescenta
 * o que a carteira não tem, que é a DATA. Dar baixa num título a receber lança
 * a quitação NA carteira. Ver docs/WALLET.md.
 */

const dinheiro = (rotulo: string) =>
  z.string().regex(/^\d+(\.\d{1,2})?$/, `${rotulo} precisa ser um valor em texto, como "1500.00"`);

export const tipoTituloSchema = z.enum(['PAGAR', 'RECEBER']);
export type TipoTitulo = z.infer<typeof tipoTituloSchema>;

export const origemTituloSchema = z.enum(['COMPRA', 'VENDA', 'MANUAL']);
export type OrigemTitulo = z.infer<typeof origemTituloSchema>;

export const statusTituloSchema = z.enum(['ABERTO', 'PAGO', 'CANCELADO']);
export type StatusTitulo = z.infer<typeof statusTituloSchema>;

/**
 * Situação DERIVADA, calculada contra hoje.
 *
 * `VENCIDO` não é coluna no banco de propósito: um título vence sozinho com a
 * passagem do tempo, e uma coluna gravada precisaria de uma rotina para virar
 * — que, se não rodar, mostra "a vencer" um título de três semanas atrás.
 */
export const situacaoTituloSchema = z.enum([
  'VENCIDO',
  'VENCE_HOJE',
  'A_VENCER',
  'PAGO',
  'CANCELADO',
]);
export type SituacaoTitulo = z.infer<typeof situacaoTituloSchema>;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export const novoTituloSchema = z
  .object({
    tipo: tipoTituloSchema,
    lojaId: z.string().uuid().optional(),
    fornecedorId: z.string().uuid().optional(),
    clienteId: z.string().uuid().optional(),
    compraId: z.string().uuid().optional(),
    descricao: z.string().trim().min(3, 'Descreva o título').max(200),
    vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD'),
    valor: dinheiro('Valor').refine((v) => Number(v) > 0, 'O valor precisa ser maior que zero'),
    /**
     * Em quantas parcelas. Cada uma vira um título próprio, com o vencimento
     * adiantado de um mês — é assim que o fornecedor cobra, e um título só
     * com "3x" escondido no texto não aparece no fluxo de caixa de cada mês.
     */
    parcelas: z.coerce.number().int().min(1).max(60).default(1),
    observacao: z.string().trim().max(400).optional(),
  })
  .refine((t) => t.tipo !== 'PAGAR' || Boolean(t.fornecedorId) || Boolean(t.descricao), {
    message: 'Título a pagar precisa de fornecedor',
    path: ['fornecedorId'],
  })
  .refine((t) => t.tipo !== 'RECEBER' || Boolean(t.clienteId), {
    message: 'Título a receber precisa de cliente',
    path: ['clienteId'],
  });
export type NovoTitulo = z.infer<typeof novoTituloSchema>;

/**
 * Dar baixa.
 *
 * Parcial é normal: o fornecedor aceitou metade hoje e metade na semana que
 * vem. Marcar como pago o que foi pago pela metade é perder a cobrança do
 * resto.
 */
export const baixaSchema = z.object({
  valor: dinheiro('Valor pago').refine((v) => Number(v) > 0, 'O valor precisa ser maior que zero'),
  pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD'),
  forma: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'BOLETO', 'CARTEIRA']),
  /**
   * Obrigatório quando a forma é DINHEIRO: o dinheiro sai da GAVETA, e a
   * baixa vira sangria no caixa daquela loja. Sem caixa aberto, a API recusa.
   */
  lojaId: z.string().uuid().optional(),
  observacao: z.string().trim().max(400).optional(),
});
export type BaixaTitulo = z.infer<typeof baixaSchema>;

export const cancelamentoTituloSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva o motivo').max(400),
});
export type CancelamentoTitulo = z.infer<typeof cancelamentoTituloSchema>;

/**
 * Desfazer uma baixa.
 *
 * O motivo é obrigatório porque desfazer um recebimento move dinheiro no
 * sentido contrário em dois razões — caixa e carteira — e quem confere depois
 * precisa da frase, não só do número.
 */
export const estornoBaixaSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva por que a baixa está sendo desfeita').max(400),
});
export type EstornoBaixa = z.infer<typeof estornoBaixaSchema>;

export const filtroTitulosSchema = z.object({
  tipo: tipoTituloSchema.default('PAGAR'),
  /** `vencidos` e `abertos` são recortes derivados, não colunas. */
  recorte: z.enum(['abertos', 'vencidos', 'pagos', 'todos']).default('abertos'),
  termo: z.string().trim().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(40),
});
export type FiltroTitulos = z.infer<typeof filtroTitulosSchema>;

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const baixaResumoSchema = z.object({
  id: z.string(),
  valor: z.string(),
  pagoEm: z.string(),
  forma: z.string(),
  observacao: z.string().nullable(),
  ator: z.string().nullable(),
  criadoEm: z.string(),
  /**
   * Baixa estornada continua na lista, marcada.
   *
   * Sumir com ela diria que o dinheiro nunca se moveu — e ele se moveu. Quem
   * lê o título precisa ver que houve uma baixa e que ela foi desfeita, com
   * o motivo.
   */
  estornadaEm: z.string().nullable(),
  estornoMotivo: z.string().nullable(),
});
export type BaixaResumo = z.infer<typeof baixaResumoSchema>;

export const tituloSchema = z.object({
  id: z.string(),
  tipo: tipoTituloSchema,
  origem: origemTituloSchema,
  status: statusTituloSchema,
  situacao: situacaoTituloSchema,
  /** Negativo = vence em N dias; positivo = venceu há N dias. */
  diasDeAtraso: z.number().int(),
  contraparte: z.string(),
  descricao: z.string(),
  parcela: z.number().int(),
  parcelas: z.number().int(),
  vencimento: z.string(),
  valor: z.string(),
  valorPago: z.string(),
  /** `valor − valorPago`. É o que ainda se deve. */
  emAberto: z.string(),
  loja: z.string().nullable(),
  observacao: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  baixas: z.array(baixaResumoSchema),
});
export type Titulo = z.infer<typeof tituloSchema>;

export const resumoContasSchema = z.object({
  vencido: z.string(),
  titulosVencidos: z.number().int(),
  /** Dias desde o vencimento mais antigo em aberto. Nulo quando não há. */
  atrasoMaisAntigo: z.number().int().nullable(),
  venceHoje: z.string(),
  titulosHoje: z.number().int(),
  proximos7: z.string(),
  titulosProximos7: z.number().int(),
  emAberto: z.string(),
  titulosEmAberto: z.number().int(),
});
export type ResumoContas = z.infer<typeof resumoContasSchema>;

export const contagensContasSchema = z.object({
  aPagar: z.number().int(),
  aReceber: z.number().int(),
  abertos: z.number().int(),
  vencidos: z.number().int(),
  pagos: z.number().int(),
  todos: z.number().int(),
});
export type ContagensContas = z.infer<typeof contagensContasSchema>;

export const paginaTitulosSchema = z.object({
  itens: z.array(tituloSchema),
  proximoCursor: z.string().nullable(),
  resumo: resumoContasSchema,
  contagens: contagensContasSchema,
});
export type PaginaTitulos = z.infer<typeof paginaTitulosSchema>;
