import { z } from 'zod';

/**
 * Contratos da carteira do cliente (conta corrente).
 *
 * A convenção de sinal está em docs/WALLET.md §2 e **não se inverte em camada
 * nenhuma**:
 *
 *   saldo POSITIVO → crédito do cliente. A loja deve a ele.
 *   saldo NEGATIVO → débito do cliente. Ele deve à loja.
 *
 * A tela pode escrever "R$ 1.200,00 em aberto" para um saldo de `-1200.00`.
 * O valor que trafega continua negativo.
 */

const dinheiro = (rotulo: string) =>
  z.string().regex(/^-?\d+(\.\d{1,2})?$/, `${rotulo} precisa ser um valor em reais`);

const dinheiroPositivo = (rotulo: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, `${rotulo} precisa ser um valor em reais`)
    .refine((v) => Number(v) > 0, `${rotulo} precisa ser maior que zero`);

export const sentidoCarteiraSchema = z.enum(['CREDITO', 'DEBITO']);
export type SentidoCarteira = z.infer<typeof sentidoCarteiraSchema>;

export const tipoMovimentoCarteiraSchema = z.enum([
  'DEPOSITO',
  'QUITACAO',
  'DEVOLUCAO_VENDA',
  'BONIFICACAO',
  'ESTORNO_DEBITO',
  'AJUSTE_CREDITO',
  'PAGAMENTO_VENDA',
  'VENDA_A_PRAZO',
  'TAXA',
  'ESTORNO_CREDITO',
  'AJUSTE_DEBITO',
]);
export type TipoMovimentoCarteira = z.infer<typeof tipoMovimentoCarteiraSchema>;

/**
 * Tipos que um operador lança à mão.
 *
 * `PAGAMENTO_VENDA` e `DEVOLUCAO_VENDA` ficam de fora: são consequência de uma
 * venda, e lançá-los soltos criaria movimento de dinheiro sem o documento que
 * o explica.
 */
export const tipoLancamentoManualSchema = z.enum([
  'DEPOSITO',
  'QUITACAO',
  'BONIFICACAO',
  'AJUSTE_CREDITO',
  'TAXA',
  'AJUSTE_DEBITO',
]);
export type TipoLancamentoManual = z.infer<typeof tipoLancamentoManualSchema>;

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export const lancamentoCarteiraSchema = z.object({
  tipo: tipoLancamentoManualSchema,
  valor: dinheiroPositivo('Valor'),
  formaPagamento: z
    .enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'BOLETO'])
    .optional(),
  documento: z.string().trim().max(60).optional(),
  /**
   * Obrigatória em `AJUSTE_*` e `BONIFICACAO` — os tipos que criam dinheiro
   * sem contrapartida. O banco também exige, por CHECK.
   */
  justificativa: z.string().trim().max(400).optional(),
});
export type LancamentoCarteira = z.infer<typeof lancamentoCarteiraSchema>;

export const limiteCarteiraSchema = z.object({
  /** Quanto o saldo pode ficar negativo. Sempre positivo ou zero. */
  limiteCredito: dinheiro('Limite').refine((v) => Number(v) >= 0, 'O limite não pode ser negativo'),
  justificativa: z.string().trim().max(400).optional(),
});
export type LimiteCarteira = z.infer<typeof limiteCarteiraSchema>;

export const bloqueioCarteiraSchema = z.object({
  bloqueada: z.boolean(),
  justificativa: z.string().trim().min(5, 'Descreva o motivo').max(400),
});
export type BloqueioCarteira = z.infer<typeof bloqueioCarteiraSchema>;

export const estornoCarteiraSchema = z.object({
  justificativa: z.string().trim().min(5, 'Descreva o motivo do estorno').max(400),
});
export type EstornoCarteira = z.infer<typeof estornoCarteiraSchema>;

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const movimentoCarteiraSchema = z.object({
  id: z.string(),
  criadoEm: z.string(),
  sentido: sentidoCarteiraSchema,
  tipo: tipoMovimentoCarteiraSchema,
  valor: z.string(),
  saldoAnterior: z.string(),
  saldoPosterior: z.string(),
  excedeuLimite: z.boolean(),
  vendaId: z.string().nullable(),
  vendaNumero: z.number().int().nullable(),
  formaPagamento: z.string().nullable(),
  documento: z.string().nullable(),
  justificativa: z.string().nullable(),
  ator: z.string().nullable(),
  /** Preenchido quando este movimento anula outro. */
  estornoDeId: z.string().nullable(),
  /** `true` quando ESTE movimento já foi estornado por outro. */
  estornado: z.boolean(),
});
export type MovimentoCarteira = z.infer<typeof movimentoCarteiraSchema>;

export const carteiraSchema = z.object({
  id: z.string(),
  clienteId: z.string(),
  cliente: z.string(),
  /** Negativo = o cliente deve à loja. Ver docs/WALLET.md §2. */
  saldo: z.string(),
  limiteCredito: z.string(),
  /** `saldo + limiteCredito`. O quanto ainda dá para comprar. */
  disponivel: z.string(),
  bloqueadaParaCompra: z.boolean(),
  status: z.enum(['ATIVO', 'INATIVO']),
  observacao: z.string().nullable(),
  /** Desde quando a conta corrente existe. */
  criadoEm: z.string(),
  /** A tabela de preço do cliente — o que ele paga, e por isso o que deve. */
  tabelaPreco: z.string().nullable(),
});
export type Carteira = z.infer<typeof carteiraSchema>;

/**
 * O extrato.
 *
 * Vem com o saldo no topo e os movimentos do mais novo para o mais antigo —
 * a ordem em que alguém confere uma conta.
 */
export const extratoCarteiraSchema = z.object({
  carteira: carteiraSchema,
  movimentos: z.array(movimentoCarteiraSchema),
  proximoCursor: z.string().nullable(),
  /** Totais do período consultado, para conferência. */
  totalCreditos: z.string(),
  totalDebitos: z.string(),
});
export type ExtratoCarteira = z.infer<typeof extratoCarteiraSchema>;

export const filtroExtratoSchema = z.object({
  de: z.string().optional(),
  ate: z.string().optional(),
  tipo: tipoMovimentoCarteiraSchema.optional(),
  sentido: sentidoCarteiraSchema.optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroExtrato = z.infer<typeof filtroExtratoSchema>;

export const filtroCarteirasSchema = z.object({
  busca: z.string().trim().max(120).optional(),
  /** Só quem está devendo. */
  apenasDevedores: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiltroCarteiras = z.infer<typeof filtroCarteirasSchema>;

export const paginaCarteirasSchema = z.object({
  itens: z.array(carteiraSchema),
  proximoCursor: z.string().nullable(),
  /** Soma dos saldos negativos. O que a loja tem a receber. */
  totalAReceber: z.string(),
});
export type PaginaCarteiras = z.infer<typeof paginaCarteirasSchema>;
