import { z } from 'zod';

export const esquemaEntrada = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(1, 'Senha é obrigatória'),
  /**
   * `web` guarda o refresh em cookie httpOnly; `app` recebe no corpo e
   * guarda no Keychain/Keystore. Ver `dominios.ts`.
   */
  canal: z.enum(['web', 'app']).default('web'),
  /**
   * `false` faz o refresh virar cookie de sessão: morre ao fechar a janela.
   * É o balcão compartilhado, onde a sessão de 30 dias é um risco.
   */
  manterConectado: z.boolean().default(true),
});

export type EntradaDto = z.infer<typeof esquemaEntrada>;

export const esquemaRenovacao = z.object({
  /** Só no canal `app`. No `web` o token vem do cookie. */
  refreshToken: z.string().optional(),
  canal: z.enum(['web', 'app']).default('web'),
  /**
   * Repetido aqui porque o cookie é reescrito a cada rotação. Sem isto, a
   * primeira renovação devolveria os 30 dias que a pessoa recusou no login.
   */
  manterConectado: z.boolean().default(true),
});

export type RenovacaoDto = z.infer<typeof esquemaRenovacao>;

/**
 * Sair, no canal `app`.
 *
 * O `logout` só lia o cookie. Para o celular isso significava devolver 204 e
 * **não revogar nada**: o refresh seguia válido os 30 dias inteiros depois de
 * a pessoa apertar "Sair". Aparelho perdido era sessão viva.
 *
 * O corpo é opcional para o web continuar funcionando sem mandar nada.
 */
export const esquemaSaida = z.object({
  refreshToken: z.string().optional(),
  canal: z.enum(['web', 'app']).default('web'),
});

export type SaidaDto = z.infer<typeof esquemaSaida>;

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
