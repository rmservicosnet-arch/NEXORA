import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AlteracaoUsuario,
  ApoioEquipe,
  FiltroUsuarios,
  NovoUsuario,
  PaginaUsuarios,
  Usuario,
  UsuarioCriado,
} from '@estoque/contracts';
import {
  comEscopoAtual,
  exigirContexto,
  gerarHashSenha,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';
import { PerfisService } from './perfis.service';

/**
 * O perfil do portal não se atribui a funcionário.
 *
 * `CLIENTE_PORTAL` carrega só `portal.acessar`, que é a permissão do OUTRO
 * domínio de autenticação (ADR-009). Um funcionário com ele não ganha nada e
 * perde o resto se for o único marcado: entra e não vê tela nenhuma.
 *
 * A tela de cadastro o oferecia porque `apoio` devolvia todos os perfis — uma
 * escolha errada por definição, exibida ao lado das certas, com a descrição
 * "Nunca atribuído a funcionário" logo abaixo. Some da lista E é recusado no
 * servidor: esconder botão não é segurança.
 */
const PERFIL_DO_PORTAL = 'CLIENTE_PORTAL';

/** Sem `0O1lI`: senha provisória é ditada por telefone e copiada à mão. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TAMANHO_PROVISORIA = 14;

function gerarSenhaProvisoria(): string {
  // `randomInt` do `node:crypto`, não `Math.random`: isto é credencial.
  let senha = '';
  for (let i = 0; i < TAMANHO_PROVISORIA; i += 1) {
    senha += ALFABETO[randomInt(ALFABETO.length)];
  }
  return senha;
}

/**
 * A equipe.
 *
 * **A senha nunca é escolhida por quem cria.** O servidor gera, devolve uma
 * única vez e guarda só o hash argon2id. Poder mostrar de novo significaria
 * ter guardado — e quem cadastra não digita senha de terceiro.
 *
 * Usuário e `credencial_login` nascem na MESMA transação. Sem a credencial a
 * senha existe e não autentica: o login não descobre de qual empresa a pessoa
 * é. Já aconteceu com `cliente_acesso`.
 */
@Injectable()
export class UsuariosService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly perfis: PerfisService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async apoio(): Promise<ApoioEquipe> {
    const [perfis, permissoes, lojas] = await Promise.all([
      this.perfis.listar(),
      this.perfis.permissoes(),
      comEscopoAtual(this.prisma, async (tx) =>
        tx.loja.findMany({ where: { status: 'ATIVO' }, orderBy: { nome: 'asc' } }),
      ),
    ]);

    return {
      perfis: perfis.filter((perfil) => perfil.chave !== PERFIL_DO_PORTAL),
      permissoes,
      lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })),
    };
  }

  async listar(filtro: FiltroUsuarios): Promise<PaginaUsuarios> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.perfilId ? { perfis: { some: { perfilId: filtro.perfilId } } } : {}),
        ...(filtro.lojaId ? { acessosLoja: { some: { lojaId: filtro.lojaId } } } : {}),
        ...(filtro.busca
          ? {
              OR: [
                { nome: { contains: filtro.busca, mode: 'insensitive' as const } },
                { email: { contains: filtro.busca, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const linhas = await tx.usuario.findMany({
        where: onde,
        orderBy: { nome: 'asc' },
        include: this.inclusao(),
      });

      /*
        As contagens contam o CONJUNTO do filtro, e a equipe é pequena o
        bastante para não paginar: uma loja com trezentos funcionários ainda
        cabe numa consulta. `inertes` é o número da faixa de aviso — gente que
        entra e não consegue fazer nada.
      */
      const todos = await tx.usuario.findMany({
        where: onde,
        select: {
          status: true,
          _count: { select: { perfis: true, acessosLoja: true } },
        },
      });

      const ativos = todos.filter((u) => u.status === 'ATIVO');

      return {
        itens: linhas.map((u) => this.paraContrato(u)),
        contagens: {
          total: todos.length,
          ativos: ativos.length,
          inativos: todos.length - ativos.length,
          inertes: ativos.filter((u) => u._count.perfis === 0 || u._count.acessosLoja === 0).length,
        },
      };
    });
  }

  async detalhe(id: string): Promise<Usuario> {
    return comEscopoAtual(this.prisma, async (tx) => this.paraContrato(await this.exigir(tx, id)));
  }

  async criar(dados: NovoUsuario, principal: Principal): Promise<UsuarioCriado> {
    const contexto = exigirContexto();
    const senhaProvisoria = gerarSenhaProvisoria();
    const senhaHash = await gerarHashSenha(senhaProvisoria);

    const criado = await comEscopoAtual(this.prisma, async (tx) => {
      const repetido = await tx.usuario.findFirst({
        where: { email: dados.email },
        select: { nome: true },
      });

      if (repetido) {
        throw new ConflictException({
          codigo: 'EMAIL_JA_CADASTRADO',
          mensagem: `${dados.email} já é usado por ${repetido.nome}.`,
        });
      }

      /*
        O índice de `credencial_login` é `(dominio, email)` e é GLOBAL: o mesmo
        e-mail não pode ser funcionário de duas empresas. É limitação conhecida
        (é o que permite a tela de entrada pedir só e-mail e senha), e a
        resposta precisa dizer isso em vez de estourar violação de chave.
      */
      const emUso = await tx.credencialLogin.findFirst({
        where: { dominio: 'FUNCIONARIO', email: dados.email },
        select: { id: true },
      });

      if (emUso) {
        throw new ConflictException({
          codigo: 'EMAIL_EM_USO',
          mensagem: `${dados.email} já é usado como acesso de funcionário. Use outro e-mail.`,
        });
      }

      await this.exigirPerfis(tx, dados.perfilIds);
      await this.exigirLojas(tx, dados.lojaIds);

      const usuario = await tx.usuario.create({
        data: {
          tenantId: contexto.tenantId,
          nome: dados.nome,
          email: dados.email,
          senhaHash,
          perfis: {
            create: dados.perfilIds.map((perfilId) => ({ tenantId: contexto.tenantId, perfilId })),
          },
          acessosLoja: {
            create: dados.lojaIds.map((lojaId) => ({ tenantId: contexto.tenantId, lojaId })),
          },
        },
        select: { id: true },
      });

      // Sem esta linha o usuário existe e não entra.
      await tx.credencialLogin.create({
        data: {
          dominio: 'FUNCIONARIO',
          email: dados.email,
          empresaId: contexto.tenantId,
          principalId: usuario.id,
        },
      });

      return this.paraContrato(await this.exigir(tx, usuario.id));
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'USUARIO_CRIADO',
      entidade: 'usuario',
      entidadeId: criado.id,
      atorNome: principal.nome,
      depois: {
        nome: criado.nome,
        email: criado.email,
        perfis: criado.perfis.map((p) => p.chave),
        lojas: criado.lojas.length,
      },
    });

    return { usuario: criado, senhaProvisoria };
  }

  async alterar(id: string, dados: AlteracaoUsuario, principal: Principal): Promise<Usuario> {
    const contexto = exigirContexto();

    const { antes, depois } = await comEscopoAtual(this.prisma, async (tx) => {
      const atual = this.paraContrato(await this.exigir(tx, id));

      if (dados.perfilIds) {
        await this.exigirPerfis(tx, dados.perfilIds);
        await tx.usuarioPerfil.deleteMany({ where: { usuarioId: id } });
        await tx.usuarioPerfil.createMany({
          data: dados.perfilIds.map((perfilId) => ({
            tenantId: contexto.tenantId,
            usuarioId: id,
            perfilId,
          })),
        });
      }

      if (dados.lojaIds) {
        await this.exigirLojas(tx, dados.lojaIds);
        await tx.usuarioLojaAcesso.deleteMany({ where: { usuarioId: id } });
        await tx.usuarioLojaAcesso.createMany({
          data: dados.lojaIds.map((lojaId) => ({
            tenantId: contexto.tenantId,
            usuarioId: id,
            lojaId,
          })),
        });
      }

      if (dados.nome !== undefined || dados.status !== undefined) {
        await tx.usuario.update({
          where: { id },
          data: {
            ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
            ...(dados.status !== undefined ? { status: dados.status } : {}),
          },
        });
      }

      if (dados.status !== undefined) {
        /*
          A credencial acompanha o status.

          O login já confere `usuario.status`, então isto não é o que barra a
          entrada — é manter as duas pontas dizendo a mesma coisa. Credencial
          ativa apontando para usuário desativado é a linha que confunde quem
          for depurar "por que fulano não entra".
        */
        await tx.credencialLogin.updateMany({
          where: { dominio: 'FUNCIONARIO', principalId: id },
          data: { ativo: dados.status === 'ATIVO' },
        });
      }

      /*
        Desativar DERRUBA as sessões abertas. Sem isto, quem acabou de perder o
        acesso continua trabalhando até o token expirar — o token de acesso não
        sabe que o usuário mudou.
      */
      if (dados.status === 'INATIVO') {
        await tx.sessaoRefresh.updateMany({
          where: { usuarioId: id, revogadoEm: null },
          data: { revogadoEm: new Date(), motivoRevogacao: 'USUARIO_DESATIVADO' },
        });
      }

      return { antes: atual, depois: this.paraContrato(await this.exigir(tx, id)) };
    });

    /*
      Só os campos que MUDARAM. Despejar antes e depois inteiros faz quem
      audita comparar chave a chave, e a alteração passa batido.
    */
    const mudou: Record<string, { de: unknown; para: unknown }> = {};
    if (antes.nome !== depois.nome) mudou['nome'] = { de: antes.nome, para: depois.nome };
    if (antes.status !== depois.status) mudou['status'] = { de: antes.status, para: depois.status };

    const chaves = (u: Usuario) =>
      u.perfis
        .map((p) => p.chave)
        .sort()
        .join(',');
    if (chaves(antes) !== chaves(depois)) {
      mudou['perfis'] = { de: chaves(antes), para: chaves(depois) };
    }

    const lojas = (u: Usuario) =>
      u.lojas
        .map((l) => l.nome)
        .sort()
        .join(',');
    if (lojas(antes) !== lojas(depois)) {
      mudou['lojas'] = { de: lojas(antes), para: lojas(depois) };
    }

    if (Object.keys(mudou).length > 0) {
      await this.auditoria.registrar({
        contexto,
        acao: 'USUARIO_ALTERADO',
        entidade: 'usuario',
        entidadeId: id,
        atorNome: principal.nome,
        depois: mudou,
      });
    }

    return depois;
  }

  /**
   * Nova senha provisória.
   *
   * Redefinir REVOGA as sessões: redefine-se porque a senha pode ter vazado, e
   * a sessão aberta sobreviveria à troca.
   */
  async redefinirSenha(id: string, principal: Principal): Promise<{ senhaProvisoria: string }> {
    const contexto = exigirContexto();
    const senhaProvisoria = gerarSenhaProvisoria();
    const senhaHash = await gerarHashSenha(senhaProvisoria);

    await comEscopoAtual(this.prisma, async (tx) => {
      await this.exigir(tx, id);

      await tx.usuario.update({ where: { id }, data: { senhaHash } });
      await tx.sessaoRefresh.updateMany({
        where: { usuarioId: id, revogadoEm: null },
        data: { revogadoEm: new Date(), motivoRevogacao: 'SENHA_REDEFINIDA' },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'USUARIO_SENHA_REDEFINIDA',
      entidade: 'usuario',
      entidadeId: id,
      atorNome: principal.nome,
    });

    return { senhaProvisoria };
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private inclusao() {
    return {
      perfis: { include: { perfil: { select: { id: true, nome: true, chave: true } } } },
      acessosLoja: { include: { loja: { select: { id: true, nome: true } } } },
    } as const;
  }

  private async exigir(tx: ClienteEmTransacao, id: string) {
    const usuario = await tx.usuario.findFirst({ where: { id }, include: this.inclusao() });

    if (!usuario) {
      throw new NotFoundException({
        codigo: 'USUARIO_NAO_ENCONTRADO',
        mensagem: 'Usuário não encontrado.',
      });
    }

    return usuario;
  }

  private async exigirPerfis(tx: ClienteEmTransacao, ids: readonly string[]): Promise<void> {
    const achados = await tx.perfil.findMany({
      where: { id: { in: [...ids] } },
      select: { chave: true },
    });

    if (achados.length !== new Set(ids).size) {
      throw new NotFoundException({
        codigo: 'PERFIL_NAO_ENCONTRADO',
        mensagem: 'Um dos perfis informados não existe nesta empresa.',
      });
    }

    if (achados.some((perfil) => perfil.chave === PERFIL_DO_PORTAL)) {
      throw new BadRequestException({
        codigo: 'PERFIL_NAO_ATRIBUIVEL',
        mensagem:
          'O perfil do portal é do cliente externo e não se atribui a funcionário: ele concede só o acesso ao portal, que é outro domínio de login.',
      });
    }
  }

  private async exigirLojas(tx: ClienteEmTransacao, ids: readonly string[]): Promise<void> {
    const existem = await tx.loja.count({ where: { id: { in: [...ids] }, status: 'ATIVO' } });
    if (existem !== new Set(ids).size) {
      throw new NotFoundException({
        codigo: 'LOJA_NAO_ENCONTRADA',
        mensagem: 'Uma das lojas informadas não existe ou está inativa.',
      });
    }
  }

  private paraContrato(u: {
    id: string;
    nome: string;
    email: string;
    status: string;
    plataformaAdmin: boolean;
    ultimoLoginEm: Date | null;
    criadoEm: Date;
    perfis: { perfil: { id: string; nome: string; chave: string } }[];
    acessosLoja: { loja: { id: string; nome: string } }[];
  }): Usuario {
    const perfis = u.perfis.map((p) => p.perfil);
    const lojas = u.acessosLoja.map((a) => a.loja);

    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      status: u.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      perfis,
      lojas,
      ultimoLoginEm: u.ultimoLoginEm?.toISOString() ?? null,
      criadoEm: u.criadoEm.toISOString(),
      /*
        Entra e não faz nada. Vem da API porque é uma REGRA — "nenhuma loja não
        é todas, é nenhuma" —, não uma leitura que cada tela deduz por conta.
      */
      inerte: u.status === 'ATIVO' && (perfis.length === 0 || lojas.length === 0),
      plataformaAdmin: u.plataformaAdmin,
    };
  }
}
