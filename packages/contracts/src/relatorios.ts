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

// ---------------------------------------------------------------------------
// Giro, cobertura e encalhe
// ---------------------------------------------------------------------------

export const filtroGiroSchema = z.object({
  dias: z.coerce.number().int().min(7).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  /** `parado` inverte a ordem: do que menos girou para o que mais girou. */
  ordem: z.enum(['giro', 'parado']).default('giro'),
  limite: z.coerce.number().int().min(1).max(200).default(60),
});
export type FiltroGiro = z.infer<typeof filtroGiroSchema>;

export const linhaGiroSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  categoria: z.string().nullable(),
  /** Saldo somado dos locais visiveis pelo filtro. */
  saldo: z.string(),
  /** Unidades que SAIRAM por venda no periodo. */
  vendidas: z.string(),
  /** `vendidas / saldo`. Nulo quando nao ha saldo para girar. */
  giro: z.string().nullable(),
  /** Dias que o saldo cobre no ritmo do periodo. Nulo sem venda. */
  cobertura: z.string().nullable(),
  /** Dias desde o ultimo movimento. Nulo quando nunca se moveu. */
  diasParado: z.number().int().nullable(),
  /**
   * `saldo x custo medio`. NAO e "valor parado": o item pode ter girado bem.
   * O que esta parado de fato e o `valorEncalhado` do resumo.
   */
  valorEmEstoque: z.string().optional(),
});
export type LinhaGiro = z.infer<typeof linhaGiroSchema>;

export const relatorioGiroSchema = z.object({
  dias: z.number().int(),
  /** Quantas variacoes nao tiveram NENHUMA saida por venda no periodo. */
  semVenda: z.number().int(),
  /** Quantas nao tiveram movimento nenhum — encalhe de verdade. */
  semMovimento: z.number().int(),
  valorEncalhado: z.string().optional(),
  itens: z.array(linhaGiroSchema),
});
export type RelatorioGiro = z.infer<typeof relatorioGiroSchema>;

// ---------------------------------------------------------------------------
// Transferencias e inventario
// ---------------------------------------------------------------------------

export const filtroMovimentoRelatorioSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroMovimentoRelatorio = z.infer<typeof filtroMovimentoRelatorioSchema>;

export const linhaTransferenciaSchema = z.object({
  id: z.string(),
  em: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  quantidade: z.string(),
  /** A saida SEMPRE tem local. O destino e que pode nao existir ainda. */
  origem: z.string(),
  destino: z.string().nullable(),
  /** `true` quando a saida existe e a entrada ainda nao. */
  emTransito: z.boolean(),
  ator: z.string().nullable(),
});
export type LinhaTransferencia = z.infer<typeof linhaTransferenciaSchema>;

export const relatorioTransferenciasSchema = z.object({
  dias: z.number().int(),
  enviadas: z.number().int(),
  recebidas: z.number().int(),
  emTransito: z.number().int(),
  itens: z.array(linhaTransferenciaSchema),
});
export type RelatorioTransferencias = z.infer<typeof relatorioTransferenciasSchema>;

export const linhaInventarioSchema = z.object({
  id: z.string(),
  em: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  local: z.string(),
  loja: z.string(),
  /** Positiva quando o contado era MAIOR que o sistema. */
  diferenca: z.string(),
  saldoAntes: z.string(),
  saldoDepois: z.string(),
  /** Efeito no patrimonio: `diferenca × custo`. */
  valor: z.string().optional(),
  justificativa: z.string().nullable(),
  ator: z.string().nullable(),
});
export type LinhaInventario = z.infer<typeof linhaInventarioSchema>;

export const relatorioInventarioSchema = z.object({
  dias: z.number().int(),
  contagens: z.number().int(),
  sobras: z.number().int(),
  faltas: z.number().int(),
  efeitoLiquido: z.string().optional(),
  itens: z.array(linhaInventarioSchema),
});
export type RelatorioInventario = z.infer<typeof relatorioInventarioSchema>;

// ---------------------------------------------------------------------------
// Formas de pagamento
// ---------------------------------------------------------------------------

export const filtroFormasSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
});
export type FiltroFormas = z.infer<typeof filtroFormasSchema>;

export const linhaFormaSchema = z.object({
  forma: z.string(),
  total: z.string(),
  /** Participacao no total recebido, em pontos percentuais. */
  participacao: z.string(),
  pagamentos: z.number().int(),
  /** Valor medio de cada pagamento nesta forma. */
  medio: z.string(),
  /** Media ponderada de parcelas. `1.0` em quem nao parcela. */
  parcelasMedias: z.string(),
  /** `true` quando o dinheiro so entra depois da venda. */
  futuro: z.boolean(),
});
export type LinhaForma = z.infer<typeof linhaFormaSchema>;

export const linhaParcelamentoSchema = z.object({
  parcelas: z.number().int(),
  pagamentos: z.number().int(),
  total: z.string(),
  participacao: z.string(),
});
export type LinhaParcelamento = z.infer<typeof linhaParcelamentoSchema>;

export const relatorioFormasSchema = z.object({
  dias: z.number().int(),
  total: z.string(),
  /**
   * O dinheiro que ja esta na mao: dinheiro, PIX, debito, transferencia.
   *
   * Credito fica de FORA, mesmo em uma parcela: o prazo e da adquirente, e
   * este sistema ainda nao registra a data de liquidacao dela.
   */
  imediato: z.string(),
  /** Credito, boleto, prazo e carteira: entra depois da venda. */
  futuro: z.string(),
  formas: z.array(linhaFormaSchema),
  /** So do credito: em quantas vezes a loja vendeu. */
  parcelamento: z.array(linhaParcelamentoSchema),
});
export type RelatorioFormas = z.infer<typeof relatorioFormasSchema>;
