import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Ambiente } from '../configuracao';
import { DOMINIO_CLIENTE, DOMINIO_FUNCIONARIO, type Dominio, type PayloadAcesso } from './dominios';

export interface RefreshGerado {
  /** O valor que vai para o cliente. Nunca é persistido. */
  readonly token: string;
  /** SHA-256 do token. É o que fica no banco. */
  readonly hash: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  private segredoDe(dominio: Dominio): string {
    return dominio === DOMINIO_FUNCIONARIO
      ? this.config.get('JWT_FUNCIONARIO_SECRET', { infer: true })
      : this.config.get('JWT_CLIENTE_SECRET', { infer: true });
  }

  async assinarAcesso(payload: PayloadAcesso): Promise<string> {
    // `aud` já vem no payload, então NÃO se passa `audience` nas opções: o
    // jsonwebtoken recusa a duplicata com "Bad options.audience option".
    // Na verificação o `audience` é usado normalmente — lá ele confere o
    // valor, não o define.
    return this.jwt.signAsync(payload, {
      secret: this.segredoDe(payload.aud),
      expiresIn: this.config.get('JWT_ACCESS_TTL_SEGUNDOS', { infer: true }),
    });
  }

  /**
   * Verifica o token **no domínio esperado**.
   *
   * O segredo é escolhido pelo domínio que o guard exige, não pelo que o
   * token declara. Um token de cliente apresentado a uma rota de funcionário
   * falha na assinatura antes de qualquer verificação de audiência — é a
   * diferença entre confiar no token e confiar no servidor.
   */
  async verificarAcesso(token: string, dominioEsperado: Dominio): Promise<PayloadAcesso> {
    const payload = await this.jwt.verifyAsync<PayloadAcesso>(token, {
      secret: this.segredoDe(dominioEsperado),
      audience: dominioEsperado,
    });

    if (payload.aud !== dominioEsperado) {
      throw new Error('Audiência do token não confere');
    }

    return payload;
  }

  /**
   * Gera um refresh token opaco.
   *
   * Opaco, não JWT: ele não precisa carregar informação, precisa ser
   * revogável. E o que vai para o banco é o hash — vazamento do banco não
   * entrega sessão de ninguém.
   */
  gerarRefresh(): RefreshGerado {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  expiracaoRefresh(): Date {
    const dias = this.config.get('REFRESH_TOKEN_TTL_DIAS', { infer: true });
    return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  }

  dominioDoCliente(): Dominio {
    return DOMINIO_CLIENTE;
  }
}
