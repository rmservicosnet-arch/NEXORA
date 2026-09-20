import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AceitePedido,
  BuscaCatalogo,
  ConfirmacaoPedido,
  DevolucaoPedido,
  FaturamentoPedido,
  FiltroPedidos,
  InclusaoItem,
  ItemCatalogo,
  NovoPedido,
  PaginaPedidos,
  Pedido,
  RemocaoItem,
  ResultadoCheckout,
  StatusPedido,
} from '@estoque/contracts';
import { PERM } from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type Contexto,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';
import { VendasService } from '../vendas/vendas.service';

/**
 * Transicoes permitidas. O que nao esta aqui e PROIBIDO.
 *
 * Escrito como tabela, e nao espalhado por `if`s, porque o ciclo de vida do
 * pedido e a parte do sistema que mais tenta crescer torta: cada caso novo
 * vira um `if` no meio de um metodo e, seis meses depois, ninguem sabe mais
 * quais caminhos existem. docs/ORDERS.md §3.
 */
const TRANSICOES: Readonly<Record<string, readonly StatusPedido[]>> = {
  RASCUNHO: ['AGUARDANDO_CONFIRMACAO', 'CANCELADO'],
  AGUARDANDO_CONFIRMACAO: [
    'AGUARDANDO_ACEITE_CLIENTE',
    'CONFIRMADO',
    'CONFIRMADO_PARCIALMENTE',
    'DEVOLVIDO',
    'RECUSADO',
    'CANCELADO',
    'EXPIRADO',
  ],
  AGUARDANDO_ACEITE_CLIENTE: ['AGUARDANDO_CONFIRMACAO', 'DEVOLVIDO', 'CANCELADO', 'EXPIRADO'],
  CONFIRMADO: ['FATURADO', 'CANCELADO', 'EXPIRADO'],
  CONFIRMADO_PARCIALMENTE: ['FATURADO', 'CANCELADO', 'EXPIRADO'],
  DEVOLVIDO: ['AGUARDANDO_CONFIRMACAO', 'CANCELADO'],
  FATURADO: ['CONCLUIDO'],
  // Finais.
  RECUSADO: [],
  CONCLUIDO: [],
  CANCELADO: [],
  EXPIRADO: [],
};

/** Os status que esperam acao da EQUIPE. E a fila de trabalho. */
const NA_FILA: readonly StatusPedido[] = [
  'AGUARDANDO_CONFIRMACAO',
  'CONFIRMADO',
  'CONFIRMADO_PARCIALMENTE',
];

