import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Ambiente } from '../configuracao';
import {
  DOMINIO_CLIENTE,
  DOMINIO_FUNCIONARIO,
  DOMINIO_PLATAFORMA,
  type Dominio,
  type PayloadAcesso,
  type PayloadPlataforma,
} from './dominios';

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

  /*
    Mapa, não ternário. Com dois domínios um `a ? b : c` dava conta; com três,
    o mesmo ternário passa a dizer "quem não é funcionário é cliente" — e um
    token de plataforma seria assinado com o segredo do portal sem nenhum
    erro de compilação. O `Record` obriga o compilador a cobrar cada domínio
    novo, aqui e em todo lugar que decidir por domínio.
  */
  private segredoDe(dominio: Dominio): string {
    const chave: Record<
      Dominio,
      'JWT_FUNCIONARIO_SECRET' | 'JWT_CLIENTE_SECRET' | 'JWT_PLATAFORMA_SECRET'
    > = {
      [DOMINIO_FUNCIONARIO]: 'JWT_FUNCIONARIO_SECRET',
      [DOMINIO_CLIENTE]: 'JWT_CLIENTE_SECRET',
      [DOMINIO_PLATAFORMA]: 'JWT_PLATAFORMA_SECRET',
    };

    return this.config.get(chave[dominio], { infer: true });
  }

  /**
   * `duracaoSegundos` só é informado pela sessão de suporte, que dura mais
   * do que o token comum (30 min contra 15) e não tem refresh nenhum.
   */
  async assinarAcesso(payload: PayloadAcesso, duracaoSegundos?: number): Promise<string> {
    // `aud` já vem no payload, então NÃO se passa `audience` nas opções: o
    // jsonwebtoken recusa a duplicata com "Bad options.audience option".
    // Na verificação o `audience` é usado normalmente — lá ele confere o
    // valor, não o define.
    return this.jwt.signAsync(payload, {
      secret: this.segredoDe(payload.aud),
      expiresIn: duracaoSegundos ?? this.config.get('JWT_ACCESS_TTL_SEGUNDOS', { infer: true }),
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

  /** O token da plataforma dura menos: é o que alcança todas as empresas. */
  async assinarPlataforma(payload: PayloadPlataforma): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.segredoDe(DOMINIO_PLATAFORMA),
      expiresIn: this.config.get('JWT_ACCESS_TTL_SEGUNDOS', { infer: true }),
    });
  }

  async verificarPlataforma(token: string): Promise<PayloadPlataforma> {
    const payload = await this.jwt.verifyAsync<PayloadPlataforma>(token, {
      secret: this.segredoDe(DOMINIO_PLATAFORMA),
      audience: DOMINIO_PLATAFORMA,
    });

    if (payload.aud !== DOMINIO_PLATAFORMA) {
      throw new Error('Audiência do token não confere');
    }

    return payload;
  }

  dominioDoCliente(): Dominio {
    return DOMINIO_CLIENTE;
  }
}
