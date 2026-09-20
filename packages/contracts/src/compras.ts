import { z } from 'zod';

/**
 * Contratos de compra — a entrada de mercadoria COM CUSTO.
 *
 * É o `custoUnitario` daqui que forma o custo médio de cada item, e é contra
 * ele que toda margem e todo valor em estoque são calculados depois. Ver
 * docs/COST_POLICY.md.
 *
 * Quantidade e custo trafegam como **string decimal**, pela mesma razão de
 * sempre: `JSON.parse` devolve float e o erro entra antes de qualquer conta.
 */

const decimalString = (rotulo: string) =>
  z.string().regex(/^\d+(\.\d+)?$/, `${rotulo} precisa ser um número decimal em texto`);

const quantidadePositiva = decimalString('Quantidade').refine(
  (v) => Number(v) > 0,
  'A quantidade precisa ser maior que zero',
);

/**
 * Custo pode ser ZERO, e isso não é descuido.
 *
 * Bonificação e brinde do fornecedor entram sem custo. O que não pode é a
 * conta seguir como se o item tivesse custo — quem lê a margem depois precisa
 * ver "sem custo", não 100%.
 */
const custo = decimalString('Custo unitário');

export const statusCompraSchema = z.enum(['RASCUNHO', 'RECEBIDA', 'ESTORNADA']);
export type StatusCompra = z.infer<typeof statusCompraSchema>;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export const itemCompraSchema = z.object({
  variacaoId: z.string().uuid(),
  quantidade: quantidadePositiva,
  custoUnitario: custo,
});
export type ItemCompra = z.infer<typeof itemCompraSchema>;

export const novaCompraSchema = z.object({
  lojaId: z.string().uuid(),
  /** Destino da mercadoria. Sem ele não há onde a entrada cair. */
  localId: z.string().uuid(),
  fornecedorId: z.string().uuid(),
  numeroNota: z.string().trim().max(40).optional(),
  emitidaEm: z.string().datetime().optional(),
  observacao: z.string().trim().max(400).optional(),
  itens: z.array(itemCompraSchema).max(400).default([]),
});
export type NovaCompra = z.infer<typeof novaCompraSchema>;

export const edicaoCompraSchema = novaCompraSchema.partial().extend({
  itens: z.array(itemCompraSchema).max(400).optional(),
});
export type EdicaoCompra = z.infer<typeof edicaoCompraSchema>;

/**
 * Estorno exige motivo.
 *
 * Desfazer uma compra mexe no custo médio de todos os itens dela. Sem motivo
 * escrito, quem olhar o razão daqui a um mês vê a média mudar duas vezes e
 * não tem como saber por quê.
 */
export const estornoCompraSchema = z.object({
  motivo: z.string().trim().min(5, 'Descreva o motivo do estorno').max(400),
});
export type EstornoCompra = z.infer<typeof estornoCompraSchema>;