@Injectable()
export class PedidosService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly vendas: VendasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Portal do cliente
  // -------------------------------------------------------------------------

  /**
   * O catalogo que o cliente ve.
   *
   * Apenas produtos PUBLICADOS, com preco da tabela DELE, e disponibilidade
   * como booleano. Nunca quantidade — nem aqui, nem em lugar nenhum do
   * portal. docs/ORDERS.md §7.
   */
  async catalogo(busca: BuscaCatalogo, principal: Principal): Promise<ItemCatalogo[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const { tabelaPrecoId, local } = await this.contextoDoCliente(tx, principal);

      // Sem tabela de preco nao ha catalogo: todo item apareceria sem preco, e
      // "consulte" convida a pedir para descobrir depois.
      if (!tabelaPrecoId) {
        throw new ConflictException({
          codigo: 'SEM_TABELA_DE_PRECO',
          mensagem: 'Não há tabela de preço para este cadastro. Fale com a loja.',
        });
      }

      const variacoes = await tx.variacao.findMany({
        where: {
          status: 'ATIVO',
          produto: { status: 'ATIVO', publicadoNoCatalogo: true },
          ...(busca.termo
            ? {
                OR: [
                  { sku: { contains: busca.termo, mode: 'insensitive' } },
                  { descricao: { contains: busca.termo, mode: 'insensitive' } },
                  { produto: { nome: { contains: busca.termo, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        orderBy: { sku: 'asc' },
        take: busca.limite,
        include: {
          produto: {
            select: {
              nome: true,
              imagens: {
                where: { excluidoEm: null, status: 'PRONTA', principal: true },
                select: { id: true },
                take: 1,
              },
            },
          },
          precos: { where: { tabelaPrecoId }, select: { preco: true }, take: 1 },
        },
      });

      const itens: ItemCatalogo[] = [];

      for (const v of variacoes) {
        const preco = v.precos[0];
        // Sem preco na tabela DELE, o item simplesmente nao existe para ele.
        // Mostrar "consulte" abriria a porta para pedir e descobrir depois.
        if (!preco) {
          continue;
        }

        const disponivel = await this.disponivel(tx, v.id, local.id);

        itens.push({
          variacaoId: v.id,
          sku: v.sku,
          produto: v.produto.nome,
          descricaoVariacao: v.descricao,
          imagemPrincipalId: v.produto.imagens[0]?.id ?? null,
          preco: dec(preco.preco.toString()).toFixed(2),
          // Booleano, nao numero.
          disponivel: disponivel.greaterThan(0),
        });
      }

      return itens;
    });
  }

  /**
   * O carrinho vira pedido — ou venda, conforme a configuracao da empresa.
   *
   * `modoCheckout` decide, e e a opcao pedida no requisito:
   *
   *   PEDIDO_COM_CONFIRMACAO  o carrinho vira pedido aguardando a equipe.
   *                           Nada acontece com estoque nem financeiro.
   *   PAGAMENTO_IMEDIATO      o carrinho vira VENDA na hora, debitada na
   *                           carteira do cliente. Sem carteira, recusa: nao
   *                           existe "pagamento automatico" sem uma conta de
   *                           onde tirar o dinheiro.
   */
  async checkout(dados: NovoPedido, principal: Principal): Promise<ResultadoCheckout> {
    const contexto = exigirContexto();

    const { config, doCliente } = await comEscopoAtual(this.prisma, async (tx) => ({
      config: await tx.tenantConfiguracao.findUnique({
        where: { tenantId: contexto.tenantId },
        select: { modoCheckout: true, validadePedidoHoras: true },
      }),
      doCliente: (await this.contextoDoCliente(tx, principal)).modoCheckout,
    }));

    // A sobreposicao por cliente vence a da empresa. Uma loja que atende
    // varejo e atacado quer pagamento imediato no varejo e pedido com
    // confirmacao no revendedor. docs/ORDERS.md §8.
    const modo = doCliente ?? config?.modoCheckout;

    if (modo === 'PAGAMENTO_IMEDIATO') {
      return this.checkoutComPagamento(dados, principal);
    }

    const pedidoId = await comEscopoAtual(
      this.prisma,
      async (tx) => {
        const { clienteId, tabelaPrecoId, loja, local } = await this.contextoDoCliente(
          tx,
          principal,
        );

        const numero = await this.proximoNumero(tx, contexto.tenantId);

        const pedido = await tx.pedido.create({
          data: {
            tenantId: contexto.tenantId,
            lojaId: loja.id,
            localId: local.id,
            numero,
            status: 'AGUARDANDO_CONFIRMACAO',
            clienteId,
            ...(principal.id ? { clienteAcessoId: principal.id } : {}),
            ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
            enviadoEm: new Date(),
            // Preco congelado vence aqui. Depois disso, preco maior exige
            // aceite do cliente. docs/ORDERS.md §5.
            validoAte: new Date(Date.now() + (config?.validadePedidoHoras ?? 72) * 60 * 60 * 1000),
            ...(dados.observacao ? { motivo: dados.observacao } : {}),
            valorSolicitado: '0',
          },
          select: { id: true },
        });

        let total = dec(0);

        for (const item of dados.itens) {
          const preco = await this.precoDoItem(tx, item.variacaoId, tabelaPrecoId);
          const quantidade = dec(item.quantidade);
          const totalItem = quantidade.times(preco);

          await tx.pedidoItem.create({
            data: {
              tenantId: contexto.tenantId,
              pedidoId: pedido.id,
              variacaoId: item.variacaoId,
              origem: 'SOLICITADO_CLIENTE',
              quantidadeSolicitada: quantidade.toFixed(6),
              precoUnitario: preco.toFixed(2),
              totalItem: totalItem.toFixed(2),
            },
          });

          total = total.plus(totalItem);
        }

        await tx.pedido.update({
          where: { id: pedido.id },
          data: {
            // O valor SOLICITADO e congelado e nunca recalculado: e contra ele
            // que qualquer edicao da equipe sera comparada.
            valorSolicitado: total.toFixed(2),
            valorConfirmado: total.toFixed(2),
          },
        });

        await this.registrarEvento(tx, contexto, {
          pedidoId: pedido.id,
          paraStatus: 'AGUARDANDO_CONFIRMACAO',
          atorTipo: 'CLIENTE',
          atorId: principal.id,
          atorNome: principal.nome,
          ...(dados.observacao ? { motivo: dados.observacao } : {}),
        });

        return pedido.id;
      },
      { tempoLimiteMs: 30_000 },
    );

    const pedido = await this.detalhe(pedidoId, principal, false);

    await this.auditoria.registrar({
      contexto,
      acao: 'PEDIDO_ENVIADO',
      entidade: 'pedido',
      entidadeId: pedidoId,
      atorNome: principal.nome,
      depois: { numero: pedido.numero, valor: pedido.valorSolicitado, itens: pedido.itens.length },
    });

    return {
      tipo: 'PEDIDO',
      pedido,
      vendaNumero: null,
      mensagem: `Pedido ${String(pedido.numero)} enviado. A equipe vai confirmar os itens disponíveis.`,
    };
  }

  /**
   * Checkout com pagamento imediato: vira venda, debitada na carteira.
   *
   * Nao existe "pagamento automatico" sem uma conta de onde tirar o dinheiro.
   * Um gateway de pagamento resolveria isso de outro jeito — e nao existe
   * ainda. Registrado em docs/ORDERS.md §8.
   */
  private async checkoutComPagamento(
    dados: NovoPedido,
    principal: Principal,
  ): Promise<ResultadoCheckout> {
    const resultado = await comEscopoAtual(
      this.prisma,
      async (tx) => {
        const { clienteId, tabelaPrecoId, loja } = await this.contextoDoCliente(tx, principal);

        const carteira = await tx.carteira.findFirst({
          where: { clienteId, status: 'ATIVO' },
          select: { id: true },
        });

        if (!carteira) {
          throw new ConflictException({
            codigo: 'SEM_CARTEIRA_PARA_PAGAMENTO_IMEDIATO',
            mensagem:
              'Esta loja cobra no ato, e este cadastro não tem conta corrente. Fale com a loja.',
          });
        }

        let total = dec(0);
        const itens: { variacaoId: string; quantidade: string; precoUnitario: string }[] = [];

        for (const item of dados.itens) {
          const preco = await this.precoDoItem(tx, item.variacaoId, tabelaPrecoId);
          total = total.plus(dec(item.quantidade).times(preco));
          itens.push({
            variacaoId: item.variacaoId,
            quantidade: item.quantidade,
            precoUnitario: preco.toFixed(2),
          });
        }

        return this.vendas.registrar(
          tx,
          {
            lojaId: loja.id,
            clienteId,
            ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
            itens,
            pagamentos: [{ forma: 'CARTEIRA', valor: total.toFixed(2), parcelas: 1 }],
          },
          principal,
          { origem: 'PEDIDO', precosCongelados: true },
        );
      },
      { tempoLimiteMs: 30_000 },
    );

    const venda = await this.vendas.detalhe(resultado.vendaId, false);

    return {
      tipo: 'VENDA',
      pedido: null,
      vendaNumero: venda.numero,
      mensagem: `Compra ${String(venda.numero)} concluída. R$ ${venda.total} debitados na sua conta.`,
    };
  }

  /**
   * O cliente aceita — ou recusa — o novo valor depois da edicao da equipe.
   *
   * O aceite NAO confirma o pedido nem reserva estoque. Ele autoriza o valor.
   * A confirmacao continua sendo ato da equipe. docs/ORDERS.md §6.
   */
  async aceitar(id: string, dados: AceitePedido, principal: Principal): Promise<Pedido> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const pedido = await this.exigirPedido(tx, id);

      if (pedido.status !== 'AGUARDANDO_ACEITE_CLIENTE') {
        throw new ConflictException({
          codigo: 'PEDIDO_NAO_AGUARDA_ACEITE',
          mensagem: 'Este pedido não está esperando o seu aceite.',
        });
      }

      const destino: StatusPedido = dados.aceita ? 'AGUARDANDO_CONFIRMACAO' : 'DEVOLVIDO';
      this.exigirTransicao(pedido.status, destino);

      await tx.pedido.update({
        where: { id },
        data: {
          status: destino,
          ...(dados.aceita
            ? { aceiteClienteEm: new Date(), aceiteClientePorId: principal.id }
            : { motivo: dados.motivo ?? 'Recusado pelo cliente' }),
        },
      });

      await this.registrarEvento(tx, contexto, {
        pedidoId: id,
        deStatus: pedido.status,
        paraStatus: destino,
        atorTipo: 'CLIENTE',
        atorId: principal.id,
        atorNome: principal.nome,
        motivo: dados.aceita
          ? 'Cliente aceitou o novo valor'
          : (dados.motivo ?? 'Cliente recusou o novo valor'),
      });
    });

    return this.detalhe(id, principal, false);
  }

  // -------------------------------------------------------------------------
  // Equipe: edicao dos itens
  // -------------------------------------------------------------------------

  /**
   * A equipe inclui um item combinado por fora do sistema.
   *
   * Entra com `quantidadeSolicitada = 0`: o cliente NAO pediu aquilo. O
   * relatorio de ruptura e a comparacao de valores dependem dessa distincao.
   *
   * Precificado AGORA, pela tabela do pedido — nao herda o congelamento do
   * envio. Cada linha carrega seu proprio instante. docs/ORDERS.md §6.
   */
  async incluirItem(id: string, dados: InclusaoItem, principal: Principal): Promise<Pedido> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const pedido = await this.exigirPedidoEditavel(tx, id);
      const preco = await this.precoDoItem(tx, dados.variacaoId, pedido.tabelaPrecoId);
      const quantidade = dec(dados.quantidade);

      await tx.pedidoItem.create({
        data: {
          tenantId: contexto.tenantId,
          pedidoId: id,
          variacaoId: dados.variacaoId,
          origem: 'ADICIONADO_EQUIPE',
          quantidadeSolicitada: '0',
          quantidadeConfirmada: quantidade.toFixed(6),
          precoUnitario: preco.toFixed(2),
          totalItem: quantidade.times(preco).toFixed(2),
          adicionadoPorId: principal.id,
        },
      });

      await this.recalcularConfirmado(tx, id);
      await this.marcarEdicao(tx, id, principal, `Incluiu item: ${dados.motivo}`);

      await this.registrarEvento(tx, contexto, {
        pedidoId: id,
        deStatus: pedido.status,
        paraStatus: pedido.status,
        atorTipo: 'FUNCIONARIO',
        atorId: principal.id,
        atorNome: principal.nome,
        motivo: `Incluiu ${quantidade.toFixed(0)} item(ns): ${dados.motivo}`,
      });
    });

    return this.detalhe(id, principal, true);
  }

  /**
   * Remocao e LOGICA e nao e devolucao.
   *
   * `REMOVIDO` = houve acordo com o cliente.
   * `DEVOLVIDO` = faltou saldo, e e falha de atendimento.
   *
   * Colapsar os dois inutilizaria o relatorio de ruptura: toda negociacao
   * normal apareceria como falta de estoque. docs/ORDERS.md §6.
   */
  async removerItem(
    id: string,
    itemId: string,
    dados: RemocaoItem,
    principal: Principal,
  ): Promise<Pedido> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const pedido = await this.exigirPedidoEditavel(tx, id);

      const item = await tx.pedidoItem.findFirst({
        where: { id: itemId, pedidoId: id },
        include: { variacao: { select: { sku: true } } },
      });

      if (!item) {
        throw new NotFoundException({
          codigo: 'ITEM_NAO_ENCONTRADO',
          mensagem: 'Item não encontrado neste pedido.',
        });
      }

      if (item.status === 'REMOVIDO') {
        throw new ConflictException({
          codigo: 'ITEM_JA_REMOVIDO',
          mensagem: 'Este item já foi removido.',
        });
      }

      await tx.pedidoItem.update({
        where: { id: itemId },
        data: {
          status: 'REMOVIDO',
          quantidadeConfirmada: '0',
          removidoPorId: principal.id,
          removidoEm: new Date(),
          motivoRemocao: dados.motivo,
        },
      });

      await this.recalcularConfirmado(tx, id);
      await this.marcarEdicao(tx, id, principal, `Removeu ${item.variacao.sku}: ${dados.motivo}`);

      await this.registrarEvento(tx, contexto, {
        pedidoId: id,
        deStatus: pedido.status,
        paraStatus: pedido.status,
        atorTipo: 'FUNCIONARIO',
        atorId: principal.id,
        atorNome: principal.nome,
        motivo: `Removeu ${item.variacao.sku}: ${dados.motivo}`,
      });
    });

    return this.detalhe(id, principal, true);
  }

  // -------------------------------------------------------------------------
  // Equipe: confirmacao
  // -------------------------------------------------------------------------

  /**
   * Confirma o pedido item a item, criando a reserva de estoque.
   *
   * A reserva nasce AQUI e nunca antes. Reservar na solicitacao travaria
   * estoque de todo carrinho enviado, inclusive os que nunca serao
   * confirmados — falta artificial numa loja de giro alto. A consequencia
   * aceita: dois pedidos disputam a ultima peca, e o primeiro a confirmar
   * leva. docs/ORDERS.md §2 e §4.
   */
  async confirmar(id: string, dados: ConfirmacaoPedido, principal: Principal): Promise<Pedido> {
    const contexto = exigirContexto();

    const { destino, semSaldo } = await comEscopoAtual(
      this.prisma,
      async (tx) => {
        const pedido = await this.exigirPedido(tx, id);

        if (pedido.status !== 'AGUARDANDO_CONFIRMACAO') {
          throw new ConflictException({
            codigo: 'PEDIDO_NAO_AGUARDA_CONFIRMACAO',
            mensagem: 'Só um pedido aguardando confirmação pode ser confirmado.',
          });
        }

        const config = await tx.tenantConfiguracao.findUnique({
          where: { tenantId: contexto.tenantId },
          select: { prazoReservaHoras: true },
        });

        const expiraEm = new Date(Date.now() + (config?.prazoReservaHoras ?? 168) * 60 * 60 * 1000);

        let algumConfirmado = false;
        let algumDevolvido = false;
        let algumSemSaldo = false;

        for (const linha of dados.itens) {
          const item = await tx.pedidoItem.findFirst({
            where: { id: linha.itemId, pedidoId: id },
            include: { variacao: { select: { sku: true } } },
          });

          if (!item) {
            throw new NotFoundException({
              codigo: 'ITEM_NAO_ENCONTRADO',
              mensagem: 'Item não encontrado neste pedido.',
            });
          }

          // Item removido por acordo nao volta pela confirmacao.
          if (item.status === 'REMOVIDO') {
            continue;
          }

          const confirmada = dec(linha.quantidadeConfirmada);
          const solicitada = dec(item.quantidadeSolicitada.toString());
          const desejada = solicitada.greaterThan(0)
            ? solicitada
            : dec(item.quantidadeConfirmada.toString());

          if (confirmada.greaterThan(desejada)) {
            throw new BadRequestException({
              codigo: 'CONFIRMOU_MAIS_QUE_O_PEDIDO',
              mensagem: `${item.variacao.sku}: não dá para confirmar mais do que foi pedido.`,
            });
          }

          if (confirmada.isZero()) {
            await tx.pedidoItem.update({
              where: { id: item.id },
              data: {
                status: 'DEVOLVIDO',
                quantidadeConfirmada: '0',
                motivoDevolucao: linha.motivoDevolucao ?? 'Sem saldo disponivel',
              },
            });
            algumDevolvido = true;
            continue;
          }

          if (confirmada.lessThan(desejada)) {
            algumDevolvido = true;
          }

          // Disponivel = saldo − reservas ATIVAS. E este numero, nao o saldo
          // fisico, que decide se da para prometer a mercadoria.
          const disponivel = await this.disponivel(tx, item.variacaoId, pedido.localId);
          const excede = confirmada.greaterThan(disponivel);

          if (excede) {
            if (!principal.permissoes.has(PERM.pedido.confirmarSemSaldo)) {
              throw new ConflictException({
                codigo: 'SEM_SALDO_DISPONIVEL',
                mensagem:
                  `${item.variacao.sku}: disponível ${disponivel.toFixed(0)}, ` +
                  `confirmando ${confirmada.toFixed(0)}. Você não tem permissão para confirmar sem saldo.`,
              });
            }

            if ((dados.justificativaSemSaldo?.trim().length ?? 0) < 5) {
              throw new ConflictException({
                codigo: 'JUSTIFICATIVA_OBRIGATORIA',
                mensagem: 'Confirmar acima do disponível exige justificativa.',
              });
            }

            algumSemSaldo = true;
          }

          await tx.pedidoItem.update({
            where: { id: item.id },
            data: {
              status: 'CONFIRMADO',
              quantidadeConfirmada: confirmada.toFixed(6),
              totalItem: confirmada.times(dec(item.precoUnitario.toString())).toFixed(2),
              confirmadoSemSaldo: excede,
            },
          });

          // A reserva e um COMPROMISSO, nao uma movimentacao: nao entra em
          // `movimento_estoque` e nao muda o saldo fisico. Reserva que expira
          // nao deixa rastro no razao, porque nada se moveu.
          await tx.estoqueReserva.create({
            data: {
              tenantId: contexto.tenantId,
              variacaoId: item.variacaoId,
              localId: pedido.localId,
              pedidoId: id,
              pedidoItemId: item.id,
              quantidade: confirmada.toFixed(6),
              status: 'ATIVA',
              expiraEm,
              criadaPorId: principal.id,
            },
          });

          algumConfirmado = true;
        }

        if (!algumConfirmado) {
          throw new ConflictException({
            codigo: 'NENHUM_ITEM_CONFIRMADO',
            mensagem: 'Nenhum item pode ser confirmado. Use devolver ou recusar.',
          });
        }

        if (algumDevolvido && !principal.permissoes.has(PERM.pedido.confirmarParcial)) {
          throw new ForbiddenException({
            codigo: 'SEM_PERMISSAO_PARCIAL',
            mensagem: 'Você não tem permissão para confirmar apenas parte do pedido.',
          });
        }

        const statusFinal: StatusPedido = algumDevolvido ? 'CONFIRMADO_PARCIALMENTE' : 'CONFIRMADO';

        this.exigirTransicao(pedido.status, statusFinal);
        await this.recalcularConfirmado(tx, id);

        await tx.pedido.update({
          where: { id },
          data: {
            status: statusFinal,
            confirmadoEm: new Date(),
            confirmadoPorId: principal.id,
          },
        });

        await this.registrarEvento(tx, contexto, {
          pedidoId: id,
          deStatus: pedido.status,
          paraStatus: statusFinal,
          atorTipo: 'FUNCIONARIO',
          atorId: principal.id,
          atorNome: principal.nome,
          ...(dados.justificativaSemSaldo ? { motivo: dados.justificativaSemSaldo } : {}),
        });

        return { destino: statusFinal, semSaldo: algumSemSaldo };
      },
      { tempoLimiteMs: 30_000 },
    );

    await this.auditoria.registrar({
      contexto,
      acao: semSaldo ? 'PEDIDO_CONFIRMADO_SEM_SALDO' : 'PEDIDO_CONFIRMADO',
      entidade: 'pedido',
      entidadeId: id,
      atorNome: principal.nome,
      ...(dados.justificativaSemSaldo ? { motivo: dados.justificativaSemSaldo } : {}),
      depois: { status: destino },
    });

    return this.detalhe(id, principal, true);
  }

  /** Devolve o pedido inteiro ao cliente, com motivo. */
  async devolver(id: string, dados: DevolucaoPedido, principal: Principal): Promise<Pedido> {
    return this.encerrar(id, 'DEVOLVIDO', dados.motivo, principal, 'PEDIDO_DEVOLVIDO');
  }

  /** Recusa o pedido. Final — nao volta. */
  async recusar(id: string, dados: DevolucaoPedido, principal: Principal): Promise<Pedido> {
    return this.encerrar(id, 'RECUSADO', dados.motivo, principal, 'PEDIDO_RECUSADO');
  }

  /**
   * Cancela um pedido confirmado, LIBERANDO a reserva.
   *
   * Sem liberar, o estoque fica preso a um pedido que nao vai acontecer — e a
   * disponibilidade do catalogo passa a mentir para todo mundo.
   */
  async cancelar(id: string, dados: DevolucaoPedido, principal: Principal): Promise<Pedido> {
    return this.encerrar(id, 'CANCELADO', dados.motivo, principal, 'PEDIDO_CANCELADO');
  }

  // -------------------------------------------------------------------------
  // Faturamento
  // -------------------------------------------------------------------------

  /**
   * O pedido confirmado vira VENDA.
   *
   * Pelo MESMO servico que o PDV usa: mesma baixa de estoque, mesmo custo
   * medio congelado, mesmo caixa, mesma carteira. Relatorio de faturamento,
   * custo e comissao nao precisam saber se a venda nasceu no balcao ou num
   * pedido. docs/ORDERS.md §1.
   *
   * Tudo na mesma transacao: consumir a reserva, gravar a venda e mudar o
   * status. Pedido faturado sem venda — ou o contrario — e divergencia que
   * ninguem encontra depois.
   */
  async faturar(
    id: string,
    dados: FaturamentoPedido,
    principal: Principal,
  ): Promise<{ pedido: Pedido; vendaNumero: number }> {
    const contexto = exigirContexto();

    const vendaId = await comEscopoAtual(
      this.prisma,
      async (tx) => {
        const pedido = await this.exigirPedido(tx, id);

        if (pedido.status !== 'CONFIRMADO' && pedido.status !== 'CONFIRMADO_PARCIALMENTE') {
          throw new ConflictException({
            codigo: 'PEDIDO_NAO_CONFIRMADO',
            mensagem: 'Só um pedido confirmado pode ser faturado.',
          });
        }

        this.exigirTransicao(pedido.status, 'FATURADO');

        const itens = await tx.pedidoItem.findMany({
          where: { pedidoId: id, status: 'CONFIRMADO' },
        });

        if (itens.length === 0) {
          throw new ConflictException({
            codigo: 'NADA_A_FATURAR',
            mensagem: 'Este pedido não tem item confirmado.',
          });
        }

        const resultado = await this.vendas.registrar(
          tx,
          {
            lojaId: pedido.lojaId,
            localId: pedido.localId,
            clienteId: pedido.clienteId,
            ...(pedido.tabelaPrecoId ? { tabelaPrecoId: pedido.tabelaPrecoId } : {}),
            itens: itens.map((i) => ({
              variacaoId: i.variacaoId,
              quantidade: dec(i.quantidadeConfirmada.toString()).toFixed(6),
              // O preco e o que o cliente viu ao enviar o pedido.
              precoUnitario: dec(i.precoUnitario.toString()).toFixed(2),
            })),
            pagamentos: dados.pagamentos,
          },
          principal,
          { origem: 'PEDIDO', pedidoId: id, precosCongelados: true },
        );

        // A reserva foi CONSUMIDA: virou baixa de estoque de verdade. Nao e
        // liberacao — a mercadoria saiu.
        await tx.estoqueReserva.updateMany({
          where: { pedidoId: id, status: 'ATIVA' },
          data: { status: 'CONSUMIDA', consumidaEm: new Date() },
        });

        await tx.pedido.update({
          where: { id },
          data: { status: 'FATURADO', faturadoEm: new Date() },
        });

        await this.registrarEvento(tx, contexto, {
          pedidoId: id,
          deStatus: pedido.status,
          paraStatus: 'FATURADO',
          atorTipo: 'FUNCIONARIO',
          atorId: principal.id,
          atorNome: principal.nome,
        });

        return resultado.vendaId;
      },
      { tempoLimiteMs: 30_000 },
    );

    const venda = await this.vendas.detalhe(vendaId, false);

    await this.auditoria.registrar({
      contexto,
      acao: 'PEDIDO_FATURADO',
      entidade: 'pedido',
      entidadeId: id,
      atorNome: principal.nome,
      depois: { vendaNumero: venda.numero, total: venda.total },
    });

    return { pedido: await this.detalhe(id, principal, true), vendaNumero: venda.numero };
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  async listar(
    filtro: FiltroPedidos,
    _principal: Principal,
    daEquipe: boolean,
  ): Promise<PaginaPedidos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.lojaId ? { lojaId: filtro.lojaId } : {}),
        ...(filtro.clienteId && daEquipe ? { clienteId: filtro.clienteId } : {}),
        ...(filtro.apenasFila ? { status: { in: [...NA_FILA] } } : {}),
        // Rascunho e estado interno; nunca aparece em lista nenhuma.
        ...(filtro.status ? {} : { NOT: { status: 'RASCUNHO' as const } }),
      };

      const linhas = await tx.pedido.findMany({
        where: onde,
        orderBy: { id: 'desc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: this.inclusao(),
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      const naFila = await tx.pedido.count({ where: { status: { in: [...NA_FILA] } } });

      /**
       * As contagens das abas saem do BANCO, nao da pagina carregada.
       *
       * Contar `itens.length` daria um numero que muda com o `limite` — uma
       * aba "Faturados 30" que na verdade sao 240. E o escopo do RLS ja
       * limita a empresa; `count` aqui conta o que a pessoa pode ver.
       */
      const [aguardando, comOCliente, confirmados, devolvidos, faturados] = await Promise.all([
        tx.pedido.count({ where: { status: 'AGUARDANDO_CONFIRMACAO' } }),
        tx.pedido.count({ where: { status: 'AGUARDANDO_ACEITE_CLIENTE' } }),
        tx.pedido.count({
          where: { status: { in: ['CONFIRMADO', 'CONFIRMADO_PARCIALMENTE'] } },
        }),
        tx.pedido.count({ where: { status: { in: ['DEVOLVIDO', 'RECUSADO'] } } }),
        tx.pedido.count({ where: { status: { in: ['FATURADO', 'CONCLUIDO'] } } }),
      ]);

      const itens: Pedido[] = [];
      for (const p of pagina) {
        itens.push(await this.paraContrato(tx, p, daEquipe));
      }

      return {
        itens,
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        naFila,
        contagens: { aguardando, comOCliente, confirmados, devolvidos, faturados },
      };
    });
  }

  async detalhe(id: string, _principal: Principal, daEquipe: boolean): Promise<Pedido> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const pedido = await tx.pedido.findFirst({ where: { id }, include: this.inclusao() });

      if (!pedido) {
        // 404 e nao 403: no portal o RLS ja escondeu o pedido de outro
        // cliente, e para a equipe o pedido de outra empresa nao existe.
        throw new NotFoundException({
          codigo: 'PEDIDO_NAO_ENCONTRADO',
          mensagem: 'Pedido não encontrado.',
        });
      }

      return this.paraContrato(tx, pedido, daEquipe);
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Disponivel = saldo fisico − reservas ATIVAS.
   *
   * E este numero que decide a disponibilidade no catalogo e o que a equipe ve
   * ao confirmar. O saldo fisico continua sendo o de `saldo_estoque`: reserva
   * nao e movimentacao. docs/ORDERS.md §4.
   */
  /**
   * Disponivel = saldo − reservas ativas nao vencidas, no local.
   *
   * Passa por `disponivel_no_local`, funcao SQL, e nao por duas consultas do
   * Prisma. O motivo e o RLS: `estoque_reserva` tem politica RESTRICTIVE que
   * devolve ZERO linhas quando `app.cliente_id` esta definido — ou seja, em
   * todo o portal. A decisao esta certa (reserva revela quantidade, e o
   * cliente so ve disponivel/indisponivel), mas com ela `saldo − reservas`
   * virava `saldo − 0`, e o catalogo anunciava "pronta entrega" para item
   * inteiramente reservado.
   *
   * A funcao e `SECURITY DEFINER` e devolve so um NUMERO: o cliente nao
   * enumera reserva nenhuma, so recebe a mesma resposta que a equipe receberia.
   * O filtro de tenant e feito dentro dela, a mao — ver a migracao.
   */
  private async disponivel(
    tx: ClienteEmTransacao,
    variacaoId: string,
    localId: string,
  ): Promise<Dec> {
    const linhas = await tx.$queryRaw<{ disponivel: string }[]>`
      SELECT disponivel_no_local(${variacaoId}::uuid, ${localId}::uuid)::text AS disponivel
    `;

    return dec(linhas[0]?.disponivel ?? '0');
  }

  private async contextoDoCliente(
    tx: ClienteEmTransacao,
    principal: Principal,
  ): Promise<{
    clienteId: string;
    tabelaPrecoId: string | null;
    modoCheckout: 'PAGAMENTO_IMEDIATO' | 'PEDIDO_COM_CONFIRMACAO' | null;
    loja: { id: string };
    local: { id: string };
  }> {
    const clienteId = principal.clienteId;

    if (!clienteId) {
      throw new ForbiddenException({
        codigo: 'SEM_CLIENTE_NO_TOKEN',
        mensagem: 'Esta rota é do portal do cliente.',
      });
    }

    const cliente = await tx.cliente.findFirst({
      where: { id: clienteId },
      select: { id: true, tabelaPrecoId: true, modoCheckout: true },
    });

    if (!cliente) {
      throw new NotFoundException({
        codigo: 'CLIENTE_NAO_ENCONTRADO',
        mensagem: 'Cadastro não encontrado.',
      });
    }

    // O cliente nao escolhe loja: o pedido cai na primeira loja ativa que
    // tenha local padrão de venda. Direcionamento por regiao ou por cadastro
    // e uma decisao comercial que ainda nao foi tomada — registrada em
    // docs/ORDERS.md.
    const local = await tx.localEstoque.findFirst({
      where: { padraoVenda: true, status: 'ATIVO', loja: { status: 'ATIVO' } },
      orderBy: { loja: { nome: 'asc' } },
      select: { id: true, lojaId: true },
    });

    if (!local) {
      throw new ConflictException({
        codigo: 'SEM_LOJA_PARA_ATENDER',
        mensagem: 'Nenhuma loja ativa com local padrão de venda.',
      });
    }

    const loja = { id: local.lojaId };

    const tabela = cliente.tabelaPrecoId
      ? { id: cliente.tabelaPrecoId }
      : await tx.tabelaPreco.findFirst({ where: { padrao: true, status: 'ATIVO' } });

    return {
      clienteId: cliente.id,
      tabelaPrecoId: tabela?.id ?? null,
      // `null` no cliente significa "usa o padrao da empresa". Quem decide
      // e quem chamou.
      modoCheckout: cliente.modoCheckout,
      loja,
      local: { id: local.id },
    };
  }

  private async precoDoItem(
    tx: ClienteEmTransacao,
    variacaoId: string,
    tabelaPrecoId: string | null,
  ): Promise<Dec> {
    if (!tabelaPrecoId) {
      throw new ConflictException({
        codigo: 'SEM_TABELA_DE_PRECO',
        mensagem: 'Não há tabela de preço para este cadastro.',
      });
    }

    const preco = await tx.precoItem.findFirst({
      where: { tabelaPrecoId, variacaoId },
      select: { preco: true },
    });

    if (!preco) {
      const variacao = await tx.variacao.findFirst({
        where: { id: variacaoId },
        select: { sku: true },
      });

      throw new ConflictException({
        codigo: 'ITEM_SEM_PRECO',
        mensagem: `${variacao?.sku ?? 'O item'} não tem preço na sua tabela.`,
      });
    }

    return dec(preco.preco.toString());
  }

  /** Transicao nao listada em `TRANSICOES` e proibida. */
  private exigirTransicao(de: string, para: StatusPedido): void {
    const permitidas = TRANSICOES[de] ?? [];

    if (!permitidas.includes(para)) {
      throw new ConflictException({
        codigo: 'TRANSICAO_INVALIDA',
        mensagem: `Um pedido em ${de} não pode ir para ${para}.`,
      });
    }
  }

  private async exigirPedido(
    tx: ClienteEmTransacao,
    id: string,
  ): Promise<{
    id: string;
    status: StatusPedido;
    lojaId: string;
    localId: string;
    clienteId: string;
    tabelaPrecoId: string | null;
    valorSolicitado: { toString(): string };
  }> {
    const pedido = await tx.pedido.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        lojaId: true,
        localId: true,
        clienteId: true,
        tabelaPrecoId: true,
        valorSolicitado: true,
      },
    });

    if (!pedido) {
      throw new NotFoundException({
        codigo: 'PEDIDO_NAO_ENCONTRADO',
        mensagem: 'Pedido não encontrado.',
      });
    }

    return { ...pedido, status: pedido.status as StatusPedido };
  }

  private async exigirPedidoEditavel(
    tx: ClienteEmTransacao,
    id: string,
  ): Promise<{ id: string; status: StatusPedido; tabelaPrecoId: string | null }> {
    const pedido = await this.exigirPedido(tx, id);

    // Depois de confirmado existe reserva de estoque. Mexer nos itens ali
    // exigiria desfazer e refazer reserva — e o cliente ja recebeu a
    // confirmacao. Cancela-se e refaz-se.
    if (pedido.status !== 'AGUARDANDO_CONFIRMACAO') {
      throw new ConflictException({
        codigo: 'PEDIDO_NAO_EDITAVEL',
        mensagem: 'Só um pedido aguardando confirmação pode ter os itens alterados.',
      });
    }

    return pedido;
  }

  /**
   * Recalcula o confirmado e decide se o cliente precisa aceitar.
   *
   * A comparacao e sempre contra `valorSolicitado`, que e congelado no envio.
   * Total maior sem registro de que o cliente concordou deixa a loja sem
   * defesa numa contestacao — e o alinhamento aconteceu por telefone, fora do
   * sistema. docs/ORDERS.md §6.
   */
  private async recalcularConfirmado(tx: ClienteEmTransacao, id: string): Promise<void> {
    const itens = await tx.pedidoItem.findMany({
      where: { pedidoId: id, status: { notIn: ['REMOVIDO', 'CANCELADO'] } },
      select: { quantidadeConfirmada: true, quantidadeSolicitada: true, precoUnitario: true },
    });

    let total = dec(0);
    for (const i of itens) {
      const confirmada = dec(i.quantidadeConfirmada.toString());
      const solicitada = dec(i.quantidadeSolicitada.toString());
      // Antes da confirmacao, o que vale e o solicitado; o item incluido pela
      // equipe entra com solicitada zero e confirmada preenchida.
      const quantidade = confirmada.greaterThan(0) ? confirmada : solicitada;
      total = total.plus(quantidade.times(dec(i.precoUnitario.toString())));
    }

    await tx.pedido.update({
      where: { id },
      data: { valorConfirmado: total.toFixed(2) },
    });
  }

  private async marcarEdicao(
    tx: ClienteEmTransacao,
    id: string,
    principal: Principal,
    resumo: string,
  ): Promise<void> {
    const contexto = exigirContexto();

    const pedido = await tx.pedido.findFirstOrThrow({
      where: { id },
      select: { status: true, valorSolicitado: true, valorConfirmado: true },
    });

    const config = await tx.tenantConfiguracao.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { exigirAceiteAumento: true },
    });

    const solicitado = dec(pedido.valorSolicitado.toString());
    const confirmado = dec(pedido.valorConfirmado.toString());
    const subiu = confirmado.greaterThan(solicitado);

    await tx.pedido.update({
      where: { id },
      data: {
        editadoPelaEquipeEm: new Date(),
        editadoPorId: principal.id,
        resumoAlteracao: resumo.slice(0, 400),
        // Total maior com aceite exigido: o pedido para e espera um toque do
        // cliente. A equipe nao confirma sozinha algo acima do que foi pedido.
        ...(subiu && config?.exigirAceiteAumento !== false
          ? { status: 'AGUARDANDO_ACEITE_CLIENTE' as const }
          : {}),
      },
    });

    if (
      subiu &&
      config?.exigirAceiteAumento !== false &&
      pedido.status !== 'AGUARDANDO_ACEITE_CLIENTE'
    ) {
      await this.registrarEvento(tx, contexto, {
        pedidoId: id,
        deStatus: pedido.status,
        paraStatus: 'AGUARDANDO_ACEITE_CLIENTE',
        atorTipo: 'SISTEMA',
        motivo: `Total passou de R$ ${solicitado.toFixed(2)} para R$ ${confirmado.toFixed(2)} — aguardando aceite do cliente`,
      });
    }
  }

  private async encerrar(
    id: string,
    destino: StatusPedido,
    motivo: string,
    principal: Principal,
    acao: string,
  ): Promise<Pedido> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const pedido = await this.exigirPedido(tx, id);
      this.exigirTransicao(pedido.status, destino);

      // Liberar a reserva e obrigatorio: sem isso o estoque fica preso a um
      // pedido que nao vai acontecer, e a disponibilidade do catalogo passa a
      // mentir para todo mundo.
      await tx.estoqueReserva.updateMany({
        where: { pedidoId: id, status: 'ATIVA' },
        data: { status: 'LIBERADA', liberadaEm: new Date() },
      });

      await tx.pedido.update({
        where: { id },
        data: { status: destino, motivo, encerradoEm: new Date() },
      });

      await this.registrarEvento(tx, contexto, {
        pedidoId: id,
        deStatus: pedido.status,
        paraStatus: destino,
        atorTipo: 'FUNCIONARIO',
        atorId: principal.id,
        atorNome: principal.nome,
        motivo,
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao,
      entidade: 'pedido',
      entidadeId: id,
      atorNome: principal.nome,
      motivo,
    });

    return this.detalhe(id, principal, true);
  }

  private async proximoNumero(tx: ClienteEmTransacao, tenantId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ':pedido'))`;

    const linhas = await tx.$queryRaw<{ proximo: number }[]>`
      SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM pedido
    `;

    return linhas[0]?.proximo ?? 1;
  }

  private async registrarEvento(
    tx: ClienteEmTransacao,
    contexto: Contexto,
    evento: {
      pedidoId: string;
      deStatus?: StatusPedido;
      paraStatus: StatusPedido;
      atorTipo: 'FUNCIONARIO' | 'CLIENTE' | 'SISTEMA';
      atorId?: string;
      atorNome?: string;
      motivo?: string;
    },
  ): Promise<void> {
    await tx.pedidoEvento.create({
      data: {
        tenantId: contexto.tenantId,
        pedidoId: evento.pedidoId,
        ...(evento.deStatus ? { deStatus: evento.deStatus } : {}),
        paraStatus: evento.paraStatus,
        atorTipo: evento.atorTipo,
        ...(evento.atorId ? { atorId: evento.atorId } : {}),
        ...(evento.atorNome ? { atorNome: evento.atorNome } : {}),
        ...(evento.motivo ? { motivo: evento.motivo } : {}),
      },
    });
  }

  private inclusao() {
    return {
      loja: { select: { nome: true } },
      cliente: { select: { nome: true, telefone: true } },
      clienteAcesso: { select: { nome: true } },
      tabelaPreco: { select: { id: true, nome: true } },
      venda: { select: { numero: true } },
      eventos: { orderBy: { criadoEm: 'asc' as const } },
      itens: {
        orderBy: { criadoEm: 'asc' as const },
        include: {
          variacao: {
            select: {
              sku: true,
              descricao: true,
              produto: {
                select: {
                  nome: true,
                  imagens: {
                    where: { excluidoEm: null, status: 'PRONTA' as const, principal: true },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private async paraContrato(
    tx: ClienteEmTransacao,
    p: PedidoComRelacoes,
    daEquipe: boolean,
  ): Promise<Pedido> {
    const solicitado = dec(p.valorSolicitado.toString());
    const confirmado = dec(p.valorConfirmado.toString());

    const itens: Pedido['itens'] = [];

    for (const i of p.itens) {
      const base = {
        id: i.id,
        variacaoId: i.variacaoId,
        sku: i.variacao.sku,
        produto: i.variacao.produto.nome,
        descricaoVariacao: i.variacao.descricao,
        imagemPrincipalId: i.variacao.produto.imagens[0]?.id ?? null,
        origem: i.origem as Pedido['itens'][number]['origem'],
        status: i.status as Pedido['itens'][number]['status'],
        quantidadeSolicitada: dec(i.quantidadeSolicitada.toString()).toFixed(0),
        quantidadeConfirmada: dec(i.quantidadeConfirmada.toString()).toFixed(0),
        precoUnitario: dec(i.precoUnitario.toString()).toFixed(2),
        totalItem: dec(i.totalItem.toString()).toFixed(2),
        motivoDevolucao: i.motivoDevolucao,
        motivoRemocao: i.motivoRemocao,
        confirmadoSemSaldo: i.confirmadoSemSaldo,
      };

      // `disponivelAgora` é quantidade. So a EQUIPE ve. No portal a chave nem
      // existe no JSON — esconder a coluna na tela e mandar o numero seria o
      // mesmo que nao ter regra. docs/ORDERS.md §7.
      itens.push(
        daEquipe
          ? {
              ...base,
              disponivelAgora: (await this.disponivel(tx, i.variacaoId, p.localId)).toFixed(0),
            }
          : base,
      );
    }

    return {
      id: p.id,
      numero: p.numero,
      status: p.status as Pedido['status'],
      lojaId: p.lojaId,
      loja: p.loja.nome,
      clienteId: p.clienteId,
      cliente: p.cliente.nome,
      clienteTelefone: p.cliente.telefone ?? null,
      solicitante: p.clienteAcesso?.nome ?? null,
      tabelaPreco: p.tabelaPreco?.nome ?? null,
      tabelaPrecoId: p.tabelaPreco?.id ?? null,
      valorSolicitado: solicitado.toFixed(2),
      valorConfirmado: confirmado.toFixed(2),
      diferenca: confirmado.minus(solicitado).toFixed(2),
      resumoAlteracao: p.resumoAlteracao,
      motivo: p.motivo,
      validoAte: p.validoAte?.toISOString() ?? null,
      enviadoEm: p.enviadoEm?.toISOString() ?? null,
      confirmadoEm: p.confirmadoEm?.toISOString() ?? null,
      faturadoEm: p.faturadoEm?.toISOString() ?? null,
      aceiteClienteEm: p.aceiteClienteEm?.toISOString() ?? null,
      vendaNumero: p.venda?.numero ?? null,
      itens,
      eventos: p.eventos.map((e) => ({
        id: e.id,
        criadoEm: e.criadoEm.toISOString(),
        deStatus: (e.deStatus ?? null) as Pedido['eventos'][number]['deStatus'],
        paraStatus: e.paraStatus as Pedido['status'],
        ator: e.atorNome,
        atorTipo: e.atorTipo as Pedido['eventos'][number]['atorTipo'],
        motivo: e.motivo,
      })),
    };
  }
}

interface Numerico {
  toString(): string;
}

interface PedidoComRelacoes {
  id: string;
  numero: number;
  status: string;
  lojaId: string;
  localId: string;
  clienteId: string;
  valorSolicitado: Numerico;
  valorConfirmado: Numerico;
  resumoAlteracao: string | null;
  motivo: string | null;
  validoAte: Date | null;
  enviadoEm: Date | null;
  confirmadoEm: Date | null;
  faturadoEm: Date | null;
  aceiteClienteEm: Date | null;
  loja: { nome: string };
  cliente: { nome: string; telefone: string | null };
  clienteAcesso: { nome: string } | null;
  tabelaPreco: { id: string; nome: string } | null;
  venda: { numero: number } | null;
  eventos: {
    id: string;
    criadoEm: Date;
    deStatus: string | null;
    paraStatus: string;
    atorTipo: string;
    atorNome: string | null;
    motivo: string | null;
  }[];
  itens: {
    id: string;
    variacaoId: string;
    origem: string;
    status: string;
    quantidadeSolicitada: Numerico;
    quantidadeConfirmada: Numerico;
    precoUnitario: Numerico;
    totalItem: Numerico;
    motivoDevolucao: string | null;
    motivoRemocao: string | null;
    confirmadoSemSaldo: boolean;
    variacao: {
      sku: string;
      descricao: string;
      produto: { nome: string; imagens: { id: string }[] };
    };
  }[];
}
