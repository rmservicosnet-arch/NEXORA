import {
  type Compra,
  type EdicaoCompra,
  type EstornoCompra,
  type FiltroCompras,
  type AlteracaoFornecedor,
  type BuscaItemCompra,
  type Fornecedor,
  type ItemCompraResumo,
  type ItemParaComprar,
  type NovaCompra,
  type NovoFornecedor,
  type PaginaCompras,
} from '@estoque/contracts';
import { dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { EstoqueService } from '../estoque/estoque.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Compras — a porta por onde a mercadoria entra COM CUSTO.
 *
 * O documento não é o razão. Receber grava movimentos `ENTRADA_COMPRA`
 * imutáveis, e a compra guarda de onde eles vieram: fornecedor, nota, quem
 * recebeu e quando. Ver docs/COST_POLICY.md.
 *
 * Só o RASCUNHO se edita. Depois de recebida, a nota é história — e história
 * aqui não se reescreve: corrigir é estornar, que gera o lançamento contrário.
 */
@Injectable()
export class ComprasService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly estoque: EstoqueService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private readonly inclusao = {
    loja: { select: { nome: true } },
    local: { select: { nome: true } },
    fornecedor: { select: { nome: true } },
    itens: {
      orderBy: { criadoEm: 'asc' as const },
      include: {
        variacao: {
          select: {
            sku: true,
            descricao: true,
            produto: { select: { nome: true } },
          },
        },
      },
    },
  };

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  async listar(filtro: FiltroCompras): Promise<PaginaCompras> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.fornecedorId ? { fornecedorId: filtro.fornecedorId } : {}),
        ...(filtro.lojaId ? { lojaId: filtro.lojaId } : {}),
        ...(filtro.termo
          ? {
              OR: [
                { numeroNota: { contains: filtro.termo, mode: 'insensitive' as const } },
                { fornecedor: { nome: { contains: filtro.termo, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };

      const linhas = await tx.compra.findMany({
        where: onde,
        orderBy: { id: 'desc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: this.inclusao,
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      /*
        As contagens e o resumo saem do BANCO, nunca da página carregada.
        Contar `itens.length` daria um número que muda com o `limite` — a
        armadilha do "resumo contado sobre a página" já registrada.
      */
      const [total, rascunhos, recebidas, estornadas] = await Promise.all([
        tx.compra.count(),
        tx.compra.count({ where: { status: 'RASCUNHO' } }),
        tx.compra.count({ where: { status: 'RECEBIDA' } }),
        tx.compra.count({ where: { status: 'ESTORNADA' } }),
      ]);

      const resumo = await this.resumo(tx);

      const nomes = await this.nomesDosAtores(
        tx,
        pagina.flatMap((c) => [c.recebidaPorId, c.estornadaPorId]),
      );

      return {
        itens: pagina.map((c) => this.paraContrato(c, nomes)),
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        contagens: { total, rascunhos, recebidas, estornadas },
        resumo,
      };
    });
  }

  async detalhe(id: string): Promise<Compra> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const compra = await tx.compra.findFirst({ where: { id }, include: this.inclusao });

      if (!compra) {
        throw new NotFoundException({
          codigo: 'COMPRA_NAO_ENCONTRADA',
          mensagem: 'Compra não encontrada.',
        });
      }

      const nomes = await this.nomesDosAtores(tx, [compra.recebidaPorId, compra.estornadaPorId]);
      const contrato = this.paraContrato(compra, nomes);

      /*
        No rascunho, a tela precisa dizer o que vai acontecer com o custo médio
        ANTES de alguém apertar "receber" — e isso depende do saldo de hoje no
        local de destino, não de um número gravado.
      */
      if (compra.status === 'RASCUNHO' && compra.itens.length > 0) {
        const saldos = await tx.saldoEstoque.findMany({
          where: {
            localId: compra.localId,
            variacaoId: { in: compra.itens.map((i) => i.variacaoId) },
          },
          select: { variacaoId: true, quantidade: true, custoMedio: true },
        });

        const porVariacao = new Map(saldos.map((s) => [s.variacaoId, s]));

        return {
          ...contrato,
          itens: contrato.itens.map((i) => {
            const saldo = porVariacao.get(i.variacaoId);
            return {
              ...i,
              saldoAtual: saldo ? saldo.quantidade.toFixed(6) : '0.000000',
              custoMedioAtual: saldo ? saldo.custoMedio.toFixed(6) : '0.000000',
            };
          }),
        };
      }

      return contrato;
    });
  }

  // -------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------

  async criar(dados: NovaCompra, principal: Principal): Promise<Compra> {
    const contexto = exigirContexto();

    const id = await comEscopoAtual(this.prisma, async (tx) => {
      await this.exigirFornecedor(tx, dados.fornecedorId);
      const local = await this.estoque.resolverLocalDaLoja(tx, dados.localId, dados.lojaId);

      const criada = await tx.compra
        .create({
          data: {
            tenantId: contexto.tenantId,
            lojaId: local.lojaId,
            localId: local.id,
            fornecedorId: dados.fornecedorId,
            numeroNota: dados.numeroNota ?? null,
            emitidaEm: dados.emitidaEm ? new Date(dados.emitidaEm) : null,
            observacao: dados.observacao ?? null,
            valorTotal: this.somar(dados.itens),
            itens: {
              create: dados.itens.map((i) => ({
                tenantId: contexto.tenantId,
                variacaoId: i.variacaoId,
                quantidade: i.quantidade,
                custoUnitario: i.custoUnitario,
                total: dec(i.quantidade).times(dec(i.custoUnitario)).toFixed(2),
              })),
            },
          },
          select: { id: true },
        })
        .catch((erro: unknown) => {
          throw this.traduzirNotaRepetida(erro, dados.numeroNota);
        });

      return criada.id;
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'COMPRA_CRIADA',
      entidade: 'compra',
      entidadeId: id,
      atorNome: principal.nome,
      depois: { numeroNota: dados.numeroNota ?? null, itens: dados.itens.length },
    });

    return this.detalhe(id);
  }

  /**
   * Só o rascunho se edita.
   *
   * Depois de recebida, a nota já mexeu no custo médio de cada item dela.
   * Mudar a quantidade aqui não desfaria aquele movimento — deixaria o
   * documento dizendo uma coisa e o razão outra.
   */
  async editar(id: string, dados: EdicaoCompra, principal: Principal): Promise<Compra> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const compra = await this.exigirRascunho(tx, id);

      const localId = dados.localId ?? compra.localId;
      const lojaId = dados.lojaId ?? compra.lojaId;
      const local = await this.estoque.resolverLocalDaLoja(tx, localId, lojaId);

      if (dados.fornecedorId) {
        await this.exigirFornecedor(tx, dados.fornecedorId);
      }

      if (dados.itens) {
        // O rascunho não é razão: trocar os itens é substituir, não estornar.
        await tx.compraItem.deleteMany({ where: { compraId: id } });
        await tx.compraItem.createMany({
          data: dados.itens.map((i) => ({
            tenantId: contexto.tenantId,
            compraId: id,
            variacaoId: i.variacaoId,
            quantidade: i.quantidade,
            custoUnitario: i.custoUnitario,
            total: dec(i.quantidade).times(dec(i.custoUnitario)).toFixed(2),
          })),
        });
      }

      await tx.compra
        .update({
          where: { id },
          data: {
            lojaId: local.lojaId,
            localId: local.id,
            ...(dados.fornecedorId ? { fornecedorId: dados.fornecedorId } : {}),
            ...(dados.numeroNota !== undefined ? { numeroNota: dados.numeroNota || null } : {}),
            ...(dados.emitidaEm !== undefined
              ? { emitidaEm: dados.emitidaEm ? new Date(dados.emitidaEm) : null }
              : {}),
            ...(dados.observacao !== undefined ? { observacao: dados.observacao || null } : {}),
            ...(dados.itens ? { valorTotal: this.somar(dados.itens) } : {}),
          },
        })
        .catch((erro: unknown) => {
          throw this.traduzirNotaRepetida(erro, dados.numeroNota);
        });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'COMPRA_EDITADA',
      entidade: 'compra',
      entidadeId: id,
      atorNome: principal.nome,
    });

    return this.detalhe(id);
  }

  async remover(id: string, principal: Principal): Promise<void> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      await this.exigirRascunho(tx, id);
      await tx.compra.delete({ where: { id } });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'COMPRA_REMOVIDA',
      entidade: 'compra',
      entidadeId: id,
      atorNome: principal.nome,
    });
  }

  /**
   * Receber: a mercadoria entra e o custo médio muda.
   *
   * Tudo numa transação só — o documento entra inteiro ou não entra. Os custos
   * médios de antes e depois ficam CONGELADOS no item: uma compra de outubro
   * não pode reescrever o que esta nota fez com a média em setembro.
   */
  async receber(id: string, principal: Principal): Promise<Compra> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const compra = await this.exigirRascunho(tx, id);

      if (compra.itens.length === 0) {
        throw new BadRequestException({
          codigo: 'COMPRA_SEM_ITENS',
          mensagem: 'Uma nota sem itens não tem o que dar entrada.',
        });
      }

      const local = await this.estoque.resolverLocalDaLoja(tx, compra.localId, compra.lojaId);

      const feitos = await this.estoque.entradasDoDocumento(
        tx,
        {
          local,
          tipo: 'ENTRADA_COMPRA',
          documentoTipo: 'COMPRA',
          documentoId: compra.id,
          documentoNumero: compra.numeroNota ?? undefined,
          itens: compra.itens.map((i) => ({
            variacaoId: i.variacaoId,
            quantidade: i.quantidade.toFixed(6),
            custoUnitario: i.custoUnitario.toFixed(6),
          })),
        },
        principal,
        contexto,
      );

      const porVariacao = new Map(feitos.map((f) => [f.variacaoId, f]));

      for (const item of compra.itens) {
        const feito = porVariacao.get(item.variacaoId);
        if (!feito) continue;

        await tx.compraItem.update({
          where: { id: item.id },
          data: {
            custoMedioAntes: feito.custoMedioAntes,
            custoMedioDepois: feito.custoMedioDepois,
            movimentoId: feito.movimentoId,
          },
        });
      }

      await tx.compra.update({
        where: { id },
        data: {
          status: 'RECEBIDA',
          recebidaEm: new Date(),
          recebidaPorId: principal.id,
        },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'COMPRA_RECEBIDA',
      entidade: 'compra',
      entidadeId: id,
      atorNome: principal.nome,
    });

    return this.detalhe(id);
  }

  /**
   * Estornar: o lançamento contrário, nunca o apagamento.
   *
   * Cada item recebido gera uma SAÍDA de mesma quantidade referenciando o
   * movimento original. O custo médio se move de novo — e é por isso que o
   * motivo é obrigatório: quem olhar o razão daqui a um mês vê a média mudar
   * duas vezes e precisa saber por quê.
   */
  async estornar(id: string, dados: EstornoCompra, principal: Principal): Promise<Compra> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const compra = await tx.compra.findFirst({ where: { id }, include: { itens: true } });

      if (!compra) {
        throw new NotFoundException({
          codigo: 'COMPRA_NAO_ENCONTRADA',
          mensagem: 'Compra não encontrada.',
        });
      }

      if (compra.status !== 'RECEBIDA') {
        throw new ConflictException({
          codigo: 'COMPRA_NAO_RECEBIDA',
          mensagem:
            compra.status === 'RASCUNHO'
              ? 'Esta nota ainda não entrou no estoque: apague o rascunho em vez de estornar.'
              : 'Esta nota já foi estornada.',
        });
      }

      const local = await this.estoque.resolverLocalDaLoja(tx, compra.localId, compra.lojaId);

      await this.estoque.saidasDeEstorno(
        tx,
        {
          local,
          tipo: 'SAIDA_AJUSTE',
          documentoTipo: 'COMPRA_ESTORNO',
          documentoId: compra.id,
          documentoNumero: compra.numeroNota ?? undefined,
          justificativa: dados.motivo,
          itens: compra.itens.map((i) => ({
            variacaoId: i.variacaoId,
            quantidade: i.quantidade.toFixed(6),
            // Pelo custo DAQUELA nota, nao pelo medio de hoje: e o que
            // `aplicarSaidaComCustoEspecifico` existe para fazer.
            custoUnitario: i.custoUnitario.toFixed(6),
            estornoDeId: i.movimentoId ?? undefined,
          })),
        },
        principal,
        contexto,
      );

      await tx.compra.update({
        where: { id },
        data: {
          status: 'ESTORNADA',
          estornadaEm: new Date(),
          estornadaPorId: principal.id,
          motivoEstorno: dados.motivo,
        },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'COMPRA_ESTORNADA',
      entidade: 'compra',
      entidadeId: id,
      atorNome: principal.nome,
      motivo: dados.motivo,
    });

    return this.detalhe(id);
  }

  /**
   * Itens para comprar, com o saldo e o custo do DESTINO.
   *
   * Busca propria, nao a do PDV: quem compra precisa do custo, nao do preco de
   * venda. Mostrar preco ao lado do campo onde se digita custo e exatamente
   * como se troca um pelo outro.
   */
  async buscarItens(busca: BuscaItemCompra): Promise<ItemParaComprar[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const variacoes = await tx.variacao.findMany({
        where: {
          status: 'ATIVO',
          produto: { status: 'ATIVO' },
          ...(busca.termo
            ? {
                OR: [
                  { sku: { contains: busca.termo, mode: 'insensitive' as const } },
                  { descricao: { contains: busca.termo, mode: 'insensitive' as const } },
                  { produto: { nome: { contains: busca.termo, mode: 'insensitive' as const } } },
                ],
              }
            : {}),
        },
        orderBy: { sku: 'asc' },
        take: busca.limite,
        select: {
          id: true,
          sku: true,
          descricao: true,
          produto: { select: { nome: true } },
        },
      });

      if (variacoes.length === 0) return [];

      const ids = variacoes.map((v) => v.id);

      const [saldos, ultimas] = await Promise.all([
        tx.saldoEstoque.findMany({
          where: { localId: busca.localId, variacaoId: { in: ids } },
          select: { variacaoId: true, quantidade: true, custoMedio: true },
        }),
        /*
          O custo da ULTIMA entrada, como sugestao de preenchimento.
          E um numero que existiu de verdade — diferente de repetir o custo
          medio, que e uma media e nao o que o fornecedor cobrou da ultima vez.
        */
        tx.movimentoEstoque.findMany({
          where: { variacaoId: { in: ids }, sentido: 'ENTRADA', tipo: 'ENTRADA_COMPRA' },
          orderBy: { criadoEm: 'desc' },
          distinct: ['variacaoId'],
          select: { variacaoId: true, custoUnitario: true },
        }),
      ]);

      const porSaldo = new Map(saldos.map((x) => [x.variacaoId, x]));
      const porUltimo = new Map(ultimas.map((x) => [x.variacaoId, x.custoUnitario]));

      return variacoes.map((v) => {
        const saldo = porSaldo.get(v.id);
        const ultimo = porUltimo.get(v.id);
        return {
          variacaoId: v.id,
          sku: v.sku,
          produto: v.produto.nome,
          descricaoVariacao: v.descricao,
          saldoAtual: saldo ? saldo.quantidade.toFixed(6) : '0.000000',
          custoMedioAtual: saldo ? saldo.custoMedio.toFixed(6) : '0.000000',
          ultimoCusto: ultimo ? ultimo.toFixed(6) : null,
        };
      });
    });
  }

  // -------------------------------------------------------------------------
  // Fornecedores
  // -------------------------------------------------------------------------

  async fornecedores(incluirInativos = false): Promise<Fornecedor[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const linhas = await tx.fornecedor.findMany({
        where: incluirInativos ? {} : { status: 'ATIVO' },
        orderBy: { nome: 'asc' },
      });

      return linhas.map((f) => ({
        id: f.id,
        nome: f.nome,
        documento: f.documento,
        email: f.email,
        telefone: f.telefone,
        ativo: f.status === 'ATIVO',
      }));
    });
  }

  async criarFornecedor(dados: NovoFornecedor, principal: Principal): Promise<Fornecedor> {
    const contexto = exigirContexto();

    const criado = await comEscopoAtual(this.prisma, async (tx) =>
      tx.fornecedor
        .create({
          data: {
            tenantId: contexto.tenantId,
            nome: dados.nome,
            documento: dados.documento || null,
            email: dados.email || null,
            telefone: dados.telefone || null,
          },
        })
        .catch((erro: unknown) => {
          if (this.ehP2002(erro)) {
            throw new ConflictException({
              codigo: 'FORNECEDOR_DUPLICADO',
              mensagem: 'Já existe um fornecedor com este documento.',
            });
          }
          throw erro;
        }),
    );

    await this.auditoria.registrar({
      contexto,
      acao: 'FORNECEDOR_CRIADO',
      entidade: 'fornecedor',
      entidadeId: criado.id,
      atorNome: principal.nome,
      depois: { nome: criado.nome },
    });

    return {
      id: criado.id,
      nome: criado.nome,
      documento: criado.documento,
      email: criado.email,
      telefone: criado.telefone,
      ativo: criado.status === 'ATIVO',
    };
  }

  /**
   * Editar fornecedor, inclusive desativar.
   *
   * Desativar NAO apaga: o fornecedor aparece em notas ja recebidas, e apagar
   * deixaria compras orfas. Ele so sai da lista de escolha.
   */
  async alterarFornecedor(
    id: string,
    dados: AlteracaoFornecedor,
    principal: Principal,
  ): Promise<Fornecedor> {
    const contexto = exigirContexto();

    const alterado = await comEscopoAtual(this.prisma, async (tx) => {
      const atual = await tx.fornecedor.findFirst({ where: { id }, select: { id: true } });

      if (!atual) {
        throw new NotFoundException({
          codigo: 'FORNECEDOR_NAO_ENCONTRADO',
          mensagem: 'Fornecedor nao encontrado.',
        });
      }

      return tx.fornecedor
        .update({
          where: { id },
          data: {
            ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
            ...(dados.documento !== undefined ? { documento: dados.documento || null } : {}),
            ...(dados.email !== undefined ? { email: dados.email || null } : {}),
            ...(dados.telefone !== undefined ? { telefone: dados.telefone || null } : {}),
            ...(dados.ativo !== undefined ? { status: dados.ativo ? 'ATIVO' : 'INATIVO' } : {}),
          },
        })
        .catch((erro: unknown) => {
          if (this.ehP2002(erro)) {
            throw new ConflictException({
              codigo: 'FORNECEDOR_DUPLICADO',
              mensagem: 'Ja existe um fornecedor com este documento.',
            });
          }
          throw erro;
        });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'FORNECEDOR_ALTERADO',
      entidade: 'fornecedor',
      entidadeId: id,
      atorNome: principal.nome,
      depois: { nome: alterado.nome, ativo: alterado.status === 'ATIVO' },
    });

    return {
      id: alterado.id,
      nome: alterado.nome,
      documento: alterado.documento,
      email: alterado.email,
      telefone: alterado.telefone,
      ativo: alterado.status === 'ATIVO',
    };
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  private somar(itens: readonly { quantidade: string; custoUnitario: string }[]): string {
    return itens
      .reduce((soma, i) => soma.plus(dec(i.quantidade).times(dec(i.custoUnitario))), dec(0))
      .toFixed(2);
  }

  private async resumo(tx: ClienteEmTransacao): Promise<PaginaCompras['resumo']> {
    const inicioDoMes = new Date();
    inicioDoMes.setDate(1);
    inicioDoMes.setHours(0, 0, 0, 0);

    const [aReceber, recebidas, fornecedoresAtivos, semCusto] = await Promise.all([
      tx.compra.aggregate({
        where: { status: 'RASCUNHO' },
        _count: { _all: true },
        _sum: { valorTotal: true },
      }),
      tx.compra.aggregate({
        where: { status: 'RECEBIDA', recebidaEm: { gte: inicioDoMes } },
        _count: { _all: true },
        _sum: { valorTotal: true },
      }),
      tx.fornecedor.count({ where: { status: 'ATIVO' } }),
      /*
        Custo zero não é margem cheia: é item que nunca teve entrada com custo.
        Contá-los aqui é o que transforma "a margem está ótima" em "oito itens
        não têm custo".
      */
      tx.saldoEstoque.count({
        where: { custoMedio: 0, quantidade: { gt: 0 }, variacao: { status: 'ATIVO' } },
      }),
    ]);

    return {
      aReceber: aReceber._count._all,
      valorAReceber: (aReceber._sum.valorTotal ?? dec(0)).toFixed(2),
      recebidoNoPeriodo: (recebidas._sum.valorTotal ?? dec(0)).toFixed(2),
      notasNoPeriodo: recebidas._count._all,
      itensSemCusto: semCusto,
      fornecedoresAtivos,
    };
  }

  private async exigirRascunho(tx: ClienteEmTransacao, id: string) {
    const compra = await tx.compra.findFirst({ where: { id }, include: { itens: true } });

    if (!compra) {
      throw new NotFoundException({
        codigo: 'COMPRA_NAO_ENCONTRADA',
        mensagem: 'Compra não encontrada.',
      });
    }

    if (compra.status !== 'RASCUNHO') {
      throw new ConflictException({
        codigo: 'COMPRA_JA_RECEBIDA',
        mensagem:
          'Esta nota já entrou no estoque e mexeu no custo médio. Corrigir é estornar, não editar.',
      });
    }

    return compra;
  }

  private async exigirFornecedor(tx: ClienteEmTransacao, id: string): Promise<void> {
    const fornecedor = await tx.fornecedor.findFirst({ where: { id }, select: { status: true } });

    if (!fornecedor || fornecedor.status !== 'ATIVO') {
      throw new BadRequestException({
        codigo: 'FORNECEDOR_INVALIDO',
        mensagem: 'Fornecedor não encontrado ou desativado.',
      });
    }
  }

  private ehP2002(erro: unknown): boolean {
    return (
      typeof erro === 'object' &&
      erro !== null &&
      'code' in erro &&
      (erro as { code: unknown }).code === 'P2002'
    );
  }

  private traduzirNotaRepetida(erro: unknown, numeroNota?: string): unknown {
    if (this.ehP2002(erro)) {
      return new ConflictException({
        codigo: 'NOTA_JA_LANCADA',
        mensagem: numeroNota
          ? `A nota ${numeroNota} já foi lançada para este fornecedor. Lançar de novo dobraria a mercadoria e estragaria o custo médio.`
          : 'Esta nota já foi lançada para este fornecedor.',
      });
    }
    return erro;
  }

  /**
   * Resolve os nomes de quem recebeu e de quem estornou.
   *
   * Uma consulta por PAGINA, nao uma por linha. Sem isto a coluna "recebida
   * por" mostraria um uuid — a mesma armadilha do `ator_id` no razao.
   */
  private async nomesDosAtores(
    tx: ClienteEmTransacao,
    ids: (string | null)[],
  ): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unicos.length === 0) return new Map();

    const usuarios = await tx.usuario.findMany({
      where: { id: { in: unicos } },
      select: { id: true, nome: true },
    });

    return new Map(usuarios.map((u) => [u.id, u.nome]));
  }

  private paraContrato(
    compra: {
      id: string;
      status: string;
      lojaId: string;
      loja: { nome: string };
      localId: string;
      local: { nome: string };
      fornecedorId: string;
      fornecedor: { nome: string };
      numeroNota: string | null;
      emitidaEm: Date | null;
      observacao: string | null;
      valorTotal: { toFixed: (n: number) => string };
      recebidaEm: Date | null;
      recebidaPorId: string | null;
      estornadaEm: Date | null;
      estornadaPorId: string | null;
      motivoEstorno: string | null;
      criadoEm: Date;
      itens: {
        id: string;
        variacaoId: string;
        quantidade: { toFixed: (n: number) => string };
        custoUnitario: { toFixed: (n: number) => string };
        total: { toFixed: (n: number) => string };
        custoMedioAntes: { toFixed: (n: number) => string } | null;
        custoMedioDepois: { toFixed: (n: number) => string } | null;
        variacao: { sku: string; descricao: string; produto: { nome: string } };
      }[];
    },
    nomes: Map<string, string>,
  ): Compra {
    const itens: ItemCompraResumo[] = compra.itens.map((i) => ({
      id: i.id,
      variacaoId: i.variacaoId,
      sku: i.variacao.sku,
      produto: i.variacao.produto.nome,
      descricaoVariacao: i.variacao.descricao,
      quantidade: i.quantidade.toFixed(6),
      custoUnitario: i.custoUnitario.toFixed(6),
      total: i.total.toFixed(2),
      custoMedioAntes: i.custoMedioAntes ? i.custoMedioAntes.toFixed(6) : null,
      custoMedioDepois: i.custoMedioDepois ? i.custoMedioDepois.toFixed(6) : null,
    }));

    return {
      id: compra.id,
      status: compra.status as Compra['status'],
      lojaId: compra.lojaId,
      loja: compra.loja.nome,
      localId: compra.localId,
      local: compra.local.nome,
      fornecedorId: compra.fornecedorId,
      fornecedor: compra.fornecedor.nome,
      numeroNota: compra.numeroNota,
      emitidaEm: compra.emitidaEm?.toISOString() ?? null,
      observacao: compra.observacao,
      valorTotal: compra.valorTotal.toFixed(2),
      recebidaEm: compra.recebidaEm?.toISOString() ?? null,
      recebidaPor: compra.recebidaPorId ? (nomes.get(compra.recebidaPorId) ?? null) : null,
      estornadaEm: compra.estornadaEm?.toISOString() ?? null,
      estornadaPor: compra.estornadaPorId ? (nomes.get(compra.estornadaPorId) ?? null) : null,
      motivoEstorno: compra.motivoEstorno,
      criadoEm: compra.criadoEm.toISOString(),
      itens,
    };
  }
}
