import { randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { conferirSenha, gerarHashSenha, type PrismaClient } from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';
import { DOMINIO_PLATAFORMA, type PrincipalPlataforma } from './dominios';
import { TokensService } from './tokens.service';

/**
 * Autenticação do terceiro domínio: quem administra a PLATAFORMA.
 *
 * Mora em `auth/` e não em `plataforma/` de propósito. O que está aqui é
 * autenticação — a mesma coisa que o serviço ao lado faz para funcionário e
 * cliente, com a mesma rotação de refresh e a mesma revogação por reuso. O
 * que a plataforma PODE FAZER vive em `apps/api/src/plataforma/`, que é onde
 * o lint confina quem cruza empresas.
 *
 * Duas diferenças para os outros dois domínios, e as duas são consequência de
 * não haver empresa:
 *
 *  - não passa por `credencial_login`, cuja única razão de existir é
 *    responder "de qual empresa é este e-mail";
 *  - não abre escopo de tenant em lugar nenhum: `plataforma_admin` e
 *    `plataforma_sessao` não têm `tenant_id` e ficam fora do RLS.
 */

export interface SessaoPlataforma {
  readonly acesso: string;
  readonly refresh: string;
  readonly admin: PrincipalPlataforma;
}

/** Hash descartável, para o tempo de resposta não denunciar e-mail inexistente. */
const SENHA_FALSA = 'senha-que-nunca-confere-existe-so-para-gastar-o-mesmo-tempo';

@Injectable()
export class PlataformaAuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokensService,
  ) {}

  private recusar(): never {
    throw new UnauthorizedException({
      codigo: 'CREDENCIAIS_INVALIDAS',
      mensagem: 'E-mail ou senha incorretos.',
    });
  }

  async entrar(
    email: string,
    senha: string,
    origem: { readonly ip?: string; readonly userAgent?: string },
  ): Promise<SessaoPlataforma> {
    const admin = await this.prisma.plataformaAdmin.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!admin || admin.status !== 'ATIVO') {
      // Gasta o mesmo tempo de um Argon2 real: sem isto, a resposta rápida
      // diria "este e-mail não existe" a quem estivesse medindo.
      await conferirSenha(await gerarHashSenha(SENHA_FALSA), senha);
      this.recusar();
    }

    if (!(await conferirSenha(admin.senhaHash, senha))) {
      this.recusar();
    }

    await this.prisma.plataformaAdmin.update({
      where: { id: admin.id },
      data: { ultimoLoginEm: new Date() },
    });

    return this.abrirSessao(
      { id: admin.id, dominio: DOMINIO_PLATAFORMA, nome: admin.nome, email: admin.email },
      randomUUID(),
      origem,
    );
  }

  /**
   * Rotaciona o refresh.
   *
   * Reuso derruba a família inteira, igual ao domínio de funcionário: um
   * token já rotacionado reaparecendo significa que alguém tem uma cópia.
   */
  async renovar(
    refresh: string,
    origem: { readonly ip?: string; readonly userAgent?: string },
  ): Promise<SessaoPlataforma> {
    const hash = this.tokens.hashRefresh(refresh);
    const sessao = await this.prisma.plataformaSessao.findUnique({
      where: { tokenHash: hash },
      include: { admin: true },
    });

    if (!sessao) {
      throw new UnauthorizedException({
        codigo: 'SESSAO_ENCERRADA',
        mensagem: 'Sua sessão expirou. Entre novamente.',
      });
    }

    if (sessao.revogadoEm) {
      await this.prisma.plataformaSessao.updateMany({
        where: { familiaId: sessao.familiaId, revogadoEm: null },
        data: { revogadoEm: new Date(), motivoRevogacao: 'REUSO_DETECTADO' },
      });
      throw new UnauthorizedException({
        codigo: 'SESSAO_ENCERRADA',
        mensagem: 'Sua sessão expirou. Entre novamente.',
      });
    }

    if (sessao.expiraEm.getTime() <= Date.now() || sessao.admin.status !== 'ATIVO') {
      throw new UnauthorizedException({
        codigo: 'SESSAO_ENCERRADA',
        mensagem: 'Sua sessão expirou. Entre novamente.',
      });
    }

    await this.prisma.plataformaSessao.update({
      where: { id: sessao.id },
      data: { revogadoEm: new Date(), motivoRevogacao: 'ROTACIONADO' },
    });

    return this.abrirSessao(
      {
        id: sessao.admin.id,
        dominio: DOMINIO_PLATAFORMA,
        nome: sessao.admin.nome,
        email: sessao.admin.email,
      },
      sessao.familiaId,
      origem,
    );
  }

  async sair(refresh: string): Promise<void> {
    const hash = this.tokens.hashRefresh(refresh);
    const sessao = await this.prisma.plataformaSessao.findUnique({ where: { tokenHash: hash } });
    if (!sessao) {
      return;
    }
    await this.prisma.plataformaSessao.updateMany({
      where: { familiaId: sessao.familiaId, revogadoEm: null },
      data: { revogadoEm: new Date(), motivoRevogacao: 'SAIDA' },
    });
  }

  /** Relê do banco a cada requisição: desativar tem efeito imediato. */
  async carregarPrincipal(adminId: string): Promise<PrincipalPlataforma> {
    const admin = await this.prisma.plataformaAdmin.findUnique({ where: { id: adminId } });

    if (!admin || admin.status !== 'ATIVO') {
      throw new UnauthorizedException({
        codigo: 'SESSAO_ENCERRADA',
        mensagem: 'Sua sessão expirou. Entre novamente.',
      });
    }

    return {
      id: admin.id,
      dominio: DOMINIO_PLATAFORMA,
      nome: admin.nome,
      email: admin.email,
    };
  }

  private async abrirSessao(
    admin: PrincipalPlataforma,
    familiaId: string,
    origem: { readonly ip?: string; readonly userAgent?: string },
  ): Promise<SessaoPlataforma> {
    const refresh = this.tokens.gerarRefresh();

    await this.prisma.plataformaSessao.create({
      data: {
        adminId: admin.id,
        tokenHash: refresh.hash,
        familiaId,
        expiraEm: this.tokens.expiracaoRefresh(),
        ip: origem.ip ?? null,
        userAgent: origem.userAgent?.slice(0, 255) ?? null,
      },
    });

    const acesso = await this.tokens.assinarPlataforma({
      sub: admin.id,
      aud: DOMINIO_PLATAFORMA,
    });

    return { acesso, refresh: refresh.token, admin };
  }
}
