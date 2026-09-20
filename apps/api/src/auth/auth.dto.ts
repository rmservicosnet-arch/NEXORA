import { z } from 'zod';

export const esquemaEntrada = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(1, 'Senha é obrigatória'),
  /**
   * `web` guarda o refresh em cookie httpOnly; `app` recebe no corpo e
   * guarda no Keychain/Keystore. Ver `dominios.ts`.
   */
  canal: z.enum(['web', 'app']).default('web'),
});

export type EntradaDto = z.infer<typeof esquemaEntrada>;

export const esquemaRenovacao = z.object({
  /** Só no canal `app`. No `web` o token vem do cookie. */
  refreshToken: z.string().optional(),
  canal: z.enum(['web', 'app']).default('web'),
});

export type RenovacaoDto = z.infer<typeof esquemaRenovacao>;

/**
 * Troca de senha pelo próprio dono.
 *
 * Exige a senha atual mesmo havendo sessão válida: uma aba esquecida aberta
 * no balcão não pode virar troca de senha por quem passar por ali.
 */
export const esquemaTrocaDeSenha = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual'),
  novaSenha: z.string().min(10, 'A nova senha precisa ter ao menos 10 caracteres'),
});

export type TrocaDeSenhaDto = z.infer<typeof esquemaTrocaDeSenha>;
