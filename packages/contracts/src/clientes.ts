import { z } from 'zod';

/**
 * Contratos do cadastro de cliente.
 *
 * O cadastro e onde o cliente ganha **tabela de preco**. Sem ela ele nao tem
 * catalogo: o portal so mostra item que tem preco na tabela DELE, e sem
 * vinculo nao ha preco nenhum. Ver docs/ORDERS.md §7 e §8.
 *
 * E tambem onde se decide como a compra dele termina (`modoCheckout`) e onde
 * a divida dele vive (`usaCarteira`). Tres perguntas diferentes, mesmo
 * cadastro.
 */

export const modoCheckoutSchema = z.enum(['PEDIDO_COM_CONFIRMACAO', 'PAGAMENTO_IMEDIATO']);
export type ModoCheckout = z.infer<typeof modoCheckoutSchema>;

export const statusClienteSchema = z.enum(['ATIVO', 'INATIVO']);
export type StatusCliente = z.infer<typeof statusClienteSchema>;

export const filtroClientesSchema = z.object({
  busca: z.string().trim().max(120).optional(),
  status: statusClienteSchema.optional(),
  /** So os que nao tem tabela — sao os que enxergam catalogo vazio. */
  semTabela: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiltroClientes = z.infer<typeof filtroClientesSchema>;

export const clienteSchema = z.object({
  id: z.string(),
  nome: z.string(),
  documento: z.string().nullable(),
  email: z.string().nullable(),
  telefone: z.string().nullable(),
  status: statusClienteSchema,

  tabelaPrecoId: z.string().nullable(),
  tabelaPreco: z.string().nullable(),

  /**
   * `null` = segue o padrao da empresa.
   *
   * A tela precisa distinguir "herda" de "escolheu isto": uma loja que muda o
   * padrao espera que quem herda acompanhe, e quem foi configurado nao.
   */
  modoCheckout: modoCheckoutSchema.nullable(),
  /** O que a empresa faz quando o cliente nao tem sobreposicao. */
  modoCheckoutEfetivo: modoCheckoutSchema,

  usaCarteira: z.boolean(),
  temCarteira: z.boolean(),
  /** Quantos acessos ao portal este cadastro tem. Zero = nao entra. */
  acessos: z.number().int(),
  criadoEm: z.string(),
});
export type Cliente = z.infer<typeof clienteSchema>;

export const paginaClientesSchema = z.object({
  itens: z.array(clienteSchema),
  proximoCursor: z.string().nullable(),
  total: z.number().int(),
  /** Quantos cadastros ativos estao sem tabela. Vai no aviso da tela. */
  semTabela: z.number().int(),
});
export type PaginaClientes = z.infer<typeof paginaClientesSchema>;

export const novoClienteSchema = z.object({
  nome: z.string().trim().min(2).max(160),
  documento: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(180).optional().or(z.literal('')),
  telefone: z.string().trim().max(30).optional(),
  tabelaPrecoId: z.string().uuid().optional(),
  modoCheckout: modoCheckoutSchema.optional(),
  usaCarteira: z.boolean().default(false),
});
export type NovoCliente = z.infer<typeof novoClienteSchema>;

export const alteracaoClienteSchema = z.object({
  nome: z.string().trim().min(2).max(160).optional(),
  documento: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email().max(180).nullable().optional(),
  telefone: z.string().trim().max(30).nullable().optional(),
  status: statusClienteSchema.optional(),
  /** `null` desvincula — e o cliente deixa de ter catalogo. */
  tabelaPrecoId: z.string().uuid().nullable().optional(),
  /** `null` volta a herdar o padrao da empresa. */
  modoCheckout: modoCheckoutSchema.nullable().optional(),
  usaCarteira: z.boolean().optional(),
});
export type AlteracaoCliente = z.infer<typeof alteracaoClienteSchema>;

export const tabelaPrecoResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  chave: z.string(),
  padrao: z.boolean(),
  /** Quantas variacoes tem preco nesta tabela. Zero = catalogo vazio. */
  itensComPreco: z.number().int(),
});
export type TabelaPrecoResumo = z.infer<typeof tabelaPrecoResumoSchema>;

export const apoioClienteSchema = z.object({
  tabelas: z.array(tabelaPrecoResumoSchema),
  modoCheckoutPadrao: modoCheckoutSchema,
});
export type ApoioCliente = z.infer<typeof apoioClienteSchema>;
