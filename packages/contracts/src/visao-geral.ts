import { z } from 'zod';

/**
 * A visao geral: os numeros que fazem alguem agir sem ser chamado.
 *
 * Nao e um relatorio. Relatorio se abre com uma pergunta na cabeca; esta tela
 * abre sozinha e precisa dizer, em tres segundos, se ha algo errado hoje.
 */

export const pontoDoDiaSchema = z.object({
  /** ISO (AAAA-MM-DD), para a tela formatar como quiser. */
  dia: z.string(),
  total: z.string(),
  vendas: z.number().int(),
});
export type PontoDoDia = z.infer<typeof pontoDoDiaSchema>;

export const vendaRecenteSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  cliente: z.string().nullable(),
  vendedor: z.string(),
  /** A forma de maior valor. Venda com duas formas mostra a que pesou mais. */
  pagamento: z.string().nullable(),
  total: z.string(),
  concluidaEm: z.string().nullable(),
});
export type VendaRecente = z.infer<typeof vendaRecenteSchema>;

export const itemNegativoSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  local: z.string(),
  loja: z.string(),
  saldo: z.string(),
  /** Desde quando esta negativo. `null` quando nao se sabe. */
  desde: z.string().nullable(),
});
export type ItemNegativo = z.infer<typeof itemNegativoSchema>;

export const visaoGeralSchema = z.object({
  vendasHoje: z.string(),
  vendasOntem: z.string(),
  /** Media do periodo, nao do dia: um dia fraco nao derruba a referencia. */
  ticketMedio: z.string(),
  ticketMedioSemanaAnterior: z.string(),

  /** Serie dos ultimos dias, do mais antigo ao mais recente. */
  porDia: z.array(pontoDoDiaSchema),
  totalDoPeriodo: z.string(),

  /** Variacoes abaixo do estoque minimo — o que repor. */
  abaixoDoMinimo: z.number().int(),
  /** Variacoes em saldo negativo, e em quantas lojas. */
  variacoesNegativas: z.number().int(),
  lojasComNegativo: z.number().int(),

  negativos: z.array(itemNegativoSchema),
  ultimasVendas: z.array(vendaRecenteSchema),
});
export type VisaoGeral = z.infer<typeof visaoGeralSchema>;

export const filtroVisaoGeralSchema = z.object({
  lojaId: z.string().uuid().optional(),
  /** Quantos dias a serie cobre. */
  dias: z.coerce.number().int().min(7).max(90).default(14),
});
export type FiltroVisaoGeral = z.infer<typeof filtroVisaoGeralSchema>;
