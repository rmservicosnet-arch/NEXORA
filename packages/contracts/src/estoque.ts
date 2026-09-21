import { z } from 'zod';

/**
 * Contratos de movimentação de estoque.
 *
 * Quantidade e custo trafegam como **string decimal**, pela mesma razão do
 * preço: `JSON.parse` devolve float e o erro entra antes de qualquer conta.
 *
 * O razão é append-only. Não existe "editar movimento" neste contrato — e não
 * é esquecimento. Corrigir é lançar o contrário, referenciando o original.
 * Ver CLAUDE.md e docs/COST_POLICY.md.
 */

const decimalString = (rotulo: string) =>
  z.string().regex(/^\d+(\.\d+)?$/, `${rotulo} precisa ser um número decimal em texto`);

const quantidadePositiva = decimalString('Quantidade').refine(
  (v) => Number(v) > 0,
  'A quantidade precisa ser maior que zero',
);

export const sentidoMovimentoSchema = z.enum(['ENTRADA', 'SAIDA']);
export type SentidoMovimento = z.infer<typeof sentidoMovimentoSchema>;

export const tipoMovimentoSchema = z.enum([
  'ENTRADA_COMPRA',
  'ENTRADA_DEVOLUCAO_CLIENTE',
  'ENTRADA_TRANSFERENCIA',
  'ENTRADA_AJUSTE',
  'ENTRADA_INVENTARIO',
  'SAIDA_VENDA',
  'SAIDA_DEVOLUCAO_FORNECEDOR',
  'SAIDA_TRANSFERENCIA',
  'SAIDA_AJUSTE',
  'SAIDA_PERDA',
  'SAIDA_AVARIA',
  'SAIDA_CONSUMO',
  'SAIDA_INVENTARIO',
]);
export type TipoMovimento = z.infer<typeof tipoMovimentoSchema>;

export const politicaCustoSchema = z.enum([
  'MEDIA_PONDERADA',
  'CUSTO_REDEFINIDO',
  'CUSTO_HISTORICO',
  'SEM_EFEITO',
]);
export type PoliticaCusto = z.infer<typeof politicaCustoSchema>;

/**
 * Tipos que o operador pode lançar à mão.
 *
 * `SAIDA_VENDA`, `*_TRANSFERENCIA` e `*_INVENTARIO` ficam de fora de
 * propósito: são consequência de uma venda, de uma transferência ou de uma
 * contagem, e lançá-los soltos criaria movimento sem o documento que o
 * explica. Cada um tem a sua rota.
 */
export const tipoEntradaManualSchema = z.enum([
  'ENTRADA_COMPRA',
  'ENTRADA_DEVOLUCAO_CLIENTE',
  'ENTRADA_AJUSTE',
]);
export type TipoEntradaManual = z.infer<typeof tipoEntradaManualSchema>;

export const tipoSaidaManualSchema = z.enum([
  'SAIDA_AJUSTE',
  'SAIDA_PERDA',
  'SAIDA_AVARIA',
  'SAIDA_CONSUMO',
  'SAIDA_DEVOLUCAO_FORNECEDOR',
]);
export type TipoSaidaManual = z.infer<typeof tipoSaidaManualSchema>;

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export const entradaEstoqueSchema = z.object({
  variacaoId: z.string().uuid(),
  /** Conferida pelo guard de escopo e confrontada com o local no servidor. */
  lojaId: z.string().uuid(),
  localId: z.string().uuid(),
  quantidade: quantidadePositiva,
  /** Custo da mercadoria que está entrando. Zero é válido: bonificação. */
  custoUnitario: decimalString('Custo unitário'),
  tipo: tipoEntradaManualSchema.default('ENTRADA_COMPRA'),
  documentoNumero: z.string().trim().max(40).optional(),
  justificativa: z.string().trim().max(400).optional(),
});
export type EntradaEstoque = z.infer<typeof entradaEstoqueSchema>;

export const saidaEstoqueSchema = z.object({
  variacaoId: z.string().uuid(),
  lojaId: z.string().uuid(),
  localId: z.string().uuid(),
  quantidade: quantidadePositiva,
  tipo: tipoSaidaManualSchema,
  /**
   * Obrigatória, e não por burocracia: saída manual tira mercadoria do
   * patrimônio sem venda correspondente. Sem motivo registrado, a diferença
   * aparece no balanço meses depois sem ninguém para explicar.
   */
  justificativa: z.string().trim().min(5, 'Descreva o motivo da saída').max(400),
  documentoNumero: z.string().trim().max(40).optional(),
});
export type SaidaEstoque = z.infer<typeof saidaEstoqueSchema>;

export const transferenciaEstoqueSchema = z
  .object({
    variacaoId: z.string().uuid(),
    lojaOrigemId: z.string().uuid(),
    localOrigemId: z.string().uuid(),
    lojaDestinoId: z.string().uuid(),
    localDestinoId: z.string().uuid(),
    quantidade: quantidadePositiva,
    justificativa: z.string().trim().max(400).optional(),
  })
  .refine(
    (v) => v.localOrigemId !== v.localDestinoId,
    'Origem e destino precisam ser locais diferentes',
  );
export type TransferenciaEstoque = z.infer<typeof transferenciaEstoqueSchema>;

