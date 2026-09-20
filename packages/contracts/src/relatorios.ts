import { z } from 'zod';

/**
 * Relatorios.
 *
 * Dois construidos, de 36 no catalogo: posicao de estoque e vendas no
 * periodo. Custo e margem so viajam para quem tem `relatorio.ver_custo` — e
 * quando nao viajam, a tela nao mostra coluna vazia: ela nao mostra a coluna.
 */

// ---------------------------------------------------------------------------
// Posicao de estoque
// ---------------------------------------------------------------------------

export const filtroPosicaoSchema = z.object({
  lojaId: z.string().uuid().optional(),
  localId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  /** So o que esta negativo, ou so o que esta abaixo do minimo. */
  recorte: z.enum(['todos', 'negativos', 'abaixoDoMinimo']).default('todos'),
  limite: z.coerce.number().int().min(1).max(200).default(60),
});
export type FiltroPosicao = z.infer<typeof filtroPosicaoSchema>;

/**
 * Uma linha da posicao: a variacao NUM LOCAL.
 *
 * Dez pecas com quatro numa loja e seis em outra nao e o mesmo que dez num
 * lugar so — e quem vai transferir precisa ver por local.
 */
export const linhaPosicaoSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  categoria: z.string().nullable(),
  loja: z.string(),
  local: z.string(),
  saldo: z.string(),
  estoqueMinimo: z.string(),
  abaixoDoMinimo: z.boolean(),
  custoMedio: z.string().optional(),
  /** `saldo × custoMedio`. Negativo quando o saldo e negativo. */
  valor: z.string().optional(),
  /** A, B ou C pela participacao acumulada no valor. Nulo sem custo a vista. */
  abc: z.enum(['A', 'B', 'C']).nullable(),
});
export type LinhaPosicao = z.infer<typeof linhaPosicaoSchema>;

export const posicaoEstoqueSchema = z.object({
  /** Quando a foto foi tirada. Posicao e sempre de um instante. */
  em: z.string(),
  variacoes: z.number().int(),
  produtos: z.number().int(),
  unidades: z.string(),
  abaixoDoMinimo: z.number().int(),
  comSaldoNegativo: z.number().int(),

  /**
   * O valor do estoque, em tres numeros.
   *
   * Somar so os positivos da um patrimonio maior do que existe: o saldo
   * negativo e mercadoria que ja saiu e nao foi baixada. Ele entra com sinal.
   */
  valorPositivos: z.string().optional(),
  efeitoNegativos: z.string().optional(),
  valorLiquido: z.string().optional(),
  custoMedioDaCarteira: z.string().optional(),

  itens: z.array(linhaPosicaoSchema),
  /** Totais da PAGINA exibida, nao do relatorio inteiro. */
  totalExibido: z.object({ unidades: z.string(), valor: z.string().optional() }),
});
export type PosicaoEstoque = z.infer<typeof posicaoEstoqueSchema>;

// ---------------------------------------------------------------------------
// Vendas no periodo
// ---------------------------------------------------------------------------

export const dimensaoVendasSchema = z.enum([
  'vendedor',
  'produto',
  'cliente',
  'tabela',
  'categoria',
]);
export type DimensaoVendas = z.infer<typeof dimensaoVendasSchema>;

export const filtroVendasRelatorioSchema = z.object({
  /** Dias para tras a partir de hoje. */
  dias: z.coerce.number().int().min(1).max(365).default(14),
  lojaId: z.string().uuid().optional(),
  dimensao: dimensaoVendasSchema.default('vendedor'),
});
export type FiltroVendasRelatorio = z.infer<typeof filtroVendasRelatorioSchema>;

export const linhaRankingSchema = z.object({
  nome: z.string(),
  valor: z.string(),
  /** Participacao no total do periodo, em pontos percentuais. */
  participacao: z.string(),
  quantidade: z.string(),
  /** Margem bruta em pontos percentuais. Ausente sem `relatorio.ver_custo`. */
  margem: z.string().nullable().optional(),
});
export type LinhaRanking = z.infer<typeof linhaRankingSchema>;

export const relatorioVendasSchema = z.object({
  de: z.string(),
  ate: z.string(),
  total: z.string(),
  vendas: z.number().int(),
  ticketMedio: z.string(),
  itens: z.string(),
  mediaDiaria: z.string(),
  /** Margem bruta do periodo inteiro. Ausente sem permissao de custo. */
  margem: z.string().nullable().optional(),

  porDia: z.array(z.object({ dia: z.string(), total: z.string(), vendas: z.number().int() })),
  formasPagamento: z.array(
    z.object({ forma: z.string(), total: z.string(), participacao: z.string() }),
  ),
  porLoja: z.array(z.object({ loja: z.string(), total: z.string(), participacao: z.string() })),

  dimensao: dimensaoVendasSchema,
  ranking: z.array(linhaRankingSchema),
});
export type RelatorioVendas = z.infer<typeof relatorioVendasSchema>;
