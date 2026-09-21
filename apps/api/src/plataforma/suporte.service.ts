import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { SessaoSuporte } from '@estoque/contracts';
import { type Contexto, type PrismaClient } from '@estoque/db';

import { DOMINIO_FUNCIONARIO, type PrincipalPlataforma } from '../auth/dominios';
import { TokensService } from '../auth/tokens.service';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Entrar numa empresa para dar suporte.
 *
 * É a ação mais perigosa da plataforma: as outras mexem em situação e senha,
 * esta dá acesso a DADO. O desenho a cerca por quatro lados:
 *
 *  1. **Motivo escrito**, com o caso concreto. "Investigar" não passa no
 *     schema; o mínimo de 15 caracteres existe para isso.
 *  2. **Sessão curta** — 30 minutos, contra os 15 minutos do token comum e
 *     os dias do refresh. E não há refresh: acabou, entra de novo, com outro
 *     motivo.
 *  3. **Registro no `audit_log` DA EMPRESA**, não num diário da plataforma.
 *     Trilha que só o visitante lê não é trilha.
 *  4. **Em nome de um administrador real** dela, marcado. O token carrega
 *     `sup` com o id de quem da plataforma o abriu — e a sessão da empresa
 *     devolve isso, para a tela poder dizer em voz alta que quem está ali
 *     não é o dono da conta.
 *
 * Empresa suspensa não recebe suporte: se o login de todo mundo está
 * bloqueado, abrir uma porta lateral desfaria a suspensão para quem tem a
 * chave da plataforma.
 */

/** 30 minutos. Cabe uma investigação, não um expediente. */
const DURACAO_SUPORTE_SEGUNDOS = 30 * 60;

@Injectable()
export class SuporteService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async entrar(
    empresaId: string,
    motivo: string,
    quem: PrincipalPlataforma,
  ): Promise<SessaoSuporte> {
    const empresas = await this.prisma.$queryRaw<
      { id: string; nome: string; slug: string; status: string }[]
    >`SELECT id, nome, slug, status FROM plataforma_empresa(${empresaId}::uuid)`;

    const empresa = empresas[0];
    if (!empresa) {
      throw new NotFoundException({
        codigo: 'EMPRESA_NAO_ENCONTRADA',
        mensagem: 'Esta empresa não existe.',
      });
    }

    if (empresa.status !== 'ATIVO') {
      throw new ConflictException({
        codigo: 'EMPRESA_SUSPENSA',
        mensagem:
          'Esta empresa está suspensa e o login dela está bloqueado. ' +
          'Reative antes de entrar — entrar assim desfaria a suspensão só para quem tem a chave da plataforma.',
      });
    }

    const admins = await this.prisma.$queryRaw<
      { id: string; nome: string }[]
    >`SELECT id, nome FROM plataforma_admins_da_empresa(${empresaId}::uuid)`;

    const admin = admins[0];
    if (!admin) {
      throw new ForbiddenException({
        codigo: 'EMPRESA_SEM_ADMIN',
        mensagem:
          'Esta empresa não tem nenhum administrador ativo, e a sessão de suporte é aberta em nome de um. ' +
          'Redefina o acesso de alguém antes.',
      });
    }

    const contexto: Contexto = {
      tenantId: empresaId,
      principalTipo: 'PLATAFORMA',
      principalId: quem.id,
    };

    const tokenAcesso = await this.tokens.assinarAcesso(
      { sub: admin.id, tid: empresaId, aud: DOMINIO_FUNCIONARIO, sup: quem.id },
      DURACAO_SUPORTE_SEGUNDOS,
    );

    const expiraEm = new Date(Date.now() + DURACAO_SUPORTE_SEGUNDOS * 1000);

    await this.auditoria.registrar({
      contexto,
      acao: 'PLATAFORMA_ENTROU',
      entidade: 'tenant',
      entidadeId: empresaId,
      atorNome: quem.nome,
      motivo,
      depois: {
        comoUsuario: admin.nome,
        duracaoMinutos: DURACAO_SUPORTE_SEGUNDOS / 60,
        expiraEm: expiraEm.toISOString(),
      },
    });

    return {
      tokenAcesso,
      expiraEm: expiraEm.toISOString(),
      empresa: { id: empresa.id, nome: empresa.nome, slug: empresa.slug },
      comoUsuario: { id: admin.id, nome: admin.nome },
    };
  }
}
