import { randomInt } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AcessoCliente,
  AcessoCriado,
  AlteracaoAcessoCliente,
  NovoAcessoCliente,
} from '@estoque/contracts';
import {
  comEscopoAtual,
  gerarHashSenha,
  TAMANHO_MINIMO_SENHA,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Alfabeto sem ambiguidade visual.
 *
 * Sem `0/O`, `1/l/I`: esta senha vai ser lida em voz alta ao telefone ou
 * copiada de um papel. Um caractere que se confunde vira uma ligação para a
 * loja dizendo que o acesso não funciona.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Comprimento acima do mínimo da política — com folga, porque é gerada. */
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
 * O login do cliente no portal.
 *
 * Um cadastro de cliente e uma credencial de acesso são coisas diferentes: o
 * primeiro compra no balcão sem nunca entrar no portal. Por isso o acesso é
 * criado à parte, e por uma permissão à parte — `cliente.gerenciar_acesso`,
 * que não acompanha `cliente.editar`.
 *
 * **A senha nunca é escolhida por quem cria.** O servidor gera, devolve uma
 * única vez e guarda só o hash argon2id. Quem cria não digita senha de
 * terceiro, e não existe caminho de volta: perdeu, gera outra.
 */
@Injectable()
export class AcessosService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async listar(clienteId: string): Promise<AcessoCliente[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      await this.exigirCliente(tx, clienteId);

      const linhas = await tx.clienteAcesso.findMany({
        where: { clienteId },
        orderBy: { criadoEm: 'asc' },
      });

      return linhas.map((a) => this.paraContrato(a));
    });
  }

  async criar(
    clienteId: string,
    dados: NovoAcessoCliente,
    principal: Principal,
  ): Promise<AcessoCriado> {
    const email = dados.email.trim().toLowerCase();
    const senhaProvisoria = gerarSenhaProvisoria();
    const senhaHash = await gerarHashSenha(senhaProvisoria);

    return comEscopoAtual(this.prisma, async (tx) => {
      await this.exigirCliente(tx, clienteId);

      const repetido = await tx.clienteAcesso.findFirst({ where: { email } });
      if (repetido) {
        throw new ConflictException({
          codigo: 'EMAIL_JA_TEM_ACESSO',
          mensagem: `${email} já tem acesso ao portal.`,
        });
      }

      /**
       * `credencial_login` é quem resolve a empresa a partir do e-mail, no
       * login — e ela fica FORA do RLS de propósito (não tem `tenant_id`).
       * Sem esta linha o acesso existe e a pessoa não entra: o login não
       * descobre de qual empresa ela é.
       *
       * O índice único é `(dominio, email)`, GLOBAL: o mesmo e-mail não pode
       * ser cliente de duas empresas. É limitação conhecida, e a resposta
       * precisa dizer isso em vez de estourar uma violação de chave.
       */
      const jaUsado = await tx.credencialLogin.findFirst({
        where: { dominio: 'CLIENTE', email },
        select: { id: true },
      });
      if (jaUsado) {
        throw new ConflictException({
          codigo: 'EMAIL_EM_USO',
          mensagem: `${email} já é usado como acesso de cliente. Use outro e-mail.`,
        });
      }

      const acesso = await tx.clienteAcesso.create({
        data: {
          tenantId: principal.tenantId,
          clienteId,
          nome: dados.nome,
          email,
          senhaHash,
        },
      });

      await tx.credencialLogin.create({
        data: {
          dominio: 'CLIENTE',
          email,
          empresaId: principal.tenantId,
          principalId: acesso.id,
        },
      });

      return { acesso: this.paraContrato(acesso), senhaProvisoria };
    });
  }

  async alterar(
    clienteId: string,
    acessoId: string,
    dados: AlteracaoAcessoCliente,
  ): Promise<AcessoCliente> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const atual = await this.exigirAcesso(tx, clienteId, acessoId);

      const alterado = await tx.clienteAcesso.update({
        where: { id: atual.id },
        data: {
          ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
          ...(dados.status !== undefined ? { status: dados.status } : {}),
        },
      });

      // A credencial acompanha o status. Deixar `credencial_login` ativa com
      // o acesso inativo faria o login encontrar a empresa e recusar depois —
      // desligado em dois lugares é desligado em nenhum.
      if (dados.status !== undefined) {
        await tx.credencialLogin.updateMany({
          where: { dominio: 'CLIENTE', principalId: atual.id },
          data: { ativo: dados.status === 'ATIVO' },
        });
      }

      return this.paraContrato(alterado);
    });
  }

  /**
   * Gera outra senha provisória.
   *
   * É o único caminho de volta: o hash é de mão única, e guardar a senha em
   * algum lugar para poder mostrá-la de novo seria trocar uma inconveniência
   * por um vazamento.
   */
  async redefinirSenha(clienteId: string, acessoId: string): Promise<AcessoCriado> {
    const senhaProvisoria = gerarSenhaProvisoria();
    const senhaHash = await gerarHashSenha(senhaProvisoria);

    return comEscopoAtual(this.prisma, async (tx) => {
      const atual = await this.exigirAcesso(tx, clienteId, acessoId);

      const alterado = await tx.clienteAcesso.update({
        where: { id: atual.id },
        data: { senhaHash },
      });

      // As sessões abertas morrem junto: redefinir senha é o que se faz
      // quando ela pode ter vazado, e uma sessão viva sobreviveria à troca.
      await tx.sessaoRefresh.updateMany({
        where: { clienteAcessoId: atual.id, revogadoEm: null },
        data: { revogadoEm: new Date(), motivoRevogacao: 'SENHA_REDEFINIDA' },
      });

      return { acesso: this.paraContrato(alterado), senhaProvisoria };
    });
  }

  private async exigirCliente(tx: ClienteEmTransacao, clienteId: string): Promise<void> {
    const cliente = await tx.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!cliente) {
      throw new NotFoundException({
        codigo: 'CLIENTE_NAO_ENCONTRADO',
        mensagem: 'Cadastro não encontrado.',
      });
    }
  }

  private async exigirAcesso(
    tx: ClienteEmTransacao,
    clienteId: string,
    acessoId: string,
  ): Promise<{ id: string }> {
    // `findFirst` com os DOIS ids: sem o `clienteId` no filtro, trocar o id na
    // URL mexeria no acesso de outro cadastro da mesma empresa.
    const acesso = await tx.clienteAcesso.findFirst({
      where: { id: acessoId, clienteId },
      select: { id: true },
    });

    if (!acesso) {
      throw new NotFoundException({
        codigo: 'ACESSO_NAO_ENCONTRADO',
        mensagem: 'Acesso não encontrado neste cadastro.',
      });
    }

    return acesso;
  }

  private paraContrato(a: {
    id: string;
    nome: string;
    email: string;
    status: string;
    ultimoLoginEm: Date | null;
    criadoEm: Date;
  }): AcessoCliente {
    return {
      id: a.id,
      nome: a.nome,
      email: a.email,
      status: a.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      ultimoLoginEm: a.ultimoLoginEm?.toISOString() ?? null,
      criadoEm: a.criadoEm.toISOString(),
    };
  }
}

export { TAMANHO_MINIMO_SENHA };
