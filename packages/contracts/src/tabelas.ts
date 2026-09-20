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
  /** Quantas variacoes ATIVAS ainda nao tem preco aqui. E a fila de trabalho. */
  semPreco: z.number().int(),
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

// ---------------------------------------------------------------------------
// Os precos DENTRO da tabela
// ---------------------------------------------------------------------------

/**
 * Uma variacao vista de dentro de uma tabela de preco.
 *
 * `preco` nulo e o dado que importa: e exatamente o item que some do catalogo
 * de quem compra por esta tabela. O custo so vem para quem tem
 * `produto.ver_custo` — e sem ele a margem tambem nao vem, porque seria
 * possivel deduzi-lo a partir dela.
 */
export const itemDaTabelaSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  categoria: z.string().nullable(),
  /** Preco nesta tabela. `null` = sem preco. */
  preco: z.string().nullable(),
  /** Preco na tabela padrao, para comparar. `null` quando nem ela tem. */
  precoPadrao: z.string().nullable(),
  custoMedio: z.string().optional(),
  /** `(preco - custo) / preco`, em pontos percentuais. So com custo a vista. */
  margem: z.string().nullable().optional(),
});
export type ItemDaTabela = z.infer<typeof itemDaTabelaSchema>;

export const filtroItensTabelaSchema = z.object({
  busca: z.string().trim().max(120).optional(),
  categoriaId: z.string().uuid().optional(),
  /** So os que nao tem preco nesta tabela — a fila de trabalho. */
  semPreco: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroItensTabela = z.infer<typeof filtroItensTabelaSchema>;

export const paginaItensTabelaSchema = z.object({
  tabela: tabelaPrecoSchema,
  itens: z.array(itemDaTabelaSchema),
  proximoCursor: z.string().nullable(),
  /**
   * Quantas variacoes ativas existem, e quantas estao sem preco aqui.
   *
   * Descrevem a TABELA inteira: o cabecalho fala dela, nao do recorte.
   */
  total: z.number().int(),
  semPreco: z.number().int(),
  /**
   * Quantas linhas o recorte atual tem — com busca, categoria e "so sem
   * preco" aplicados.
   *
   * Existe separado de `total` porque o rodape conta o que a LISTA mostra.
   * Enquanto era `total`, filtrar por uma categoria de 12 itens mantinha
   * "Exibindo 12 de 3888": o numero convidava a procurar 3876 linhas que o
   * filtro tinha acabado de excluir.
   */
  totalFiltrado: z.number().int(),
  /** Media das margens dos itens COM preco. `null` sem acesso ao custo. */
  margemMedia: z.string().nullable(),
});
export type PaginaItensTabela = z.infer<typeof paginaItensTabelaSchema>;

export const gravacaoPrecosTabelaSchema = z.object({
  precos: z
    .array(
      z.object({
        variacaoId: z.string().uuid(),
        /** `null` remove o preco — e tira o item do catalogo desta tabela. */
        preco: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, 'Preco precisa ser um valor em reais')
          .nullable(),
      }),
    )
    .min(1)
    .max(500),
});
export type GravacaoPrecosTabela = z.infer<typeof gravacaoPrecosTabelaSchema>;
