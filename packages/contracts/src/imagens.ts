import { z } from 'zod';

/**
 * Contratos das imagens de produto.
 *
 * O fluxo é de três passos — autorizar, enviar, confirmar — e está descrito em
 * docs/MEDIA.md §4. O binário não passa pela API de negócio.
 */

export const tipoImagemSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type TipoImagemAceito = z.infer<typeof tipoImagemSchema>;

export const statusImagemSchema = z.enum(['PROCESSANDO', 'PRONTA', 'FALHA']);
export type StatusImagem = z.infer<typeof statusImagemSchema>;

export const pedidoDeEnvioSchema = z.object({
  tipo: tipoImagemSchema,
  /**
   * Tamanho declarado, conferido de novo na confirmação.
   *
   * Vale a pena conferir agora mesmo sendo uma declaração: recusar 40 MB antes
   * do envio poupa a viagem inteira em conexão ruim de loja.
   */
  bytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, 'A imagem precisa ter no máximo 10 MB'),
  /** NULL = foto do produto. Preenchido = foto daquela variação. */
  variacaoId: z.string().uuid().optional(),
  textoAlternativo: z.string().trim().max(255).optional(),
});
export type PedidoDeEnvio = z.infer<typeof pedidoDeEnvioSchema>;

export const destinoDeEnvioSchema = z.object({
  url: z.string(),
  metodo: z.literal('PUT'),
  cabecalhos: z.record(z.string(), z.string()),
  expiraEm: z.string(),
});
export type DestinoDeEnvio = z.infer<typeof destinoDeEnvioSchema>;

export const autorizacaoDeEnvioSchema = z.object({
  imagemId: z.string(),
  envio: destinoDeEnvioSchema,
});
export type AutorizacaoDeEnvio = z.infer<typeof autorizacaoDeEnvioSchema>;

export const imagemProdutoSchema = z.object({
  id: z.string(),
  variacaoId: z.string().nullable(),
  ordem: z.number().int(),
  principal: z.boolean(),
  textoAlternativo: z.string(),
  largura: z.number().int().nullable(),
  altura: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  status: statusImagemSchema,
  /** Caminho na própria API. Vida curta fica para o driver S3. */
  url: z.string(),
});
export type ImagemProduto = z.infer<typeof imagemProdutoSchema>;

export const alteracaoImagemSchema = z
  .object({
    principal: z.literal(true).optional(),
    ordem: z.number().int().min(0).max(999).optional(),
    textoAlternativo: z.string().trim().max(255).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo para alterar');
export type AlteracaoImagem = z.infer<typeof alteracaoImagemSchema>;

/** Até 8 fotos por produto, mais 1 por variação. docs/MEDIA.md §6. */
export const LIMITE_FOTOS_PRODUTO = 8;
