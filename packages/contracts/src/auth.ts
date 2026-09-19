import { z } from 'zod';

/**
 * Contratos de autenticação.
 *
 * Um schema só, consumido pela API para validar a entrada e pela web e pelo
 * mobile para tipar a chamada. Quando o contrato muda, os três quebram no
 * `tsc` — que é exatamente onde se quer descobrir.
 */

export const canalSchema = z.enum(['web', 'app']);
export type Canal = z.infer<typeof canalSchema>;

export const dominioSchema = z.enum(['funcionario', 'cliente']);
export type Dominio = z.infer<typeof dominioSchema>;

export const entradaSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(1, 'Senha é obrigatória'),
  canal: canalSchema.default('web'),
});
export type Entrada = z.infer<typeof entradaSchema>;

export const renovacaoSchema = z.object({
  refreshToken: z.string().optional(),
  canal: canalSchema.default('web'),
});
export type Renovacao = z.infer<typeof renovacaoSchema>;

export const usuarioSessaoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string(),
  dominio: dominioSchema,
  permissoes: z.array(z.string()),
  lojaIds: z.array(z.string()),
});
export type UsuarioSessao = z.infer<typeof usuarioSessaoSchema>;

export const sessaoSchema = z.object({
  tokenAcesso: z.string(),
  /** Só vem preenchido no canal `app`. No `web` viaja em cookie httpOnly. */
  tokenRefresh: z.string().optional(),
  usuario: usuarioSessaoSchema,
});
export type Sessao = z.infer<typeof sessaoSchema>;

/**
 * Erro da API, em formato estável.
 *
 * `codigo` é contrato e não muda; `mensagem` é para humano e pode mudar.
 * O aplicativo decide o que fazer pelo código. Ver docs/MOBILE.md §4.
 */
export const erroApiSchema = z.object({
  codigo: z.string(),
  mensagem: z.string(),
  campos: z
    .array(z.object({ campo: z.string(), problema: z.string() }))
    .optional(),
  permissoesFaltantes: z.array(z.string()).optional(),
});
export type ErroApi = z.infer<typeof erroApiSchema>;
