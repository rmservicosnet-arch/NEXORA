import { z } from 'zod';

/**
 * Tabelas de preco.
 *
 * Padrao, Professor, Aluno, Revendedor vieram do seed e nao havia como criar
 * uma quinta, renomear nenhuma nem aposentar as que sobraram. Toda a decisao
 * de "quem paga quanto" dependia de uma lista que so existia no seed.
 */

export const statusTabelaSchema = z.enum(['ATIVO', 'INATIVO']);
export type StatusTabela = z.infer<typeof statusTabelaSchema>;

export const tabelaPrecoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  /** Identificador estavel, em maiusculas. O nome pode mudar; a chave nao. */
  chave: z.string(),
  padrao: z.boolean(),
  status: statusTabelaSchema,
  /** Quantas variacoes tem preco nesta tabela. Zero = catalogo vazio. */
  itensComPreco: z.number().int(),
  /** Quantos cadastros compram por ela. Aposentar uma em uso deixa gente sem catalogo. */
  clientes: z.number().int(),
  criadoEm: z.string(),
});
export type TabelaPreco = z.infer<typeof tabelaPrecoSchema>;

export const novaTabelaPrecoSchema = z.object({
  nome: z.string().trim().min(2).max(80),
  /**
   * Opcional: sem ela, sai do nome. Aceita so letras, numeros e `_` porque e
   * identificador, nao titulo.
   */
  chave: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'A chave aceita letras maiusculas, numeros e _')
    .optional(),
});
export type NovaTabelaPreco = z.infer<typeof novaTabelaPrecoSchema>;

export const alteracaoTabelaPrecoSchema = z.object({
  nome: z.string().trim().min(2).max(80).optional(),
  status: statusTabelaSchema.optional(),
  /** `true` promove esta a padrao — e rebaixa a anterior, na mesma transacao. */
  padrao: z.literal(true).optional(),
});
export type AlteracaoTabelaPreco = z.infer<typeof alteracaoTabelaPrecoSchema>;
