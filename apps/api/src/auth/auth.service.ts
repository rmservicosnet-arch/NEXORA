import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  comEscopo,
  conferirSenha,
  gerarHashSenha,
  type ClienteEmTransacao,
  type Contexto,
  type PrismaClient,
} from '@estoque/db';

import { PRISMA } from '../infra/prisma/prisma.module';
import {
  DOMINIO_CLIENTE,
  DOMINIO_FUNCIONARIO,
  type Canal,
  type Dominio,
  type PayloadAcesso,
  type Principal,
} from './dominios';
import { TokensService } from './tokens.service';

export interface DadosEntrada {
  readonly email: string;
  readonly senha: string;
  readonly canal: Canal;
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface Sessao {
  readonly tokenAcesso: string;
  /** Só é devolvido quando o canal é `app`. No `web` vai em cookie. */
  readonly tokenRefresh: string;
  readonly principal: Principal;
}

/**
 * Hash descartável, usado quando o e-mail não existe.
 *
 * Sem ele, responder "não existe" sem calcular Argon2 tornaria o tempo de
 * resposta diferente do caso "senha errada" — e o tempo vira um oráculo que
 * revela quais e-mails estão cadastrados.
 */
let hashFalso = '';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokensService,
  ) {}

  private async gastarTempoDeHash(senha: string): Promise<void> {
    if (!hashFalso) {
      hashFalso = await gerarHashSenha('senha-inexistente-para-tempo-constante');
    }
    await conferirSenha(hashFalso, senha);
  }

  /**
   * Erro único para todos os casos de falha de login.
   *
   * "E-mail não encontrado", "senha errada" e "usuário inativo" produzem a
   * mesma resposta. Distinguir ajudaria o usuário legítimo um pouco e o
   * atacante muito mais.
   */
  private recusar(): never {
    throw new UnauthorizedException({
      codigo: 'CREDENCIAIS_INVALIDAS',
      mensagem: 'E-mail ou senha incorretos.',
    });
  }

  private async resolverEmpresa(
    dominio: Dominio,
    email: string,
  ): Promise<{ empresaId: string; principalId: string } | null> {
    const credencial = await this.prisma.credencialLogin.findUnique({
      where: {
        dominio_email: {
          dominio: dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
          email: email.trim().toLowerCase(),
        },
      },
    });

    if (!credencial || !credencial.ativo) {
      return null;
    }
    return { empresaId: credencial.empresaId, principalId: credencial.principalId };
  }

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  async entrarFuncionario(dados: DadosEntrada): Promise<Sessao> {
    const alvo = await this.resolverEmpresa(DOMINIO_FUNCIONARIO, dados.email);
    if (!alvo) {
      await this.gastarTempoDeHash(dados.senha);
      this.recusar();
    }

    const contexto: Contexto = { tenantId: alvo.empresaId, principalTipo: 'FUNCIONARIO' };

    const usuario = await comEscopo(this.prisma, contexto, async (tx) =>
      tx.usuario.findUnique({ where: { id: alvo.principalId } }),
    );

    if (!usuario || usuario.status !== 'ATIVO') {
      await this.gastarTempoDeHash(dados.senha);
      this.recusar();
    }

    if (!(await conferirSenha(usuario.senhaHash, dados.senha))) {
      this.recusar();
    }

    const principal = await this.carregarPrincipal({
      sub: usuario.id,
      tid: usuario.tenantId,
      aud: DOMINIO_FUNCIONARIO,
    });

    return this.abrirSessao(principal, dados);
  }

  async entrarCliente(dados: DadosEntrada): Promise<Sessao> {
    const alvo = await this.resolverEmpresa(DOMINIO_CLIENTE, dados.email);
    if (!alvo) {
      await this.gastarTempoDeHash(dados.senha);
      this.recusar();
    }

    const contexto: Contexto = { tenantId: alvo.empresaId, principalTipo: 'CLIENTE' };

    const acesso = await comEscopo(this.prisma, contexto, async (tx) =>
      tx.clienteAcesso.findUnique({ where: { id: alvo.principalId } }),
    );

    if (!acesso || acesso.status !== 'ATIVO') {
      await this.gastarTempoDeHash(dados.senha);
      this.recusar();
    }

    if (!(await conferirSenha(acesso.senhaHash, dados.senha))) {
      this.recusar();
    }

    const principal = await this.carregarPrincipal({
      sub: acesso.id,
      tid: acesso.tenantId,
      cid: acesso.clienteId,
      aud: DOMINIO_CLIENTE,
    });

    return this.abrirSessao(principal, dados);
  }

  // -------------------------------------------------------------------------
  // Principal
  // -------------------------------------------------------------------------

  /**
   * Monta o principal a partir do payload do token.
   *
   * Lê perfis, permissões e vínculos de loja do banco a cada requisição. Ver
   * a justificativa em `dominios.ts`: revogar um perfil precisa ter efeito
   * imediato, não só quando o token expirar.
   */
  async carregarPrincipal(payload: PayloadAcesso): Promise<Principal> {
    const contexto: Contexto = {
      tenantId: payload.tid,
      principalTipo: payload.aud === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
      ...(payload.cid ? { clienteId: payload.cid } : {}),
    };

    if (payload.aud === DOMINIO_CLIENTE) {
      const acesso = await comEscopo(this.prisma, contexto, async (tx) =>
        tx.clienteAcesso.findUnique({ where: { id: payload.sub } }),
      );

      if (!acesso || acesso.status !== 'ATIVO') {
        this.recusar();
      }

      return {
        id: acesso.id,
        dominio: DOMINIO_CLIENTE,
        tenantId: acesso.tenantId,
        clienteId: acesso.clienteId,
        nome: acesso.nome,
        email: acesso.email,
        // O portal tem exatamente uma permissão. Tudo o mais é negado por
        // ausência, não por lista de proibições.
        permissoes: new Set(['portal.acessar']),
        lojaIds: new Set<string>(),
        plataformaAdmin: false,
      };
    }

    const usuario = await comEscopo(this.prisma, contexto, async (tx) =>
      tx.usuario.findUnique({
        where: { id: payload.sub },
        include: {
          perfis: { include: { perfil: { include: { permissoes: true } } } },
          acessosLoja: true,
        },
      }),
    );

    if (!usuario || usuario.status !== 'ATIVO') {
      this.recusar();
    }

    const permissoes = new Set<string>();
    for (const vinculo of usuario.perfis) {
      for (const p of vinculo.perfil.permissoes) {
        permissoes.add(p.permissaoChave);
      }
    }

    return {
      id: usuario.id,
      dominio: DOMINIO_FUNCIONARIO,
      tenantId: usuario.tenantId,
      nome: usuario.nome,
      email: usuario.email,
      permissoes,
      lojaIds: new Set(usuario.acessosLoja.map((a) => a.lojaId)),
      plataformaAdmin: usuario.plataformaAdmin,
    };
  }

  // -------------------------------------------------------------------------
  // Sessão e rotação
  // -------------------------------------------------------------------------

  private async abrirSessao(principal: Principal, dados: DadosEntrada): Promise<Sessao> {
    const contexto = this.contextoDe(principal);
    const familiaId = crypto.randomUUID();

    const tokenRefresh = await comEscopo(this.prisma, contexto, async (tx) =>
      this.criarRefresh(tx, principal, familiaId, dados),
    );

    const tokenAcesso = await this.tokens.assinarAcesso({
      sub: principal.id,
      tid: principal.tenantId,
      ...(principal.clienteId ? { cid: principal.clienteId } : {}),
      aud: principal.dominio,
    });

    await comEscopo(this.prisma, contexto, async (tx) => {
      if (principal.dominio === DOMINIO_FUNCIONARIO) {
        await tx.usuario.update({
          where: { id: principal.id },
          data: { ultimoLoginEm: new Date() },
        });
      } else {
        await tx.clienteAcesso.update({
          where: { id: principal.id },
          data: { ultimoLoginEm: new Date() },
        });
      }
    });

    return { tokenAcesso, tokenRefresh, principal };
  }

  private async criarRefresh(
    tx: ClienteEmTransacao,
    principal: Principal,
    familiaId: string,
    dados: Pick<DadosEntrada, 'ip' | 'userAgent'>,
  ): Promise<string> {
    const aleatorio = this.tokens.gerarRefresh();

    // O tenant vai no começo do token, em texto claro.
    //
    // Não é segredo — o segredo é a parte aleatória. Com ele ali, a renovação
    // consegue abrir o escopo de tenant ANTES de consultar a sessão, que é
    // uma tabela protegida por RLS. A alternativa seria mais uma tabela fora
    // do escopo, e uma já é o limite.
    const token = `${principal.tenantId}.${aleatorio.token}`;
    const hash = this.tokens.hashRefresh(token);

    await tx.sessaoRefresh.create({
      data: {
        tenantId: principal.tenantId,
        principalTipo: principal.dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
        usuarioId: principal.dominio === DOMINIO_FUNCIONARIO ? principal.id : null,
        clienteAcessoId: principal.dominio === DOMINIO_CLIENTE ? principal.id : null,
        tokenHash: hash,
        familiaId,
        expiraEm: this.tokens.expiracaoRefresh(),
        ip: dados.ip ?? null,
        userAgent: dados.userAgent?.slice(0, 255) ?? null,
      },
    });

    return token;
  }

  /**
   * Renova a sessão, rotacionando o refresh token.
   *
   * **Detecção de reuso:** se o token apresentado já foi rotacionado, alguém
   * está usando uma cópia antiga — ou o token vazou. Nesse caso toda a
   * família de sessões é revogada, derrubando tanto o atacante quanto o
   * usuário legítimo. Derrubar os dois é o comportamento correto: é melhor
   * pedir login de novo do que manter uma sessão possivelmente roubada.
   */
  async renovar(tokenApresentado: string, dominio: Dominio, dados: Pick<DadosEntrada, 'ip' | 'userAgent'>): Promise<Sessao> {
    const separador = tokenApresentado.indexOf('.');
    if (separador <= 0) {
      this.recusar();
    }

    const tenantId = tokenApresentado.slice(0, separador);
    const hash = this.tokens.hashRefresh(tokenApresentado);
    const contexto: Contexto = {
      tenantId,
      principalTipo: dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
    };

    const sessao = await comEscopo(this.prisma, contexto, async (tx) =>
      tx.sessaoRefresh.findUnique({ where: { tokenHash: hash } }),
    ).catch(() => null);

    if (!sessao) {
      this.recusar();
    }

    if (sessao.revogadoEm) {
      this.logger.warn(
        `Reuso de refresh token detectado. Família ${sessao.familiaId} revogada inteira.`,
      );
      await comEscopo(this.prisma, contexto, async (tx) =>
        tx.sessaoRefresh.updateMany({
          where: { familiaId: sessao.familiaId, revogadoEm: null },
          data: { revogadoEm: new Date(), motivoRevogacao: 'REUSO_DETECTADO' },
        }),
      );
      this.recusar();
    }

    if (sessao.expiraEm.getTime() < Date.now()) {
      this.recusar();
    }

    const principalId = sessao.usuarioId ?? sessao.clienteAcessoId;
    if (!principalId) {
      this.recusar();
    }

    const principal = await this.carregarPrincipal({
      sub: principalId,
      tid: tenantId,
      aud: dominio,
    });

    const novoToken = await comEscopo(this.prisma, contexto, async (tx) => {
      await tx.sessaoRefresh.update({
        where: { id: sessao.id },
        data: { revogadoEm: new Date(), motivoRevogacao: 'ROTACIONADO' },
      });
      return this.criarRefresh(tx, principal, sessao.familiaId, dados);
    });

    const tokenAcesso = await this.tokens.assinarAcesso({
      sub: principal.id,
      tid: principal.tenantId,
      ...(principal.clienteId ? { cid: principal.clienteId } : {}),
      aud: principal.dominio,
    });

    return { tokenAcesso, tokenRefresh: novoToken, principal };
  }

  /** Encerra a sessão. Revoga a família inteira, não só o token atual. */
  async sair(tokenApresentado: string, dominio: Dominio): Promise<void> {
    const separador = tokenApresentado.indexOf('.');
    if (separador <= 0) {
      return;
    }

    const tenantId = tokenApresentado.slice(0, separador);
    const hash = this.tokens.hashRefresh(tokenApresentado);
    const contexto: Contexto = {
      tenantId,
      principalTipo: dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
    };

    await comEscopo(this.prisma, contexto, async (tx) => {
      const sessao = await tx.sessaoRefresh.findUnique({ where: { tokenHash: hash } });
      if (!sessao) {
        return;
      }
      await tx.sessaoRefresh.updateMany({
        where: { familiaId: sessao.familiaId, revogadoEm: null },
        data: { revogadoEm: new Date(), motivoRevogacao: 'LOGOUT' },
      });
    }).catch(() => undefined);
  }

  contextoDe(principal: Principal): Contexto {
    return {
      tenantId: principal.tenantId,
      principalTipo: principal.dominio === DOMINIO_FUNCIONARIO ? 'FUNCIONARIO' : 'CLIENTE',
      principalId: principal.id,
      ...(principal.clienteId ? { clienteId: principal.clienteId } : {}),
      lojaIds: [...principal.lojaIds],
    };
  }
}
