import { z } from 'zod';

/**
 * Os relatórios que esperavam Compras e Contas existirem.
 *
 * Eram os dois grupos marcados "Fase 5" no índice dos 36. Com os módulos
 * construídos, seis dos sete saem; "Comissões apuradas" continua de fora
 * porque não há modelo de comissão no sistema — e inventar a regra seria pior
 * do que a lacuna.
 */

// ---------------------------------------------------------------------------
// Aging — a pagar e a receber por vencimento
// ---------------------------------------------------------------------------

export const filtroAgingSchema = z.object({
  tipo: z.enum(['PAGAR', 'RECEBER']).default('PAGAR'),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});
export type FiltroAging = z.infer<typeof filtroAgingSchema>;

export const faixaAgingSchema = z.object({
  faixa: z.string(),
  titulos: z.number().int(),
  /** Soma de `valor − pago`: o que ainda falta, não o valor cheio. */
  valor: z.string(),
});
export type FaixaAging = z.infer<typeof faixaAgingSchema>;

export const linhaAgingSchema = z.object({
  contraparteId: z.string().nullable(),
  contraparte: z.string(),
  /** Uma coluna por faixa, na mesma ordem de `faixas`. */
  porFaixa: z.array(z.string()),
  total: z.string(),
  titulos: z.number().int(),
  /** Dias do vencimento mais antigo em aberto. Nulo quando nada venceu. */
  atrasoMaisAntigo: z.number().int().nullable(),
});
export type LinhaAging = z.infer<typeof linhaAgingSchema>;

export const relatorioAgingSchema = z.object({
  tipo: z.enum(['PAGAR', 'RECEBER']),
  faixas: z.array(faixaAgingSchema),
  itens: z.array(linhaAgingSchema),
  /** O conjunto inteiro, nunca a página. */
  total: z.string(),
  totalTitulos: z.number().int(),
  vencido: z.string(),
  aVencer: z.string(),
});
export type RelatorioAging = z.infer<typeof relatorioAgingSchema>;

// ---------------------------------------------------------------------------
// Fluxo de caixa realizado
// ---------------------------------------------------------------------------

export const filtroFluxoSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
});
export type FiltroFluxo = z.infer<typeof filtroFluxoSchema>;

export const diaDoFluxoSchema = z.object({
  dia: z.string(),
  entrou: z.string(),
  saiu: z.string(),
  /** `entrou − saiu`. Negativo é dia em que saiu mais do que entrou. */
  liquido: z.string(),
});
export type DiaDoFluxo = z.infer<typeof diaDoFluxoSchema>;

export const relatorioFluxoSchema = z.object({
  dias: z.array(diaDoFluxoSchema),
  entrou: z.string(),
  saiu: z.string(),
  liquido: z.string(),
  /**
   * REALIZADO, não previsto: só o que foi baixado de verdade.
   *
   * Título em aberto com vencimento no período não entra — ele é promessa, e
   * misturar promessa com dinheiro que passou faz o fluxo mentir exatamente
   * no mês em que ninguém pagou.
   */
  observacao: z.string(),
});
export type RelatorioFluxo = z.infer<typeof relatorioFluxoSchema>;

// ---------------------------------------------------------------------------
// Compras por fornecedor
// ---------------------------------------------------------------------------

export const filtroComprasFornecedorSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(90),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroComprasFornecedor = z.infer<typeof filtroComprasFornecedorSchema>;

export const linhaFornecedorSchema = z.object({
  fornecedorId: z.string(),
  fornecedor: z.string(),
  notas: z.number().int(),
  itens: z.number().int(),
  unidades: z.string(),
  valor: z.string(),
  /** Fatia do valor comprado no período. Soma 100 entre todos. */
  participacao: z.string(),
  /**
   * Dias entre a emissão da nota e o recebimento, em média.
   *
   * Nulo quando nenhuma nota dele tem emissão registrada — sem a data de
   * saída não há prazo, e zero diria "chegou no mesmo dia".
   */
  prazoMedio: z.number().nullable(),
  ultimaCompra: z.string().nullable(),
});
export type LinhaFornecedor = z.infer<typeof linhaFornecedorSchema>;

export const relatorioComprasFornecedorSchema = z.object({
  itens: z.array(linhaFornecedorSchema),
  total: z.string(),
  totalNotas: z.number().int(),
  fornecedores: z.number().int(),
});
export type RelatorioComprasFornecedor = z.infer<typeof relatorioComprasFornecedorSchema>;

// ---------------------------------------------------------------------------
// Evolução do custo de aquisição
// ---------------------------------------------------------------------------

