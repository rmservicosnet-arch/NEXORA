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
  /**
   * `true` quando o local e de OUTRA loja e esta apenas o usa. O dono
   * aparece em `dono`; a mercadoria esta la, nao aqui.
   */
  compartilhado: z.boolean(),
  dono: z.string().nullable(),
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

/**
 * Abrir uma loja.
 *
 * O local padrao de venda nasce junto, e nao depois: e dele que o PDV baixa o
 * estoque. Loja sem ele existe no cadastro e nao vende — o erro so apareceria
 * no balcao, com o cliente esperando.
 */
export const novaLojaSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  /**
   * Compartilhar o estoque de outra loja em vez de abrir um local proprio.
   *
   * Um deposito central atendendo tres lojas e o caso: a loja nova vende dali
   * sem que a mercadoria precise ser transferida.
   */
  compartilharCom: z.string().uuid().optional(),
  /** Sem ele, sai do nome: "Loja Shopping" vira LOJA_SHOPPING. */
  codigo: z
    .string()
    .trim()
    .max(30)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'O codigo aceita letras maiusculas, numeros e _')
    .optional(),
  /** O nome do primeiro local, que ja nasce como padrao de venda. */
  localPadrao: z.string().trim().min(2).max(120).default('Balcao'),
});
export type NovaLoja = z.infer<typeof novaLojaSchema>;

export const alteracaoLojaSchema = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  /**
   * Desativar tira a loja do PDV e dos seletores; o estoque dela continua
   * onde esta. Nao e exclusao — historico de venda aponta para ela.
   */
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});
export type AlteracaoLoja = z.infer<typeof alteracaoLojaSchema>;