export const contagemEstoqueSchema = z.object({
  variacaoId: z.string().uuid(),
  lojaId: z.string().uuid(),
  localId: z.string().uuid(),
  /** O que foi contado na prateleira. Pode ser zero. */
  quantidadeContada: decimalString('Quantidade contada'),
  justificativa: z.string().trim().max(400).optional(),
});
export type ContagemEstoque = z.infer<typeof contagemEstoqueSchema>;

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const movimentoSchema = z.object({
  id: z.string(),
  criadoEm: z.string(),
  sentido: sentidoMovimentoSchema,
  tipo: tipoMovimentoSchema,
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  localId: z.string(),
  local: z.string(),
  loja: z.string(),
  quantidade: z.string(),
  saldoAnterior: z.string(),
  saldoPosterior: z.string(),
  /** Marca o movimento que deixou — ou manteve — o saldo abaixo de zero. */
  saldoNegativo: z.boolean(),
  justificativa: z.string().nullable(),
  documentoNumero: z.string().nullable(),
  ator: z.string().nullable(),
  /** Presentes só para quem tem `produto.ver_custo`. Ausentes, não zerados. */
  custoUnitario: z.string().optional(),
  custoMedioAntes: z.string().optional(),
  custoMedioDepois: z.string().optional(),
  politicaCusto: politicaCustoSchema.optional(),
});
export type Movimento = z.infer<typeof movimentoSchema>;

/**
 * O que a operação devolve.
 *
 * Inclui o movimento gravado e a posição resultante — a tela precisa das duas
 * coisas, e buscar o saldo de novo depois abriria uma janela em que outro
 * lançamento já mudou o número.
 */
export const resultadoMovimentoSchema = z.object({
  movimento: movimentoSchema,
  saldoPosterior: z.string(),
  custoMedioDepois: z.string().optional(),
  /**
   * Avisos que não impedem a operação mas o operador precisa ver: saldo ficou
   * negativo, saída sem base de custo, entrada que cobriu venda a descoberto.
   */
  avisos: z.array(z.object({ codigo: z.string(), mensagem: z.string() })),
});
export type ResultadoMovimento = z.infer<typeof resultadoMovimentoSchema>;

export const resultadoTransferenciaSchema = z.object({
  saida: movimentoSchema,
  entrada: movimentoSchema,
  avisos: z.array(z.object({ codigo: z.string(), mensagem: z.string() })),
});
export type ResultadoTransferencia = z.infer<typeof resultadoTransferenciaSchema>;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD');

export const filtroMovimentosSchema = z.object({
  variacaoId: z.string().uuid().optional(),
  produtoId: z.string().uuid().optional(),
  localId: z.string().uuid().optional(),
  lojaId: z.string().uuid().optional(),
  tipo: tipoMovimentoSchema.optional(),
  sentido: sentidoMovimentoSchema.optional(),
  /** Só os que deixaram saldo negativo. */
  apenasNegativos: z.coerce.boolean().optional(),
  /*
    Dia do calendário, nunca instante. `z.string()` aceitava qualquer coisa,
    e `new Date('lixo')` vira Invalid Date que o Prisma rejeita com uma pilha
    em vez de uma mensagem. O recorte é por DIA porque é assim que se pergunta:
    "o que entrou entre segunda e sexta".
  */
  de: dia.optional(),
  ate: dia.optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroMovimentos = z.infer<typeof filtroMovimentosSchema>;

export const paginaMovimentosSchema = z.object({
  itens: z.array(movimentoSchema),
  proximoCursor: z.string().nullable(),
});
export type PaginaMovimentos = z.infer<typeof paginaMovimentosSchema>;

/**
 * Busca de variação para movimentar.
 *
 * Por SKU, código de barras ou nome — nessa ordem de precisão. A tela de
 * estoque é usada com leitor na mão: o código de barras precisa cair direto no
 * item certo, sem uma lista intermediária para escolher.
 */
export const buscaVariacaoSchema = z.object({
  termo: z.string().trim().min(1).max(120),
  limite: z.coerce.number().int().min(1).max(50).default(20),
});
export type BuscaVariacao = z.infer<typeof buscaVariacaoSchema>;

export const variacaoParaMovimentoSchema = z.object({
  id: z.string(),
  sku: z.string(),
  codigoBarras: z.string().nullable(),
  descricao: z.string(),
  produtoId: z.string(),
  produto: z.string(),
  imagemPrincipalId: z.string().nullable(),
  saldoTotal: z.string(),
  /** Abaixo disto o item precisa de reposicao. Vai no painel do razao. */
  estoqueMinimo: z.string(),
  saldosPorLocal: z.array(
    z.object({
      localId: z.string(),
      local: z.string(),
      lojaId: z.string(),
      loja: z.string(),
      quantidade: z.string(),
      custoMedio: z.string().optional(),
    }),
  ),
  /** Casou exatamente com o código de barras: pode selecionar sozinho. */
  casouCodigoBarras: z.boolean(),
});
export type VariacaoParaMovimento = z.infer<typeof variacaoParaMovimentoSchema>;

export const localResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  codigo: z.string(),
  lojaId: z.string(),
  loja: z.string(),
  padraoVenda: z.boolean(),
});
export type LocalResumo = z.infer<typeof localResumoSchema>;
