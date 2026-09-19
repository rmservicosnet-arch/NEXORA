/**
 * Hash de senha com Argon2id.
 *
 * Parâmetros conforme a recomendação mínima do OWASP para Argon2id:
 * memória 19 MiB, 2 iterações, paralelismo 1. Ver docs/ARCHITECTURE.md §6.
 *
 * Mora neste pacote porque o seed e a API precisam dos MESMOS parâmetros, e
 * duplicá-los seria criar duas políticas de senha que divergem no primeiro
 * ajuste. Se a API crescer um módulo de autenticação próprio, isto se muda
 * para lá — mas continua sendo uma definição só.
 *
 * `@node-rs/argon2` em vez de `argon2`: traz binário pré-compilado para
 * Windows, Linux e macOS. O pacote `argon2` exige compilador C na máquina de
 * quem instala, o que quebra o `npm install` de quem só quer rodar o projeto.
 */

import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id. O enum do pacote é `const enum`, que não sobrevive a
 * `isolatedModules` — o valor literal evita o problema sem mudar nada.
 */
const ARGON2ID = 2;

export const PARAMETROS_SENHA = {
  algorithm: ARGON2ID,
  /** 19 MiB. Custo de memória é o que torna ataque com GPU caro. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Mínimo aceito. Comprimento importa mais que caractere especial. */
export const TAMANHO_MINIMO_SENHA = 10;

export class SenhaFracaError extends Error {
  readonly codigo = 'SENHA_FRACA';

  constructor() {
    super(`A senha precisa ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
    this.name = 'SenhaFracaError';
  }
}

export async function gerarHashSenha(senha: string): Promise<string> {
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    throw new SenhaFracaError();
  }
  return hash(senha, PARAMETROS_SENHA);
}

/**
 * Confere a senha.
 *
 * Nunca lança por senha errada — devolve `false`. Um erro aqui seria
 * indistinguível de "usuário não existe" para quem lê o código, e é
 * justamente essa distinção que não deve existir na resposta do login.
 */
export async function conferirSenha(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha, PARAMETROS_SENHA);
  } catch {
    return false;
  }
}
