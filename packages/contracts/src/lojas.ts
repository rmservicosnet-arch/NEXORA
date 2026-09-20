import { z } from 'zod';

export const lojaResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  codigo: z.string(),
  locais: z.number().int().nonnegative(),
});

export type LojaResumo = z.infer<typeof lojaResumoSchema>;

/**
 * A loja como a tela de cadastro a mostra.
 *
 * O local PADRAO DE VENDA vem marcado porque e dele que o PDV baixa o
 * estoque: sem ele a venda nao sabe de onde tirar a mercadoria, e o erro so
 * aparece no balcao, com o cliente esperando.
 */
export const localDaLojaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  codigo: z.string(),
  padraoVenda: z.boolean(),
  /** Quantas variacoes tem saldo diferente de zero aqui. */
  itens: z.number().int(),
});
export type LocalDaLoja = z.infer<typeof localDaLojaSchema>;

export const lojaPainelSchema = z.object({
  id: z.string(),
  nome: z.string(),
  codigo: z.string(),
  status: z.enum(['ATIVO', 'INATIVO']),
  locais: z.array(localDaLojaSchema),
  /** `null` = nenhum caixa aberto agora. */
  caixaAberto: z.number().int().nullable(),
  vendasHoje: z.string(),
  /** Variacoes com saldo abaixo de zero nesta loja. */
  variacoesNegativas: z.number().int(),
});
export type LojaPainel = z.infer<typeof lojaPainelSchema>;
