import { randomInt, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  EmpresaCriada,
  EmpresaDetalhe,
  EmpresaResumo,
  NovaEmpresa,
  PaginaEmpresas,
  RegistroPlataforma,
  ResumoPlataforma,
  SenhaAdminRedefinida,
  SessaoSuporte,
} from '@estoque/contracts';

import {
  comEscopo,
  gerarHashSenha,
  PERFIS,
  PERMISSOES,
  type Contexto,
  type PrismaClient,
} from '@estoque/db';

import type { PrincipalPlataforma } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * O que a plataforma faz com as empresas.
 *
 * Confinado aqui por regra de lint: este é o único lugar do sistema que
 * chama as funções `plataforma_*`, que são `SECURITY DEFINER` e cruzam
 * tenants por definição. Ver `docs/TENANCY.md` §2 e a migração
 * `20260920220100_plataforma`.
 *
 * **Criar empresa não usa nenhuma delas.** Abrindo o escopo já com o id da
 * empresa nova, o `WITH CHECK (id = app.tenant_id)` do RLS é satisfeito e
 * tudo roda com `estoque_app`, o papel sem privilégio. Só as LEITURAS que
 * atravessam empresas precisam das funções.
 */

/** Sem ambiguidade visual: some 0/O, 1/l/I. Senha ditada por telefone. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TAMANHO_SENHA = 14;

function gerarSenha(): string {
  let senha = '';
  for (let i = 0; i < TAMANHO_SENHA; i += 1) {
    senha += ALFABETO[randomInt(ALFABETO.length)];
  }
  return senha;
}

interface LinhaEmpresa {
  readonly id: string;
  readonly nome: string;
  readonly slug: string;
  readonly documento: string | null;
  readonly status: string;
  readonly criado_em: Date;
  readonly lojas: bigint;
  readonly usuarios: bigint;
}

interface LinhaResumo {
  readonly empresas: bigint;
  readonly ativas: bigint;
  readonly suspensas: bigint;
  readonly usuarios_ativos: bigint;
  readonly lojas_ativas: bigint;
  readonly vendido_30d: unknown;
}

interface LinhaDetalhe extends LinhaEmpresa {
  readonly fuso_horario: string | null;
  readonly moeda: string | null;
  readonly produtos: bigint;
  readonly ultima_venda: Date | null;
}

interface LinhaAdmin {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly ultimo_login_em: Date | null;
}

interface LinhaAuditoria {
  readonly id: string;
  readonly acao: string;
  readonly entidade: string;
  readonly ator_nome: string | null;
  readonly motivo: string | null;
  readonly criado_em: Date;
}

@Injectable()
export class EmpresasService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Leitura — atravessa empresas
  // -------------------------------------------------------------------------

  async listar(): Promise<PaginaEmpresas> {
    const [linhas, resumo] = await Promise.all([
      this.prisma.$queryRaw<LinhaEmpresa[]>`SELECT * FROM plataforma_empresas()`,
      this.prisma.$queryRaw<LinhaResumo[]>`SELECT * FROM plataforma_resumo()`,
    ]);

    const r = resumo[0];

    return {
      itens: linhas.map((l) => this.paraResumo(l)),
      resumo: {
        empresas: Number(r?.empresas ?? 0),
        ativas: Number(r?.ativas ?? 0),
        suspensas: Number(r?.suspensas ?? 0),
        usuariosAtivos: Number(r?.usuarios_ativos ?? 0),
        lojasAtivas: Number(r?.lojas_ativas ?? 0),
        vendido30d: String(r?.vendido_30d ?? '0'),
      } satisfies ResumoPlataforma,
    };
  }

  async detalhe(empresaId: string): Promise<EmpresaDetalhe> {
    const [linhas, admins, registros] = await Promise.all([
      this.prisma.$queryRaw<LinhaDetalhe[]>`SELECT * FROM plataforma_empresa(${empresaId}::uuid)`,
      this.prisma.$queryRaw<
        LinhaAdmin[]
      >`SELECT * FROM plataforma_admins_da_empresa(${empresaId}::uuid)`,
      this.prisma.$queryRaw<
        LinhaAuditoria[]
      >`SELECT * FROM plataforma_auditoria(${empresaId}::uuid, 50)`,
    ]);

    const linha = linhas[0];
    if (!linha) {
      throw new NotFoundException({
        codigo: 'EMPRESA_NAO_ENCONTRADA',
        mensagem: 'Esta empresa não existe.',
      });
    }

    return {
      ...this.paraResumo(linha),
      fusoHorario: linha.fuso_horario,
      moeda: linha.moeda,
      produtos: Number(linha.produtos),
      ultimaVenda: linha.ultima_venda?.toISOString() ?? null,
      administradores: admins.map((a) => ({
        id: a.id,
        nome: a.nome,
        email: a.email,
        ultimoLoginEm: a.ultimo_login_em?.toISOString() ?? null,
      })),
      auditoria: registros.map((a): RegistroPlataforma => ({
        id: a.id,
        acao: a.acao,
        entidade: a.entidade,
        atorNome: a.ator_nome,
        motivo: a.motivo,
        criadoEm: a.criado_em.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Criação — sem cruzar empresa nenhuma
  // -------------------------------------------------------------------------

  /**
   * Cria a empresa e o administrador dela, numa transação só.
   *
   * A sequência é o núcleo do que o seed faz: empresa, configuração, perfis
   * de sistema com as permissões de `docs/`, usuário, vínculos e a
   * **credencial de login**. Sem a credencial a senha não autentica e a
   * empresa nasce sem ninguém que entre — já aconteceu com `cliente_acesso`.
   *
   * Não cria loja nem tabela de preço: quem monta é o administrador, nas
   * telas de dentro. A consequência é real e está dita na tela — a empresa
   * nasce *inerte*, e as telas dela vêm vazias até a primeira loja existir.
   */
  async criar(dados: NovaEmpresa, quem: PrincipalPlataforma): Promise<EmpresaCriada> {
    await this.exigirSlugLivre(dados.slug);
    await this.exigirEmailLivre(dados.admin.email);

    /*
      O id é gerado AQUI, e não pelo default do banco, porque o escopo precisa
      ser aberto antes do INSERT: a política do RLS na tabela `tenant` é
      `WITH CHECK (id = app.tenant_id)`. Com o escopo já apontando para a
      empresa nova, a inserção passa — e nada precisa de BYPASSRLS.
    */
    const empresaId = randomUUID();
    const contexto: Contexto = {
      tenantId: empresaId,
      principalTipo: 'PLATAFORMA',
      principalId: quem.id,
    };

    const senha = gerarSenha();
    const senhaHash = await gerarHashSenha(senha);

    const criado = await comEscopo(
      this.prisma,
      contexto,
      async (tx) => {
        const empresa = await tx.tenant.create({
          data: {
            id: empresaId,
            nome: dados.nome,
            slug: dados.slug,
            documento: dados.documento ?? null,
            // A linha de configuração nasce junto. Ela tem default em toda
            // coluna, mas a AUSÊNCIA dela mata a tela de configuração.
            configuracao: {
              create: dados.fusoHorario ? { fusoHorario: dados.fusoHorario } : {},
            },
          },
        });

        /*
          Os perfis vêm de `docs/`, via `PERFIS`. Lista explícita de
          permissões, nunca curinga de grupo: um perfil montado com "todo o
          grupo carteira" passaria a conceder cada permissão que aparecesse
          ali depois, sem ninguém decidir.
        */
        const conhecidas = new Set(PERMISSOES.map((p) => p.chave));
        let perfilAdminId: string | null = null;

        for (const modelo of PERFIS) {
          const desconhecida = modelo.permissoes.find((c) => !conhecidas.has(c));
          if (desconhecida) {
            throw new BadRequestException({
              codigo: 'PERMISSAO_DESCONHECIDA',
              mensagem: `O perfil ${modelo.chave} pede a permissão "${desconhecida}", que não existe no catálogo.`,
            });
          }

          const perfil = await tx.perfil.create({
            data: {
              tenantId: empresaId,
              chave: modelo.chave,
              nome: modelo.nome,
              descricao: modelo.descricao,
              sistema: true,
              permissoes: {
                create: modelo.permissoes.map((chave: string) => ({
                  tenantId: empresaId,
                  permissaoChave: chave,
                })),
              },
            },
          });

          if (modelo.chave === 'ADMIN_EMPRESA') {
            perfilAdminId = perfil.id;
          }
        }

        if (!perfilAdminId) {
          throw new BadRequestException({
            codigo: 'PERFIL_ADMIN_AUSENTE',
            mensagem: 'O catálogo de perfis não traz ADMIN_EMPRESA; a empresa ficaria sem dono.',
          });
        }

        const usuario = await tx.usuario.create({
          data: {
            tenantId: empresaId,
            nome: dados.admin.nome,
            email: dados.admin.email,
            senhaHash,
            perfis: { create: [{ tenantId: empresaId, perfilId: perfilAdminId }] },
          },
        });

        // O diretório de login. Sem ele a credencial não existe e a senha,
        // que está correta, não autentica ninguém.
        await tx.credencialLogin.create({
          data: {
            dominio: 'FUNCIONARIO',
            email: dados.admin.email,
            empresaId,
            principalId: usuario.id,
          },
        });

        return { empresa, usuario };
      },
      { tempoLimiteMs: 30_000 },
    );

    await this.auditoria.registrar({
      contexto,
      acao: 'PLATAFORMA_CRIOU',
      entidade: 'tenant',
      entidadeId: empresaId,
      atorNome: quem.nome,
      motivo: `Empresa criada com o administrador ${dados.admin.nome}`,
      depois: { nome: dados.nome, slug: dados.slug, admin: dados.admin.email },
    });

    return {
      empresa: {
        id: criado.empresa.id,
        nome: criado.empresa.nome,
        slug: criado.empresa.slug,
        documento: criado.empresa.documento,
        status: criado.empresa.status,
        criadoEm: criado.empresa.criadoEm.toISOString(),
        lojas: 0,
        usuarios: 1,
      },
      admin: {
        id: criado.usuario.id,
        nome: criado.usuario.nome,
        email: criado.usuario.email,
      },
      senhaProvisoria: senha,
    };
  }

  // -------------------------------------------------------------------------
  // Situação
  // -------------------------------------------------------------------------

  /**
   * Suspender bloqueia o login de TODOS e não apaga nada.
   *
   * O bloqueio acontece em `credencial_login.ativo`, que é onde o login
   * procura antes de saber de qual empresa a pessoa é — desativar só o
   * `tenant.status` não impediria ninguém de entrar, porque nada no caminho
   * de autenticação consulta aquele campo.
   */
  async mudarSituacao(
    empresaId: string,
    para: 'ATIVO' | 'INATIVO',
    motivo: string,
    quem: PrincipalPlataforma,
  ): Promise<EmpresaResumo> {
    const antes = await this.exigirEmpresa(empresaId);

    if (antes.status === para) {
      throw new ConflictException({
        codigo: 'SITUACAO_INALTERADA',
        mensagem:
          para === 'ATIVO' ? 'Esta empresa já está ativa.' : 'Esta empresa já está suspensa.',
      });
    }

    const contexto: Contexto = {
      tenantId: empresaId,
      principalTipo: 'PLATAFORMA',
      principalId: quem.id,
    };

    await comEscopo(this.prisma, contexto, async (tx) => {
      await tx.tenant.update({ where: { id: empresaId }, data: { status: para } });

      if (para === 'INATIVO') {
        // As sessões abertas continuariam valendo até o token expirar.
        await tx.sessaoRefresh.updateMany({
          where: { tenantId: empresaId, revogadoEm: null },
          data: { revogadoEm: new Date(), motivoRevogacao: 'EMPRESA_SUSPENSA' },
        });
      }
    });

    // Fora do escopo: `credencial_login` não tem `tenant_id` e não está sob
    // RLS — é o diretório que o login consulta ANTES de existir empresa.
    await this.prisma.credencialLogin.updateMany({
      where: { empresaId },
      data: { ativo: para === 'ATIVO' },
    });

    await this.auditoria.registrar({
      contexto,
      acao: para === 'ATIVO' ? 'PLATAFORMA_REATIVOU' : 'PLATAFORMA_SUSPENDEU',
      entidade: 'tenant',
      entidadeId: empresaId,
      atorNome: quem.nome,
      motivo,
      antes: { status: antes.status },
      depois: { status: para },
    });

    const depois = await this.exigirEmpresa(empresaId);
    return this.paraResumo(depois);
  }

  // -------------------------------------------------------------------------
  // Socorro ao administrador
  // -------------------------------------------------------------------------

  /**
   * Quando o único administrador perde o acesso, não há quem recupere de
   * dentro. A senha é gerada pelo servidor, mostrada uma vez, e as sessões
   * dele caem — redefine-se porque a senha pode ter vazado, e a sessão
   * aberta sobreviveria à troca.
   */
  async redefinirSenhaAdmin(
    empresaId: string,
    usuarioId: string,
    motivo: string,
    quem: PrincipalPlataforma,
  ): Promise<SenhaAdminRedefinida> {
    await this.exigirEmpresa(empresaId);

    const admins = await this.prisma.$queryRaw<
      LinhaAdmin[]
    >`SELECT * FROM plataforma_admins_da_empresa(${empresaId}::uuid)`;

    const alvo = admins.find((a) => a.id === usuarioId);
    if (!alvo) {
      throw new NotFoundException({
        codigo: 'ADMIN_NAO_ENCONTRADO',
        mensagem: 'Esta pessoa não é administradora desta empresa.',
      });
    }

    const senha = gerarSenha();
    const senhaHash = await gerarHashSenha(senha);
    const contexto: Contexto = {
      tenantId: empresaId,
      principalTipo: 'PLATAFORMA',
      principalId: quem.id,
    };

    const revogadas = await comEscopo(this.prisma, contexto, async (tx) => {
      await tx.usuario.update({ where: { id: usuarioId }, data: { senhaHash } });

      const { count } = await tx.sessaoRefresh.updateMany({
        where: { usuarioId, revogadoEm: null },
        data: { revogadoEm: new Date(), motivoRevogacao: 'SENHA_REDEFINIDA' },
      });
      return count;
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'PLATAFORMA_SENHA_ADMIN',
      entidade: 'usuario',
      entidadeId: usuarioId,
      atorNome: quem.nome,
      motivo,
      depois: { sessoesRevogadas: revogadas },
    });

    return {
      usuario: { id: alvo.id, nome: alvo.nome, email: alvo.email },
      senhaProvisoria: senha,
      sessoesRevogadas: revogadas,
    };
  }

  /**
   * Exclui uma empresa VAZIA.
   *
   * Criar sem poder desfazer prende um engano para sempre — foi o mesmo
   * defeito da baixa de título sem estorno e do perfil sem exclusão. Um slug
   * digitado errado ficaria ocupado na plataforma inteira, porque `slug` é
   * único e não se altera.
   *
   * **Vazia é vazia**: nenhuma loja, nenhum produto, nenhum cliente e nenhuma
   * venda. Com qualquer um deles a resposta é recusar e mandar SUSPENDER, que
   * é a operação reversível. Apagar empresa com histórico não é engano de
   * cadastro; é perda de dado, e o razão é append-only justamente para isso
   * não acontecer.
   *
   * A ordem das exclusões é parte do contrato: `credencial_login` primeiro,
   * porque não tem `tenant_id` e o cascata do banco não a alcança pela
   * empresa. O seed já aprendeu isso morrendo no meio da limpeza.
   */
  async excluirVazia(empresaId: string, quem: PrincipalPlataforma): Promise<void> {
    const empresa = await this.exigirEmpresa(empresaId);

    const contexto: Contexto = {
      tenantId: empresaId,
      principalTipo: 'PLATAFORMA',
      principalId: quem.id,
    };

    const impedimentos = await comEscopo(this.prisma, contexto, async (tx) => {
      const [lojas, produtos, clientes, vendas, movimentos] = await Promise.all([
        tx.loja.count(),
        tx.produto.count(),
        tx.cliente.count(),
        tx.venda.count(),
        tx.movimentoEstoque.count(),
      ]);

      return [
        lojas > 0 ? `${String(lojas)} loja(s)` : null,
        produtos > 0 ? `${String(produtos)} produto(s)` : null,
        clientes > 0 ? `${String(clientes)} cliente(s)` : null,
        vendas > 0 ? `${String(vendas)} venda(s)` : null,
        movimentos > 0 ? `${String(movimentos)} movimento(s) de estoque` : null,
      ].filter((x): x is string => x !== null);
    });

    if (impedimentos.length > 0) {
      throw new ConflictException({
        codigo: 'EMPRESA_NAO_ESTA_VAZIA',
        mensagem:
          `Esta empresa já tem ${impedimentos.join(', ')}. ` +
          'Excluir apagaria histórico. Suspenda — bloqueia o login de todos, não apaga nada e volta atrás.',
      });
    }

    /*
      Registra ANTES de apagar: o `audit_log` tem chave estrangeira para
      `tenant` com `onDelete: Cascade`, então a linha iria embora junto. A
      trilha da exclusão fica onde ela sobrevive — no log do servidor — e a
      empresa some inteira, inclusive a própria trilha dela.
    */
    await this.auditoria.registrar({
      contexto,
      acao: 'PLATAFORMA_EXCLUIU',
      entidade: 'tenant',
      entidadeId: empresaId,
      atorNome: quem.nome,
      motivo: `Empresa vazia "${empresa.nome}" (${empresa.slug}) excluída`,
      antes: { nome: empresa.nome, slug: empresa.slug, criadoEm: empresa.criado_em.toISOString() },
    });

    // Fora do escopo: o diretório de login não tem `tenant_id` de propósito,
    // e nenhum cascata o alcança pela empresa.
    await this.prisma.credencialLogin.deleteMany({ where: { empresaId } });

    await comEscopo(this.prisma, contexto, async (tx) => {
      await tx.sessaoRefresh.deleteMany({ where: { tenantId: empresaId } });
      await tx.usuarioPerfil.deleteMany({ where: { tenantId: empresaId } });
      await tx.usuarioLojaAcesso.deleteMany({ where: { tenantId: empresaId } });
      await tx.usuario.deleteMany({ where: { tenantId: empresaId } });
      await tx.perfilPermissao.deleteMany({ where: { tenantId: empresaId } });
      await tx.perfil.deleteMany({ where: { tenantId: empresaId } });
      await tx.auditLog.deleteMany({ where: { tenantId: empresaId } });
      await tx.tenantConfiguracao.deleteMany({ where: { tenantId: empresaId } });
      await tx.tenant.delete({ where: { id: empresaId } });
    });
  }

  private paraResumo(l: LinhaEmpresa): EmpresaResumo {
    return {
      id: l.id,
      nome: l.nome,
      slug: l.slug,
      documento: l.documento,
      status: l.status === 'ATIVO' ? 'ATIVO' : 'INATIVO',
      criadoEm: l.criado_em.toISOString(),
      lojas: Number(l.lojas),
      usuarios: Number(l.usuarios),
    };
  }

  private async exigirEmpresa(empresaId: string): Promise<LinhaEmpresa> {
    const linhas = await this.prisma.$queryRaw<
      LinhaEmpresa[]
    >`SELECT * FROM plataforma_empresa(${empresaId}::uuid)`;
    const linha = linhas[0];
    if (!linha) {
      throw new NotFoundException({
        codigo: 'EMPRESA_NAO_ENCONTRADA',
        mensagem: 'Esta empresa não existe.',
      });
    }
    return linha;
  }

  private async exigirSlugLivre(slug: string): Promise<void> {
    const existe = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM plataforma_empresas() WHERE slug = ${slug}`;
    if (existe.length > 0) {
      throw new ConflictException({
        codigo: 'SLUG_EM_USO',
        mensagem: `Já existe uma empresa com o endereço "${slug}".`,
      });
    }
  }

  /**
   * O índice `(dominio, email)` de `credencial_login` é GLOBAL.
   *
   * Sem esta conferência, o `create` estouraria lá no fundo da transação com
   * um P2002 que nada traduz — e a empresa inteira voltaria atrás por causa
   * de um e-mail repetido, sem dizer de quem ele é.
   */
  private async exigirEmailLivre(email: string): Promise<void> {
    const credencial = await this.prisma.credencialLogin.findUnique({
      where: { dominio_email: { dominio: 'FUNCIONARIO', email } },
    });

    if (credencial) {
      throw new ConflictException({
        codigo: 'EMAIL_JA_CADASTRADO',
        mensagem:
          'Este e-mail já é login de funcionário em alguma empresa da plataforma. ' +
          'O diretório de login é único no domínio inteiro.',
      });
    }
  }
}

export type { SessaoSuporte };