export const filtroComprasSchema = z.object({
  status: statusCompraSchema.optional(),
  fornecedorId: z.string().uuid().optional(),
  lojaId: z.string().uuid().optional(),
  termo: z.string().trim().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiltroCompras = z.infer<typeof filtroComprasSchema>;

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const itemCompraResumoSchema = z.object({
  id: z.string(),
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  quantidade: z.string(),
  custoUnitario: z.string(),
  total: z.string(),
  /**
   * Congelados no RECEBIMENTO, nulos antes dele.
   *
   * Uma compra de outubro não reescreve o que esta nota fez com a média em
   * setembro — e é por estes dois números que se audita a conta.
   */
  custoMedioAntes: z.string().nullable(),
  custoMedioDepois: z.string().nullable(),
  /**
   * O saldo do item no local, ANTES desta nota.
   *
   * Só aparece no rascunho, e é o que explica o custo médio que vai sair:
   * saldo zero REDEFINE a média em vez de fazer conta com um passado que não
   * existe, e saldo negativo a preserva até voltar a zero.
   */
  saldoAtual: z.string().optional(),
  custoMedioAtual: z.string().optional(),
});
export type ItemCompraResumo = z.infer<typeof itemCompraResumoSchema>;

export const compraSchema = z.object({
  id: z.string(),
  status: statusCompraSchema,
  lojaId: z.string(),
  loja: z.string(),
  localId: z.string(),
  local: z.string(),
  fornecedorId: z.string(),
  fornecedor: z.string(),
  numeroNota: z.string().nullable(),
  emitidaEm: z.string().nullable(),
  observacao: z.string().nullable(),
  valorTotal: z.string(),
  recebidaEm: z.string().nullable(),
  recebidaPor: z.string().nullable(),
  estornadaEm: z.string().nullable(),
  estornadaPor: z.string().nullable(),
  motivoEstorno: z.string().nullable(),
  criadoEm: z.string(),
  itens: z.array(itemCompraResumoSchema),
});
export type Compra = z.infer<typeof compraSchema>;

export const contagensComprasSchema = z.object({
  /** Tudo. As três somadas fecham com ele. */
  total: z.number().int(),
  rascunhos: z.number().int(),
  recebidas: z.number().int(),
  estornadas: z.number().int(),
});
export type ContagensCompras = z.infer<typeof contagensComprasSchema>;

export const resumoComprasSchema = z.object({
  /** Quantas notas esperam recebimento — mercadoria ainda fora do estoque. */
  aReceber: z.number().int(),
  valorAReceber: z.string(),
  /** O recorte inteiro, não a página. */
  recebidoNoPeriodo: z.string(),
  notasNoPeriodo: z.number().int(),
  /** Variações ativas que nunca tiveram entrada com custo. Margem nula. */
  itensSemCusto: z.number().int(),
  fornecedoresAtivos: z.number().int(),
});
export type ResumoCompras = z.infer<typeof resumoComprasSchema>;

export const paginaComprasSchema = z.object({
  itens: z.array(compraSchema),
  proximoCursor: z.string().nullable(),
  contagens: contagensComprasSchema,
  resumo: resumoComprasSchema,
});
export type PaginaCompras = z.infer<typeof paginaComprasSchema>;

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------

export const fornecedorSchema = z.object({
  id: z.string(),
  nome: z.string(),
  documento: z.string().nullable(),
  email: z.string().nullable(),
  telefone: z.string().nullable(),
  ativo: z.boolean(),
});
export type Fornecedor = z.infer<typeof fornecedorSchema>;

export const novoFornecedorSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome').max(160),
  documento: z.string().trim().max(20).optional(),
  email: z.string().trim().email('E-mail inválido').max(180).optional().or(z.literal('')),
  telefone: z.string().trim().max(30).optional(),
});
export type NovoFornecedor = z.infer<typeof novoFornecedorSchema>;

/**
 * Editar fornecedor — inclusive desativar.
 *
 * Desativar não apaga: o fornecedor aparece em notas recebidas, e apagá-lo
 * deixaria compras órfãs. Ele só some da lista de escolha.
 */
export const alteracaoFornecedorSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome').max(160).optional(),
  documento: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().max(180).nullable().optional(),
  telefone: z.string().trim().max(30).nullable().optional(),
  ativo: z.boolean().optional(),
});
export type AlteracaoFornecedor = z.infer<typeof alteracaoFornecedorSchema>;

// ---------------------------------------------------------------------------
// Busca de item para comprar
// ---------------------------------------------------------------------------

/**
 * Busca própria, não a do PDV.
 *
 * Quem compra precisa do SALDO e do CUSTO no destino — não do preço de venda.
 * Reusar a busca do balcão mostraria o número errado ao lado do campo onde se
 * digita custo, que é exatamente como se troca um pelo outro.
 */
export const buscaItemCompraSchema = z.object({
  termo: z.string().trim().max(120).default(''),
  /** Destino da mercadoria: é o saldo DELE que interessa. */
  localId: z.string().uuid(),
  limite: z.coerce.number().int().min(1).max(30).default(15),
});
export type BuscaItemCompra = z.infer<typeof buscaItemCompraSchema>;

export const itemParaComprarSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  saldoAtual: z.string(),
  custoMedioAtual: z.string(),
  /** Custo da última entrada deste item. É a sugestão honesta de preenchimento. */
  ultimoCusto: z.string().nullable(),
});
export type ItemParaComprar = z.infer<typeof itemParaComprarSchema>;
