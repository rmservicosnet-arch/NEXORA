import { z } from 'zod';

/**
 * Contratos de produto.
 *
 * Valores monetários trafegam como **string decimal**, nunca como `number`.
 * `JSON.parse('{"preco": 489.90}')` devolve um `float` — e o erro entra no
 * sistema já no transporte, antes de qualquer conta. Ver ARCHITECTURE §7.
 */

const decimalString = (rotulo: string) =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, `${rotulo} precisa ser um número decimal em texto`);

export const statusProdutoSchema = z.enum(['RASCUNHO', 'ATIVO', 'INATIVO']);
export type StatusProduto = z.infer<typeof statusProdutoSchema>;

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

export const filtroProdutosSchema = z.object({
  busca: z.string().trim().max(120).optional(),
  status: statusProdutoSchema.optional(),
  categoriaId: z.string().uuid().optional(),
  marcaId: z.string().uuid().optional(),
  /** Só produtos com alguma variação em saldo negativo. */
  apenasDivergencia: z.coerce.boolean().optional(),
  /** Paginação por cursor: id do último item da página anterior. */
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});
export type FiltroProdutos = z.infer<typeof filtroProdutosSchema>;

export const produtoListaSchema = z.object({
  id: z.string(),
  skuBase: z.string(),
  nome: z.string(),
  status: statusProdutoSchema,
  categoria: z.string().nullable(),
  marca: z.string().nullable(),
  totalVariacoes: z.number().int(),
  totalFotos: z.number().int(),
  /** Id da capa, para a miniatura da listagem. `null` = produto sem foto. */
  imagemPrincipalId: z.string().nullable(),
  publicadoNoCatalogo: z.boolean(),
  /** Menor preço da tabela padrão entre as variações. */
  precoMinimo: z.string().nullable(),
  saldoTotal: z.string(),
  temSaldoNegativo: z.boolean(),
  /**
   * Só vem para quem tem `produto.ver_custo`.
   *
   * **Ausente, não nulo, não zerado.** Esconder a coluna no front e mandar o
   * valor no JSON é o mesmo que não ter permissão nenhuma.
   * Ver docs/REPORTS.md §6.
   *
   * `custoMedio` é anulável **dentro** da permissão: `null` significa "você
   * pode ver, mas não há custo médio" — saldo zero, e divisão por zero não
   * existe. Ausência e `null` dizem coisas diferentes de propósito; colapsar
   * as duas faria o relatório confundir "sem direito" com "sem estoque".
   */
  custoMedio: z.string().nullable().optional(),
  valorEstoque: z.string().optional(),
});
export type ProdutoLista = z.infer<typeof produtoListaSchema>;

export const paginaProdutosSchema = z.object({
  itens: z.array(produtoListaSchema),
  proximoCursor: z.string().nullable(),
  /** Quantos itens a empresa tem no filtro atual, para o rodapé. */
  total: z.number().int(),
});
export type PaginaProdutos = z.infer<typeof paginaProdutosSchema>;

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

export const opcaoSchema = z.object({ id: z.string(), nome: z.string() });
export type Opcao = z.infer<typeof opcaoSchema>;

const opcaoOuNulo = opcaoSchema.nullable();

export const saldoPorLocalSchema = z.object({
  localId: z.string(),
  local: z.string(),
  lojaId: z.string(),
  loja: z.string(),
  quantidade: z.string(),
  /** Mesma regra de `custoMedio` abaixo: ausente = sem permissão. */
  custoMedio: z.string().optional(),
});
export type SaldoPorLocal = z.infer<typeof saldoPorLocalSchema>;

export const variacaoDetalheSchema = z.object({
  id: z.string(),
  sku: z.string(),
  descricao: z.string(),
  codigoBarras: z.string().nullable(),
  estoqueMinimo: z.string(),
  status: z.enum(['ATIVO', 'INATIVO']),
  precoPadrao: z.string().nullable(),
  saldo: z.string(),
  /** `true` quando o saldo está abaixo do mínimo configurado. */
  abaixoDoMinimo: z.boolean(),
  /**
   * Nulo quando não há saldo: o custo médio é valor ÷ saldo, e essa divisão
   * não existe. Ausente quando falta `produto.ver_custo`.
   */
  custoMedio: z.string().nullable().optional(),
  saldosPorLocal: z.array(saldoPorLocalSchema),
});
export type VariacaoDetalhe = z.infer<typeof variacaoDetalheSchema>;

export const produtoDetalheSchema = z.object({
  id: z.string(),
  skuBase: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  unidade: z.string(),
  status: statusProdutoSchema,
  publicadoNoCatalogo: z.boolean(),
  categoria: opcaoOuNulo,
  marca: opcaoOuNulo,
  totalFotos: z.number().int(),
  imagemPrincipalId: z.string().nullable(),
  saldoTotal: z.string(),
  temSaldoNegativo: z.boolean(),
  valorEstoque: z.string().optional(),
  variacoes: z.array(variacaoDetalheSchema),
});
export type ProdutoDetalhe = z.infer<typeof produtoDetalheSchema>;

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export const novaVariacaoSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/i, 'SKU aceita letras, números e hífen'),
  descricao: z.string().trim().min(1).max(160),
  codigoBarras: z.string().trim().max(60).optional(),
  estoqueMinimo: decimalString('Estoque mínimo').default('0'),
  /** Preço na tabela padrão. As demais tabelas são derivadas depois. */
  precoPadrao: decimalString('Preço'),
});
export type NovaVariacao = z.infer<typeof novaVariacaoSchema>;

export const novoProdutoSchema = z.object({
  skuBase: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/i, 'SKU base aceita letras, números e hífen'),
  nome: z.string().trim().min(2).max(180),
  descricao: z.string().trim().max(4000).optional(),
  categoriaId: z.string().uuid().optional(),
  marcaId: z.string().uuid().optional(),
  unidade: z.string().trim().max(6).default('UN'),
  variacoes: z
    .array(novaVariacaoSchema)
    .min(1, 'Um produto precisa de ao menos uma variação')
    .max(60),
});
export type NovoProduto = z.infer<typeof novoProdutoSchema>;

export const alteracaoProdutoSchema = z.object({
  nome: z.string().trim().min(2).max(180).optional(),
  descricao: z.string().trim().max(4000).optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  marcaId: z.string().uuid().nullable().optional(),
  status: statusProdutoSchema.optional(),
  publicadoNoCatalogo: z.boolean().optional(),
});
export type AlteracaoProduto = z.infer<typeof alteracaoProdutoSchema>;

// ---------------------------------------------------------------------------
// Apoio aos formulários
// ---------------------------------------------------------------------------

export const apoioProdutoSchema = z.object({
  categorias: z.array(opcaoSchema),
  marcas: z.array(opcaoSchema),
});
export type ApoioProduto = z.infer<typeof apoioProdutoSchema>;
