import { z } from 'zod';

/**
 * Contratos do caixa.
 *
 * O caixa controla o **dinheiro físico da gaveta**. Cartão e PIX não passam
 * por aqui: vão para a adquirente, não para a gaveta. Ver docs/CASHBOX.md.
 */

const dinheiro = (rotulo: string) =>
  z.string().regex(/^\d+(\.\d{1,2})?$/, `${rotulo} precisa ser um valor em reais, como "150.00"`);

export const statusCaixaSchema = z.enum(['ABERTO', 'FECHADO', 'CONFERIDO']);
export type StatusCaixa = z.infer<typeof statusCaixaSchema>;

export const tipoMovimentoCaixaSchema = z.enum(['SANGRIA', 'SUPRIMENTO']);
export type TipoMovimentoCaixa = z.infer<typeof tipoMovimentoCaixaSchema>;

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export const aberturaCaixaSchema = z.object({
  lojaId: z.string().uuid(),
  /** Fundo de troco contado na abertura. Zero é válido. */
  valorAbertura: dinheiro('Fundo de troco'),
  observacao: z.string().trim().max(400).optional(),
});
export type AberturaCaixa = z.infer<typeof aberturaCaixaSchema>;

export const movimentoCaixaSchema = z.object({
  tipo: tipoMovimentoCaixaSchema,
  valor: dinheiro('Valor').refine((v) => Number(v) > 0, 'O valor precisa ser maior que zero'),
  /**
   * Obrigatório, e não por burocracia.
   *
   * Dinheiro que sai da gaveta sem motivo escrito vira diferença sem dono no
   * fechamento — e a conversa acontece dias depois, sem ninguém lembrar.
   */
  motivo: z.string().trim().min(5, 'Descreva o motivo').max(400),
});
export type NovoMovimentoCaixa = z.infer<typeof movimentoCaixaSchema>;

export const fechamentoCaixaSchema = z.object({
  /**
   * O que foi CONTADO na gaveta, não o que o sistema espera.
   *
   * Pedir a diferença faria o operador conferir contra o número do sistema em
   * vez de contar o dinheiro — que é justamente o que a conferência existe
   * para evitar.
   */
  valorContado: dinheiro('Valor contado'),
  observacao: z.string().trim().max(400).optional(),
});
export type FechamentoCaixa = z.infer<typeof fechamentoCaixaSchema>;

export const conferenciaCaixaSchema = z.object({
  observacao: z.string().trim().max(400).optional(),
});
export type ConferenciaCaixa = z.infer<typeof conferenciaCaixaSchema>;

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const movimentoCaixaResumoSchema = z.object({
  id: z.string(),
  tipo: tipoMovimentoCaixaSchema,
  valor: z.string(),
  motivo: z.string(),
  criadoEm: z.string(),
});
export type MovimentoCaixaResumo = z.infer<typeof movimentoCaixaResumoSchema>;

/**
 * A conta do caixa, aberta em parcelas.
 *
 * O total nunca aparece sozinho: quem confere precisa ver de onde cada parcela
 * veio, senão a única saída diante de uma diferença é aceitar o número.
 */
export const resumoFinanceiroCaixaSchema = z.object({
  valorAbertura: z.string(),
  suprimentos: z.string(),
  sangrias: z.string(),
  /** Dinheiro que ficou na gaveta: recebido em espécie menos o troco. */
  vendasEmDinheiro: z.string(),
  /** `abertura + suprimentos − sangrias + vendas em dinheiro`. */
  esperadoEmCaixa: z.string(),
  /** Não entra na gaveta. Aparece para a conferência do turno. */
  vendasEmCartao: z.string(),
  vendasEmPix: z.string(),
  outrasFormas: z.string(),
  totalVendido: z.string(),
  quantidadeVendas: z.number().int(),
});
export type ResumoFinanceiroCaixa = z.infer<typeof resumoFinanceiroCaixaSchema>;

export const caixaSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  status: statusCaixaSchema,
  lojaId: z.string(),
  loja: z.string(),
  operadorId: z.string(),
  operador: z.string(),
  valorAbertura: z.string(),
  valorContado: z.string().nullable(),
  valorEsperado: z.string().nullable(),
  /** `contado − esperado`. Negativo é falta, positivo é sobra. */
  diferenca: z.string().nullable(),
  observacaoAbertura: z.string().nullable(),
  observacaoFechamento: z.string().nullable(),
  observacaoConferencia: z.string().nullable(),
  abertoEm: z.string(),
  fechadoEm: z.string().nullable(),
  conferidoPor: z.string().nullable(),
  conferidoEm: z.string().nullable(),
  resumo: resumoFinanceiroCaixaSchema,
  movimentos: z.array(movimentoCaixaResumoSchema),
});
export type Caixa = z.infer<typeof caixaSchema>;

/**
 * Resposta de "tenho caixa aberto?".
 *
 * Um objeto com `caixa: null`, e não `null` direto. Handler do NestJS que
 * devolve `null` manda **corpo vazio**, e todo cliente que fizer
 * `if (resposta)` recebe `{}` — que é verdadeiro. Foi exatamente assim que um
 * teste daqui concluiu que havia caixa aberto quando não havia.
 *
 * "Não há caixa aberto" é uma resposta normal. Ela precisa caber no corpo.
 */
export const caixaAtualSchema = z.object({
  caixa: caixaSchema.nullable(),
});
export type CaixaAtual = z.infer<typeof caixaAtualSchema>;

export const filtroCaixasSchema = z.object({
  lojaId: z.string().uuid().optional(),
  operadorId: z.string().uuid().optional(),
  status: statusCaixaSchema.optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiltroCaixas = z.infer<typeof filtroCaixasSchema>;

export const paginaCaixasSchema = z.object({
  itens: z.array(caixaSchema),
  proximoCursor: z.string().nullable(),
});
export type PaginaCaixas = z.infer<typeof paginaCaixasSchema>;
