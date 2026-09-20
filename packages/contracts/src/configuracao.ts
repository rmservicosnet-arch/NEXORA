import { z } from 'zod';

/**
 * A configuracao da empresa.
 *
 * Uma linha por tenant. Todos estes campos existiam no banco e o sistema lia
 * seis deles; NENHUM era editavel pela aplicacao. `modoCheckout` decidia se o
 * carrinho do cliente vira venda ou pedido, `prazoReservaHoras` decidia
 * quando o estoque reservado e liberado — e so o seed os definia.
 */

export const modoCheckoutConfigSchema = z.enum(['PEDIDO_COM_CONFIRMACAO', 'PAGAMENTO_IMEDIATO']);
export const momentoCobrancaSchema = z.enum(['NA_CONFIRMACAO', 'NO_FATURAMENTO']);
export const modoCaixaSchema = z.enum(['POR_OPERADOR', 'COMPARTILHADO_POR_LOJA']);

export type MomentoCobranca = z.infer<typeof momentoCobrancaSchema>;
export type ModoCaixa = z.infer<typeof modoCaixaSchema>;

export const configuracaoEmpresaSchema = z.object({
  /** O carrinho do CLIENTE. Nunca o PDV, que e sempre venda imediata. */
  modoCheckout: modoCheckoutConfigSchema,
  momentoCobranca: momentoCobrancaSchema,

  /** Prazo do preco congelado no pedido. */
  validadePedidoHoras: z.number().int(),
  /** Prazo da reserva criada na confirmacao, antes de liberar o estoque. */
  prazoReservaHoras: z.number().int(),

  permitirSaldoNegativo: z.boolean(),
  exigirAceiteAumento: z.boolean(),
  modoCaixa: modoCaixaSchema,
  pushDetalhado: z.boolean(),

  fusoHorario: z.string(),
  moeda: z.string(),
  alteradoEm: z.string(),

  /**
   * Quais campos ainda NAO tem efeito nenhum no sistema.
   *
   * Existem no banco, sao gravaveis, e nenhum codigo os consulta. A tela
   * mostra e desabilita: oferecer uma chave que nao faz nada e pior do que
   * nao oferecer — a pessoa configura, confia, e o comportamento nao muda.
   */
  semEfeito: z.array(z.string()),
});
export type ConfiguracaoEmpresa = z.infer<typeof configuracaoEmpresaSchema>;

export const alteracaoConfiguracaoSchema = z.object({
  modoCheckout: modoCheckoutConfigSchema.optional(),
  momentoCobranca: momentoCobrancaSchema.optional(),
  validadePedidoHoras: z.number().int().min(1).max(8760).optional(),
  prazoReservaHoras: z.number().int().min(1).max(8760).optional(),
  permitirSaldoNegativo: z.boolean().optional(),
  exigirAceiteAumento: z.boolean().optional(),
  modoCaixa: modoCaixaSchema.optional(),
  pushDetalhado: z.boolean().optional(),
  fusoHorario: z.string().trim().min(3).max(64).optional(),
});
export type AlteracaoConfiguracao = z.infer<typeof alteracaoConfiguracaoSchema>;
