import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AberturaCaixa,
  Caixa,
  ConferenciaCaixa,
  FechamentoCaixa,
  FiltroCaixas,
  NovoMovimentoCaixa,
  PaginaCaixas,
  ResumoFinanceiroCaixa,
} from '@estoque/contracts';
import { PERM } from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  Prisma,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/** Formas que entram na gaveta. O resto vai para a adquirente. */
const EM_ESPECIE = 'DINHEIRO';

@Injectable()
export class CaixaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Abertura
  // -------------------------------------------------------------------------

  async abrir(dados: AberturaCaixa, principal: Principal): Promise<Caixa> {
    const contexto = exigirContexto();

    const id = await comEscopoAtual(this.prisma, async (tx) => {
      const config = await tx.tenantConfiguracao.findUnique({
        where: { tenantId: contexto.tenantId },
        select: { modoCaixa: true },
      });

      // No modo compartilhado a regra é "um caixa aberto por loja", e ela não
      // cabe no índice único parcial — que é por operador. Esta verificação é
      // da aplicação, e está registrada como tal em docs/CASHBOX.md §2.
      if (config?.modoCaixa === 'COMPARTILHADO_POR_LOJA') {
        const jaAberto = await tx.caixa.findFirst({
          where: { lojaId: dados.lojaId, status: 'ABERTO' },
          select: { numero: true, operador: { select: { nome: true } } },
        });

        if (jaAberto) {
          throw new ConflictException({
            codigo: 'CAIXA_JA_ABERTO_NA_LOJA',
            mensagem: `O caixa ${String(jaAberto.numero)} já está aberto nesta loja, com ${jaAberto.operador.nome}.`,
          });
        }
      }

      const numero = await this.proximoNumero(tx, contexto.tenantId);

      try {
        const caixa = await tx.caixa.create({
          data: {
            tenantId: contexto.tenantId,
            lojaId: dados.lojaId,
            numero,
            operadorId: principal.id,
            valorAbertura: dec(dados.valorAbertura).toFixed(2),
            ...(dados.observacao ? { observacaoAbertura: dados.observacao } : {}),
          },
          select: { id: true },
        });

        return caixa.id;
      } catch (erro) {
        // O índice único parcial `caixa_aberto_por_operador` é quem garante,
        // de verdade, que ninguém abre dois caixas. A verificação prévia só
        // existe para dar uma mensagem melhor.
        if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
          throw new ConflictException({
            codigo: 'CAIXA_JA_ABERTO',
            mensagem: 'Você já tem um caixa aberto nesta loja. Feche-o antes de abrir outro.',
          });
        }
        throw erro;
      }
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'CAIXA_ABERTO',
      entidade: 'caixa',
      entidadeId: id,
      atorNome: principal.nome,
      depois: { lojaId: dados.lojaId, valorAbertura: dados.valorAbertura },
    });

    return this.detalhe(id, principal);
  }

  // -------------------------------------------------------------------------
  // Sangria e suprimento
  // -------------------------------------------------------------------------

  async movimentar(
    caixaId: string,
    dados: NovoMovimentoCaixa,
    principal: Principal,
  ): Promise<Caixa> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const caixa = await this.exigirCaixa(tx, caixaId);

      if (caixa.status !== 'ABERTO') {
        throw new ConflictException({
          codigo: 'CAIXA_NAO_ESTA_ABERTO',
          mensagem: 'Só um caixa aberto recebe sangria ou suprimento.',
        });
      }

      this.exigirDonoOuConferente(caixa.operadorId, principal);

      const permissao = dados.tipo === 'SANGRIA' ? PERM.caixa.sangria : PERM.caixa.suprimento;

      if (!principal.permissoes.has(permissao)) {
        throw new ForbiddenException({
          codigo: 'SEM_PERMISSAO',
          mensagem:
            dados.tipo === 'SANGRIA'
              ? 'Você não tem permissão para registrar sangria.'
              : 'Você não tem permissão para registrar suprimento.',
        });
      }

      if (dados.tipo === 'SANGRIA') {
        // Sangria maior do que o que existe na gaveta é erro de digitação — ou
        // um problema bem maior. Nos dois casos, recusar é melhor do que
        // registrar um caixa com dinheiro negativo.
        const resumo = await this.calcularResumo(tx, caixa.id, caixa.valorAbertura);
        const emCaixa = dec(resumo.esperadoEmCaixa);
        const valor = dec(dados.valor);

        if (valor.greaterThan(emCaixa)) {
          throw new ConflictException({
            codigo: 'SANGRIA_MAIOR_QUE_O_CAIXA',
            mensagem: `Há R$ ${emCaixa.toFixed(2)} na gaveta e a sangria é de R$ ${valor.toFixed(2)}.`,
          });
        }
      }

      await tx.movimentoCaixa.create({
        data: {
          tenantId: contexto.tenantId,
          caixaId: caixa.id,
          tipo: dados.tipo,
          valor: dec(dados.valor).toFixed(2),
          motivo: dados.motivo,
          atorId: principal.id,
        },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: dados.tipo === 'SANGRIA' ? 'CAIXA_SANGRIA' : 'CAIXA_SUPRIMENTO',
      entidade: 'caixa',
      entidadeId: caixaId,
      atorNome: principal.nome,
      motivo: dados.motivo,
      depois: { valor: dados.valor },
    });

    return this.detalhe(caixaId, principal);
  }

  // -------------------------------------------------------------------------
  // Fechamento
  // -------------------------------------------------------------------------

  /**
   * Fecha o caixa comparando o contado com o esperado.
   *
   * A diferença é **registrada como é**. Não há ajuste automático, não há
   * tolerância silenciosa: um caixa que fecha sempre exato porque o sistema
   * arredonda é um caixa que não controla nada.
   */
  async fechar(caixaId: string, dados: FechamentoCaixa, principal: Principal): Promise<Caixa> {
    const contexto = exigirContexto();

    const diferenca = await comEscopoAtual(this.prisma, async (tx) => {
      const caixa = await this.exigirCaixa(tx, caixaId);

      if (caixa.status !== 'ABERTO') {
        throw new ConflictException({
          codigo: 'CAIXA_NAO_ESTA_ABERTO',
          mensagem: 'Este caixa já foi fechado.',
        });
      }

      this.exigirDonoOuConferente(caixa.operadorId, principal);

      const resumo = await this.calcularResumo(tx, caixa.id, caixa.valorAbertura);
      const esperado = dec(resumo.esperadoEmCaixa);
      const contado = dec(dados.valorContado);
      const dif = contado.minus(esperado);

      await tx.caixa.update({
        where: { id: caixa.id },
        data: {
          status: 'FECHADO',
          valorContado: contado.toFixed(2),
          valorEsperado: esperado.toFixed(2),
          diferenca: dif.toFixed(2),
          fechadoEm: new Date(),
          ...(dados.observacao ? { observacaoFechamento: dados.observacao } : {}),
        },
      });

      return dif;
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'CAIXA_FECHADO',
      entidade: 'caixa',
      entidadeId: caixaId,
      atorNome: principal.nome,
      ...(dados.observacao ? { motivo: dados.observacao } : {}),
      depois: { valorContado: dados.valorContado, diferenca: diferenca.toFixed(2) },
    });

    return this.detalhe(caixaId, principal);
  }

  /**
   * Confere o fechamento de outra pessoa.
   *
   * **Quem fechou não confere a si mesmo.** Conferência é o segundo par de
   * olhos; feita pela mesma pessoa, é assinatura em branco.
   */
  async conferir(caixaId: string, dados: ConferenciaCaixa, principal: Principal): Promise<Caixa> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const caixa = await this.exigirCaixa(tx, caixaId);

      if (caixa.status === 'ABERTO') {
        throw new ConflictException({
          codigo: 'CAIXA_AINDA_ABERTO',
          mensagem: 'Feche o caixa antes de conferir.',
        });
      }

      if (caixa.status === 'CONFERIDO') {
        throw new ConflictException({
          codigo: 'CAIXA_JA_CONFERIDO',
          mensagem: 'Este caixa já foi conferido.',
        });
      }

      if (caixa.operadorId === principal.id) {
        throw new ConflictException({
          codigo: 'NAO_CONFERE_O_PROPRIO_CAIXA',
          mensagem: 'Quem fecha o caixa não o confere. A conferência precisa de outra pessoa.',
        });
      }

      await tx.caixa.update({
        where: { id: caixa.id },
        data: {
          status: 'CONFERIDO',
          conferidoPorId: principal.id,
          conferidoEm: new Date(),
          ...(dados.observacao ? { observacaoConferencia: dados.observacao } : {}),
        },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'CAIXA_CONFERIDO',
      entidade: 'caixa',
      entidadeId: caixaId,
      atorNome: principal.nome,
      ...(dados.observacao ? { motivo: dados.observacao } : {}),
    });

    return this.detalhe(caixaId, principal);
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  /** O caixa aberto do operador naquela loja, ou `null`. */
  async meuCaixaAberto(lojaId: string, principal: Principal): Promise<Caixa | null> {
    const id = await comEscopoAtual(this.prisma, async (tx) => {
      const caixa = await tx.caixa.findFirst({
        where: { lojaId, operadorId: principal.id, status: 'ABERTO' },
        select: { id: true },
      });
      return caixa?.id ?? null;
    });

    return id ? this.detalhe(id, principal) : null;
  }

  async detalhe(id: string, principal: Principal): Promise<Caixa> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const caixa = await tx.caixa.findFirst({
        where: { id },
        include: {
          loja: { select: { nome: true } },
          operador: { select: { nome: true } },
          conferidoPor: { select: { nome: true } },
          movimentos: { orderBy: { criadoEm: 'asc' } },
        },
      });

      if (!caixa) {
        throw new NotFoundException({
          codigo: 'CAIXA_NAO_ENCONTRADO',
          mensagem: 'Caixa não encontrado.',
        });
      }

      this.exigirDonoOuConferente(caixa.operadorId, principal);

      const resumo = await this.calcularResumo(tx, caixa.id, caixa.valorAbertura);

      return this.paraContrato(caixa, resumo);
    });
  }

  async listar(filtro: FiltroCaixas, principal: Principal): Promise<PaginaCaixas> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const podeVerDeOutros = principal.permissoes.has(PERM.caixa.conferir);

      const onde = {
        ...(filtro.lojaId ? { lojaId: filtro.lojaId } : {}),
        ...(filtro.status ? { status: filtro.status } : {}),
        // Sem `caixa.conferir`, só os próprios. O filtro por operador que
        // chegar na requisição não amplia isso.
        ...(podeVerDeOutros
          ? filtro.operadorId
            ? { operadorId: filtro.operadorId }
            : {}
          : { operadorId: principal.id }),
        ...(filtro.de || filtro.ate
          ? {
              abertoEm: {
                ...(filtro.de ? { gte: new Date(filtro.de) } : {}),
                ...(filtro.ate ? { lte: new Date(filtro.ate) } : {}),
              },
            }
          : {}),
      };

      const linhas = await tx.caixa.findMany({
        where: onde,
        orderBy: { id: 'desc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: {
          loja: { select: { nome: true } },
          operador: { select: { nome: true } },
          conferidoPor: { select: { nome: true } },
          movimentos: { orderBy: { criadoEm: 'asc' } },
        },
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      const itens: Caixa[] = [];
      for (const caixa of pagina) {
        const resumo = await this.calcularResumo(tx, caixa.id, caixa.valorAbertura);
        itens.push(this.paraContrato(caixa, resumo));
      }

      return {
        itens,
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Usado pelo PDV, dentro da transação DELE
  // -------------------------------------------------------------------------

  /**
   * O caixa que deve receber esta venda.
   *
   * Devolve `null` quando a venda não teve dinheiro — cartão e PIX vão para a
   * adquirente, não para a gaveta, e exigir caixa aberto para eles pararia a
   * loja sem proteger nada.
   *
   * Com dinheiro, o caixa aberto é **obrigatório**: dinheiro que entra sem
   * caixa é dinheiro que ninguém vai conferir no fim do turno.
   */
  async caixaParaVenda(
    tx: ClienteEmTransacao,
    lojaId: string,
    temDinheiro: boolean,
    principal: Principal,
  ): Promise<string | null> {
    const contexto = exigirContexto();

    const config = await tx.tenantConfiguracao.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { modoCaixa: true },
    });

    const caixa = await tx.caixa.findFirst({
      where: {
        lojaId,
        status: 'ABERTO',
        // No modo compartilhado a loja tem um caixa só, de quem quer que o
        // tenha aberto. No modo por operador, cada um tem o seu.
        ...(config?.modoCaixa === 'COMPARTILHADO_POR_LOJA' ? {} : { operadorId: principal.id }),
      },
      select: { id: true },
    });

    if (!caixa && temDinheiro) {
      throw new ConflictException({
        codigo: 'CAIXA_FECHADO',
        mensagem: 'Abra o caixa antes de receber em dinheiro.',
      });
    }

    return caixa?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * A conta do caixa, aberta em parcelas.
   *
   * `esperado = abertura + suprimentos − sangrias + (dinheiro recebido − troco)`
   *
   * O troco é subtraído porque ele saiu da gaveta. Somar o dinheiro recebido
   * sem descontá-lo infla o esperado e transforma todo caixa que deu troco
   * numa falta.
   */
  private async calcularResumo(
    tx: ClienteEmTransacao,
    caixaId: string,
    valorAbertura: { toString(): string },
  ): Promise<ResumoFinanceiroCaixa> {
    const movimentos = await tx.movimentoCaixa.groupBy({
      by: ['tipo'],
      where: { caixaId },
      _sum: { valor: true },
    });

    const somaPorTipo = (tipo: string): Dec =>
      dec((movimentos.find((m) => m.tipo === tipo)?._sum.valor ?? 0).toString());

    const suprimentos = somaPorTipo('SUPRIMENTO');
    const sangrias = somaPorTipo('SANGRIA');

    const vendas = await tx.venda.findMany({
      where: { caixaId, status: 'CONCLUIDA' },
      select: {
        total: true,
        troco: true,
        pagamentos: { select: { forma: true, valor: true } },
      },
    });

    let dinheiroRecebido = dec(0);
    let troco = dec(0);
    let cartao = dec(0);
    let pix = dec(0);
    let outras = dec(0);
    let totalVendido = dec(0);

    for (const venda of vendas) {
      totalVendido = totalVendido.plus(dec(venda.total.toString()));
      troco = troco.plus(dec(venda.troco.toString()));

      for (const p of venda.pagamentos) {
        const valor = dec(p.valor.toString());

        if (p.forma === EM_ESPECIE) {
          dinheiroRecebido = dinheiroRecebido.plus(valor);
        } else if (p.forma === 'DEBITO' || p.forma === 'CREDITO') {
          cartao = cartao.plus(valor);
        } else if (p.forma === 'PIX') {
          pix = pix.plus(valor);
        } else {
          outras = outras.plus(valor);
        }
      }
    }

    const vendasEmDinheiro = dinheiroRecebido.minus(troco);

    const esperado = dec(valorAbertura.toString())
      .plus(suprimentos)
      .minus(sangrias)
      .plus(vendasEmDinheiro);

    return {
      valorAbertura: dec(valorAbertura.toString()).toFixed(2),
      suprimentos: suprimentos.toFixed(2),
      sangrias: sangrias.toFixed(2),
      dinheiroRecebido: dinheiroRecebido.toFixed(2),
      trocoDevolvido: troco.toFixed(2),
      vendasEmDinheiro: vendasEmDinheiro.toFixed(2),
      esperadoEmCaixa: esperado.toFixed(2),
      vendasEmCartao: cartao.toFixed(2),
      vendasEmPix: pix.toFixed(2),
      outrasFormas: outras.toFixed(2),
      totalVendido: totalVendido.toFixed(2),
      quantidadeVendas: vendas.length,
    };
  }

  private async proximoNumero(tx: ClienteEmTransacao, tenantId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ':caixa'))`;

    const linhas = await tx.$queryRaw<{ proximo: number }[]>`
      SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM caixa
    `;

    return linhas[0]?.proximo ?? 1;
  }

  private async exigirCaixa(
    tx: ClienteEmTransacao,
    id: string,
  ): Promise<{
    id: string;
    status: string;
    operadorId: string;
    valorAbertura: { toString(): string };
  }> {
    const caixa = await tx.caixa.findFirst({
      where: { id },
      select: { id: true, status: true, operadorId: true, valorAbertura: true },
    });

    if (!caixa) {
      throw new NotFoundException({
        codigo: 'CAIXA_NAO_ENCONTRADO',
        mensagem: 'Caixa não encontrado.',
      });
    }

    return caixa;
  }

  /**
   * O caixa é de quem o abriu.
   *
   * Sem `caixa.conferir`, ninguém mexe nem olha o caixa alheio: o valor da
   * gaveta de outra pessoa é o que ela vai ter de justificar no fechamento.
   */
  private exigirDonoOuConferente(operadorId: string, principal: Principal): void {
    if (operadorId === principal.id) {
      return;
    }

    if (principal.permissoes.has(PERM.caixa.conferir)) {
      return;
    }

    throw new ForbiddenException({
      codigo: 'CAIXA_DE_OUTRO_OPERADOR',
      mensagem: 'Este caixa é de outro operador.',
    });
  }

  private paraContrato(c: CaixaComRelacoes, resumo: ResumoFinanceiroCaixa): Caixa {
    return {
      id: c.id,
      numero: c.numero,
      status: c.status as Caixa['status'],
      lojaId: c.lojaId,
      loja: c.loja.nome,
      operadorId: c.operadorId,
      operador: c.operador.nome,
      valorAbertura: dec(c.valorAbertura.toString()).toFixed(2),
      valorContado: c.valorContado === null ? null : dec(c.valorContado.toString()).toFixed(2),
      valorEsperado: c.valorEsperado === null ? null : dec(c.valorEsperado.toString()).toFixed(2),
      diferenca: c.diferenca === null ? null : dec(c.diferenca.toString()).toFixed(2),
      observacaoAbertura: c.observacaoAbertura,
      observacaoFechamento: c.observacaoFechamento,
      observacaoConferencia: c.observacaoConferencia,
      abertoEm: c.abertoEm.toISOString(),
      fechadoEm: c.fechadoEm?.toISOString() ?? null,
      conferidoPor: c.conferidoPor?.nome ?? null,
      conferidoEm: c.conferidoEm?.toISOString() ?? null,
      resumo,
      movimentos: c.movimentos.map((m) => ({
        id: m.id,
        tipo: m.tipo as 'SANGRIA' | 'SUPRIMENTO',
        valor: dec(m.valor.toString()).toFixed(2),
        motivo: m.motivo,
        criadoEm: m.criadoEm.toISOString(),
      })),
    };
  }
}

interface Numerico {
  toString(): string;
}

interface CaixaComRelacoes {
  id: string;
  numero: number;
  status: string;
  lojaId: string;
  operadorId: string;
  valorAbertura: Numerico;
  valorContado: Numerico | null;
  valorEsperado: Numerico | null;
  diferenca: Numerico | null;
  observacaoAbertura: string | null;
  observacaoFechamento: string | null;
  observacaoConferencia: string | null;
  abertoEm: Date;
  fechadoEm: Date | null;
  conferidoEm: Date | null;
  loja: { nome: string };
  operador: { nome: string };
  conferidoPor: { nome: string } | null;
  movimentos: { id: string; tipo: string; valor: Numerico; motivo: string; criadoEm: Date }[];
}