export const filtroCustoAquisicaoSchema = z.object({
  dias: z.coerce.number().int().min(1).max(730).default(180),
  variacaoId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroCustoAquisicao = z.infer<typeof filtroCustoAquisicaoSchema>;

export const linhaCustoAquisicaoSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  compras: z.number().int(),
  primeiroCusto: z.string(),
  ultimoCusto: z.string(),
  menorCusto: z.string(),
  maiorCusto: z.string(),
  /** `(ultimo − primeiro) / primeiro`, em pontos percentuais. */
  variacaoPercentual: z.string().nullable(),
  primeiraCompraEm: z.string(),
  ultimaCompraEm: z.string(),
  ultimoFornecedor: z.string(),
});
export type LinhaCustoAquisicao = z.infer<typeof linhaCustoAquisicaoSchema>;

export const relatorioCustoAquisicaoSchema = z.object({
  itens: z.array(linhaCustoAquisicaoSchema),
  /** Quantos subiram, quantos caíram e quantos ficaram iguais, no conjunto. */
  subiram: z.number().int(),
  cairam: z.number().int(),
  estaveis: z.number().int(),
});
export type RelatorioCustoAquisicao = z.infer<typeof relatorioCustoAquisicaoSchema>;

// ---------------------------------------------------------------------------
// Notas a receber — pedido feito e mercadoria que não chegou
// ---------------------------------------------------------------------------

export const filtroAReceberSchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroAReceber = z.infer<typeof filtroAReceberSchema>;

export const linhaAReceberSchema = z.object({
  compraId: z.string(),
  numeroNota: z.string().nullable(),
  fornecedor: z.string(),
  local: z.string(),
  loja: z.string(),
  emitidaEm: z.string().nullable(),
  /** Dias desde a emissão. Nulo quando a nota não tem data de emissão. */
  diasParada: z.number().int().nullable(),
  itens: z.number().int(),
  unidades: z.string(),
  valor: z.string(),
});
export type LinhaAReceber = z.infer<typeof linhaAReceberSchema>;

export const relatorioAReceberSchema = z.object({
  itens: z.array(linhaAReceberSchema),
  total: z.string(),
  notas: z.number().int(),
  /** Quantas passaram de 15 dias sem entrar. É a fila que atrasou. */
  paradasHaMais15: z.number().int(),
});
export type RelatorioAReceber = z.infer<typeof relatorioAReceberSchema>;

// ---------------------------------------------------------------------------
// Ranking de revendedores
// ---------------------------------------------------------------------------

/**
 * Quem mais COMPROU no período.
 *
 * Não "quem mais vendeu": a revenda do professor acontece fora daqui — ele
 * compra da loja e vende para os alunos dele, e o sistema não vê essa segunda
 * venda. Chamar o ranking de "vendas do revendedor" seria rótulo mais forte do
 * que a conta.
 *
 * A base é a VENDA faturada, não o pedido: pedido confirmado e não faturado é
 * compromisso, não compra. E é a mesma linha que vira venda quando o pedido do
 * portal é faturado, então não há contagem dupla.
 */
export const filtroRevendedoresSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(90),
  /** Vazio = todos os perfis que não são consumidor final. */
  perfil: z.enum(['PROFESSOR', 'REVENDEDOR', 'TODOS']).default('TODOS'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroRevendedores = z.infer<typeof filtroRevendedoresSchema>;

export const linhaRevendedorSchema = z.object({
  clienteId: z.string(),
  cliente: z.string(),
  perfil: z.enum(['CONSUMIDOR', 'PROFESSOR', 'REVENDEDOR']),
  tabelaPreco: z.string().nullable(),
  /** Posição no ranking, já com empate resolvido pelo valor. */
  posicao: z.number().int(),
  compras: z.number().int(),
  itens: z.number().int(),
  unidades: z.string(),
  valor: z.string(),
  /** `valor / compras`. Quem compra muito de pouco em pouco aparece aqui. */
  ticketMedio: z.string(),
  participacao: z.string(),
  ultimaCompraEm: z.string().nullable(),
  /** Dias desde a última compra. Alto com valor alto é quem está sumindo. */
  diasSemComprar: z.number().int().nullable(),
});
export type LinhaRevendedor = z.infer<typeof linhaRevendedorSchema>;

export const relatorioRevendedoresSchema = z.object({
  itens: z.array(linhaRevendedorSchema),
  /** O conjunto inteiro, nunca a página. */
  total: z.string(),
  revendedores: z.number().int(),
  compras: z.number().int(),
  /**
   * Quantos cadastros têm perfil de revenda mas NÃO compraram no período.
   *
   * É o número que um programa de premiação precisa e o ranking esconde: quem
   * sumiu não aparece na lista de quem comprou.
   */
  semCompraNoPeriodo: z.number().int(),
});
export type RelatorioRevendedores = z.infer<typeof relatorioRevendedoresSchema>;
