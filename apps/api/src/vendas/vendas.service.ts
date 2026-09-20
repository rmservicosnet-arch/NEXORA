import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BuscaItemVenda,
  CancelamentoVenda,
  ContextoPdv,
  DestinoDevolucao,
  DevolucaoVenda,
  ResultadoDevolucao,
  ItemParaVenda,
  FiltroVendas,
  NovaVenda,
  PaginaVendas,
  ResultadoVenda,
  Venda,
} from '@estoque/contracts';
import { PERM } from '@estoque/contracts';
import { dec, type Dec } from '@estoque/core';
import {
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import { CaixaService } from '../caixa/caixa.service';
import { CarteiraService } from '../carteira/carteira.service';
import { ContasService } from '../contas/contas.service';
import { AuditoriaService } from '../comum/auditoria.service';
import { EstoqueService } from '../estoque/estoque.service';
import { PRISMA } from '../infra/prisma/prisma.module';

interface Aviso {
  readonly codigo: string;
  readonly mensagem: string;
}

/** Formas que não podem passar do total. Dinheiro pode — vira troco. */
const SEM_TROCO = new Set([
  'PIX',
  'DEBITO',
  'CREDITO',
  'TRANSFERENCIA',
  'BOLETO',
  'PRAZO',
  'CARTEIRA',
]);

@Injectable()
export class VendasService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly estoque: EstoqueService,
    private readonly caixa: CaixaService,
    private readonly carteira: CarteiraService,
    private readonly contas: ContasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Concluir venda
  // -------------------------------------------------------------------------

  /**
   * Registra uma venda de balcão, inteira, numa transação só.
   *
   * Tudo acontece junto: numeração, itens com preço e custo congelados, baixa
   * de estoque e pagamentos. Se qualquer parte falhar, nada fica — venda com
   * estoque não baixado é divergência que ninguém encontra depois.
   */
  async criar(dados: NovaVenda, principal: Principal): Promise<ResultadoVenda> {
    const contexto = exigirContexto();
    const podeVerCusto = principal.permissoes.has(PERM.produto.verCusto);

    const { vendaId, avisos } = await comEscopoAtual(
      this.prisma,
      async (tx) => this.registrar(tx, dados, principal, { origem: 'PDV' }),
      // Uma venda com vinte itens faz vinte travamentos de saldo. O limite
      // padrao de 10 s e curto para o balcao em dia cheio.
      { tempoLimiteMs: 30_000 },
    );

    const venda = await this.detalhe(vendaId, podeVerCusto);

    await this.auditoria.registrar({
      contexto,
      acao: 'VENDA_CONCLUIDA',
      entidade: 'venda',
      entidadeId: vendaId,
      atorNome: principal.nome,
      depois: {
        numero: venda.numero,
        total: venda.total,
        itens: venda.itens.length,
        loja: venda.loja,
        formas: venda.pagamentos.map((p) => p.forma),
      },
    });

    return { venda, avisos };
  }

  /**
   * O corpo da venda, dentro da transacao de QUEM CHAMOU.
   *
   * Separado de `criar` porque o faturamento de um pedido precisa gravar a
   * venda na MESMA transacao em que consome a reserva e muda o status do
   * pedido. Pedido faturado sem venda — ou venda sem pedido faturado — e
   * divergencia que ninguem encontra depois.
   *
   * `criar` continua sendo o caminho do PDV; ele so abre a transacao e chama
   * isto. Uma segunda implementacao "para o pedido" seria uma segunda verdade
   * sobre preco, custo e baixa de estoque.
   */
  async registrar(
    tx: ClienteEmTransacao,
    dados: NovaVenda,
    principal: Principal,
    opcoes: {
      readonly origem: 'PDV' | 'PEDIDO';
      readonly pedidoId?: string;
      /**
       * Os precos ja vieram congelados do pedido.
       *
       * Sem isto, `resolverPreco` trataria cada preco informado como digitado
       * a mao e exigiria `preco.aplicar_desconto` de quem fatura — que nao
       * digitou nada: o preco e o que o cliente viu ao enviar o pedido.
       */
      readonly precosCongelados?: boolean;
    },
  ): Promise<{ vendaId: string; avisos: Aviso[] }> {
    const contexto = exigirContexto();

    {
      const local = dados.localId
        ? await this.estoque.resolverLocalDaLoja(tx, dados.localId, dados.lojaId)
        : await this.estoque.localPadraoDaLoja(tx, dados.lojaId);

      const { tabelaPrecoId, clienteId } = await this.resolverTabela(tx, dados);

      // Dinheiro exige caixa aberto; cartão e PIX, não — vão para a
      // adquirente, não para a gaveta. A recusa vem ANTES de qualquer
      // escrita: nada pior do que baixar estoque e descobrir no fim que a
      // venda não podia ser registrada. Ver docs/CASHBOX.md §3.
      const temDinheiro = dados.pagamentos.some((p) => p.forma === 'DINHEIRO');
      const caixaId = await this.caixa.caixaParaVenda(tx, dados.lojaId, temDinheiro, principal);

      // Numeração serializada por empresa. Duas vendas simultâneas pegariam
      // o mesmo `max(numero) + 1` e uma delas morreria no índice único —
      // no balcão, com o cliente esperando. O lock de transação resolve sem
      // custo perceptível: ele vale só até o commit.
      const numero = await this.proximoNumero(tx, contexto.tenantId);

      const venda = await tx.venda.create({
        data: {
          tenantId: contexto.tenantId,
          lojaId: dados.lojaId,
          localId: local.id,
          numero,
          origem: opcoes.origem,
          status: 'RASCUNHO',
          ...(opcoes.pedidoId ? { pedidoId: opcoes.pedidoId } : {}),
          ...(clienteId ? { clienteId } : {}),
          vendedorId: principal.id,
          ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
          ...(caixaId ? { caixaId } : {}),
          subtotal: '0',
          total: '0',
        },
        select: { id: true },
      });

      const avisosColetados: Aviso[] = [];
      let subtotal = dec(0);

      for (const item of dados.itens) {
        const preco = await this.resolverPreco(
          tx,
          item,
          tabelaPrecoId,
          principal,
          opcoes.precosCongelados ?? false,
        );
        const quantidade = dec(item.quantidade);
        const descontoItem = dec(item.descontoItem ?? '0');
        const totalItem = quantidade.times(preco.valor).minus(descontoItem);

        if (totalItem.lessThan(0)) {
          throw new BadRequestException({
            codigo: 'DESCONTO_MAIOR_QUE_ITEM',
            mensagem: `O desconto do item ${preco.sku} é maior que o próprio item.`,
          });
        }

        // A baixa acontece ANTES de gravar o item, porque é dela que sai o
        // custo congelado. Inverter a ordem obrigaria a um UPDATE depois —
        // e um UPDATE que falhasse deixaria a margem errada para sempre.
        const baixa = await this.estoque.baixarParaVenda(
          tx,
          {
            variacaoId: item.variacaoId,
            local,
            quantidade: item.quantidade,
            vendaId: venda.id,
            numeroVenda: String(numero),
          },
          principal,
        );

        avisosColetados.push(
          ...baixa.avisos.map((a) => ({
            codigo: a.codigo,
            mensagem: `${preco.sku}: ${a.mensagem}`,
          })),
        );

        await tx.vendaItem.create({
          data: {
            tenantId: contexto.tenantId,
            vendaId: venda.id,
            variacaoId: item.variacaoId,
            quantidade: quantidade.toFixed(6),
            precoUnitario: preco.valor.toFixed(2),
            descontoItem: descontoItem.toFixed(2),
            totalItem: totalItem.toFixed(2),
            ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
            precoOrigem: preco.origem,
            custoUnitario: baixa.custoUnitario.toFixed(6),
          },
        });

        subtotal = subtotal.plus(totalItem);
      }

      const desconto = dec(dados.desconto ?? '0');
      const acrescimo = dec(dados.acrescimo ?? '0');
      const total = subtotal.minus(desconto).plus(acrescimo);

      if (total.lessThan(0)) {
        throw new BadRequestException({
          codigo: 'TOTAL_NEGATIVO',
          mensagem: 'O desconto é maior que a venda.',
        });
      }

      if (desconto.greaterThan(0) && !principal.permissoes.has(PERM.preco.aplicarDesconto)) {
        throw new ForbiddenException({
          codigo: 'SEM_PERMISSAO_DESCONTO',
          mensagem: 'Você não tem permissão para conceder desconto.',
        });
      }

      const troco = await this.registrarPagamentos(tx, venda.id, dados, total, contexto.tenantId);

      // Pagamento em carteira DEBITA a conta corrente do cliente, na mesma
      // transação. Enquanto isto não existia, o PDV aceitava a forma
      // `CARTEIRA` e não lançava nada: a venda fechava e o cliente não devia
      // nada. Ver docs/WALLET.md §5.
      const emCarteira = dados.pagamentos
        .filter((p) => p.forma === 'CARTEIRA')
        .reduce((soma, p) => soma.plus(dec(p.valor)), dec(0));

      if (emCarteira.greaterThan(0)) {
        if (!clienteId) {
          throw new BadRequestException({
            codigo: 'CARTEIRA_EXIGE_CLIENTE',
            mensagem: 'Pagamento em carteira exige identificar o cliente.',
          });
        }

        const debito = await this.carteira.debitarPorVenda(
          tx,
          { clienteId, valor: emCarteira, vendaId: venda.id },
          principal,
        );

        if (debito.excedeuLimite) {
          avisosColetados.push({
            codigo: 'LIMITE_DE_CARTEIRA_EXCEDIDO',
            mensagem: `A compra passou do limite. O saldo do cliente ficou em R$ ${debito.saldoPosterior.toFixed(2)}.`,
          });
        } else {
          avisosColetados.push({
            codigo: 'DEBITADO_EM_CARTEIRA',
            mensagem: `R$ ${emCarteira.toFixed(2)} debitados. Saldo do cliente: R$ ${debito.saldoPosterior.toFixed(2)}.`,
          });
        }
      }

      /*
        VENDA A PRAZO — a metade que faltava do docs/WALLET.md §6.

        Ate aqui o PDV aceitava a forma `PRAZO` e NAO lancava nada: a venda
        fechava, a mercadoria saia e o cliente nao devia em lugar nenhum. O
        mesmo buraco que `CARTEIRA` teve.

        Quem decide o caminho e `cliente.usaCarteira` — o campo que a tela de
        clientes grava e que, ate agora, ninguem lia:

          com carteira → DEBITO `VENDA_A_PRAZO` no razao dela
          sem carteira → TITULO em contas a receber, com vencimento

        Nunca os dois. Fazer os dois infla o ativo pelo dobro, que e o erro
        contabil mais caro que um ERP pequeno costuma cometer.
      */
      const aPrazo = dados.pagamentos
        .filter((p) => p.forma === 'PRAZO')
        .reduce((soma, p) => soma.plus(dec(p.valor)), dec(0));

      if (aPrazo.greaterThan(0)) {
        if (!clienteId) {
          throw new BadRequestException({
            codigo: 'PRAZO_EXIGE_CLIENTE',
            mensagem: 'Venda a prazo exige identificar o cliente: alguem tem de dever.',
          });
        }

        const cliente = await tx.cliente.findFirst({
          where: { id: clienteId },
          select: { usaCarteira: true },
        });

        const temCarteira =
          cliente?.usaCarteira === true &&
          (await this.carteira.carteiraDoCliente(tx, clienteId)) !== null;

        if (temCarteira) {
          const debito = await this.carteira.debitarPorVenda(
            tx,
            { clienteId, valor: aPrazo, vendaId: venda.id, tipo: 'VENDA_A_PRAZO' },
            principal,
          );

          avisosColetados.push({
            codigo: 'LANCADO_NA_CARTEIRA',
            mensagem: `R$ ${aPrazo.toFixed(2)} a prazo na conta corrente. Saldo do cliente: R$ ${debito.saldoPosterior.toFixed(2)}.`,
          });
        } else {
          const vencimento = dados.pagamentos.find((p) => p.forma === 'PRAZO')?.vencimento;

          await this.contas.tituloDeVendaAPrazo(
            tx,
            {
              clienteId,
              vendaId: venda.id,
              numeroVenda: numero,
              lojaId: dados.lojaId,
              valor: aPrazo.toFixed(2),
              vencimento,
            },
            contexto,
          );

          avisosColetados.push({
            codigo: 'TITULO_A_RECEBER_GERADO',
            mensagem: `R$ ${aPrazo.toFixed(2)} viraram titulo em contas a receber.`,
          });
        }
      }

      await tx.venda.update({
        where: { id: venda.id },
        data: {
          status: 'CONCLUIDA',
          subtotal: subtotal.toFixed(2),
          desconto: desconto.toFixed(2),
          acrescimo: acrescimo.toFixed(2),
          total: total.toFixed(2),
          // Gravado, não derivado: é ele que a conferência de caixa
          // subtrai. Ver docs/CASHBOX.md §4.
          troco: troco.toFixed(2),
          concluidaEm: new Date(),
        },
      });

      if (troco.greaterThan(0)) {
        avisosColetados.push({
          codigo: 'TROCO',
          mensagem: `Troco de R$ ${troco.toFixed(2)}.`,
        });
      }

      return { vendaId: venda.id, avisos: avisosColetados };
    }
  }

  // -------------------------------------------------------------------------
  // Cancelar
  // -------------------------------------------------------------------------

  /**
   * Cancela uma venda concluída, devolvendo a mercadoria ao estoque.
   *
   * A venda **não** é apagada: muda de status, guarda o motivo e a hora. O
   * estoque volta por lançamento contrário, apontando para a saída original.
   * Um cancelamento que some do histórico é um cancelamento que ninguém
   * consegue auditar.
   */
  async cancelar(id: string, dados: CancelamentoVenda, principal: Principal): Promise<Venda> {
    const contexto = exigirContexto();
    let desfeito = { titulos: 0, debitos: 0 };

    await comEscopoAtual(
      this.prisma,
      async (tx) => {
        const venda = await tx.venda.findFirst({
          where: { id },
          include: { itens: true },
        });

        if (!venda) {
          throw new NotFoundException({
            codigo: 'VENDA_NAO_ENCONTRADA',
            mensagem: 'Venda não encontrada.',
          });
        }

        if (venda.status === 'CANCELADA') {
          throw new ConflictException({
            codigo: 'VENDA_JA_CANCELADA',
            mensagem: 'Esta venda já foi cancelada.',
          });
        }

        if (venda.status !== 'CONCLUIDA') {
          throw new ConflictException({
            codigo: 'VENDA_NAO_CONCLUIDA',
            mensagem: 'Só uma venda concluída pode ser cancelada.',
          });
        }

        /*
          O DINHEIRO PRIMEIRO — docs/WALLET.md §6.

          Cancelar estornava o estoque e mais nada: a mercadoria voltava para
          a prateleira e a divida ficava de pe. Quem levou a prazo continuava
          devendo por uma venda que o proprio sistema diz nao existir.

          O caixa ja estava protegido (a conferencia so soma venda CONCLUIDA),
          mas a carteira e o titulo nao — e cada um tem as suas regras e a sua
          auditoria, por isso o cancelamento CHAMA os dois em vez de escrever
          nas tabelas deles.

          Vem antes do estorno de estoque de proposito: `cancelarTitulosDeVenda`
          RECUSA quando ha baixa, e a recusa tem de chegar antes de a transacao
          ter feito trabalho. Estando tudo na mesma transacao o desfecho seria
          o mesmo; a diferenca e o erro que a pessoa le.
        */
        const titulosCancelados = await this.contas.cancelarTitulosDeVenda(tx, {
          vendaId: venda.id,
          numeroVenda: venda.numero,
          motivo: `Cancelamento da venda ${String(venda.numero)}: ${dados.motivo}`,
        });

        const debitosEstornados = venda.clienteId
          ? await this.carteira.estornarPorVendaCancelada(
              tx,
              {
                clienteId: venda.clienteId,
                vendaId: venda.id,
                motivo: `Cancelamento da venda ${String(venda.numero)}: ${dados.motivo}`,
              },
              principal,
            )
          : 0;

        desfeito = { titulos: titulosCancelados, debitos: debitosEstornados };

        const local = await this.estoque.resolverLocalDaLoja(tx, venda.localId, venda.lojaId);

        // Os movimentos originais desta venda, para o estorno apontar para
        // eles. Sem o vínculo, o razão teria uma entrada solta e ninguém
        // saberia que ela desfez algo.
        const originais = await tx.movimentoEstoque.findMany({
          where: { documentoTipo: 'VENDA', documentoId: venda.id, tipo: 'SAIDA_VENDA' },
          select: { id: true, variacaoId: true, quantidade: true },
        });

        for (const item of venda.itens) {
          const original = originais.find((m) => m.variacaoId === item.variacaoId);

          await this.estoque.estornarSaidaDeVenda(
            tx,
            {
              ...(original ? { movimentoOriginalId: original.id } : { movimentoOriginalId: '' }),
              variacaoId: item.variacaoId,
              local,
              quantidade: dec(item.quantidade.toString()).toFixed(6),
              // Reentra pelo custo congelado na venda, não pelo custo médio de
              // hoje. Ver docs/COST_POLICY.md.
              custoUnitario: dec(item.custoUnitario.toString()).toFixed(6),
              vendaId: venda.id,
              numeroVenda: String(venda.numero),
              motivo: `Cancelamento da venda ${String(venda.numero)}: ${dados.motivo}`,
            },
            principal,
          );
        }

        await tx.venda.update({
          where: { id: venda.id },
          data: {
            status: 'CANCELADA',
            canceladaEm: new Date(),
            motivoCancelamento: dados.motivo,
          },
        });
      },
      { tempoLimiteMs: 30_000 },
    );

    await this.auditoria.registrar({
      contexto,
      acao: 'VENDA_CANCELADA',
      entidade: 'venda',
      entidadeId: id,
      atorNome: principal.nome,
      motivo:
        desfeito.titulos + desfeito.debitos > 0
          ? `${dados.motivo} (desfeito: ${String(desfeito.debitos)} débito(s) na carteira, ${String(desfeito.titulos)} título(s))`
          : dados.motivo,
    });

    return this.detalhe(id, principal.permissoes.has(PERM.produto.verCusto));
  }

  /**
   * DEVOLUCAO PARCIAL.
   *
   * `venda_item.quantidade_devolvida` estava no banco desde o inicio,
   * `DEVOLVIDA_PARCIAL` e `DEVOLVIDA_TOTAL` estavam no enum, e nada gravava
   * nem um nem outro: devolver dois de dez so era possivel cancelando a venda
   * inteira — o que apaga o faturamento e o resto da mercadoria, que continua
   * com o cliente.
   *
   * O estoque reentra pelo custo CONGELADO na saida (COST_POLICY §5).
   *
   * O dinheiro desce uma cascata, na ordem INVERSA da venda:
   *
   *   1. TITULO em aberto — o cliente ainda devia por esta venda. A divida
   *      diminui antes de qualquer devolucao em dinheiro; devolver dinheiro a
   *      quem nao pagou seria pagar duas vezes.
   *   2. CARTEIRA — o debito que esta venda lancou, ate o que dela resta.
   *   3. O que sobrar ja foi PAGO. Volta em dinheiro pela gaveta, ate o que a
   *      venda recebeu em dinheiro; o restante vira credito na carteira.
   *
   * Sem carteira e sem dinheiro na venda — cartao ou PIX —, a API RECUSA. O
   * estorno acontece na maquineta, fora daqui, e gravar o numero num lugar
   * qualquer so para a operacao passar e exatamente o dinheiro sem dono que o
   * resto do sistema evita.
   */
  async devolver(
    id: string,
    dados: DevolucaoVenda,
    principal: Principal,
  ): Promise<ResultadoDevolucao> {
    const contexto = exigirContexto();

    const venda = await comEscopoAtual(this.prisma, async (tx) =>
      tx.venda.findFirst({ where: { id }, include: { itens: true, pagamentos: true } }),
    );

    if (!venda) {
      throw new NotFoundException({
        codigo: 'VENDA_NAO_ENCONTRADA',
        mensagem: 'Venda não encontrada.',
      });
    }

    if (venda.status === 'CANCELADA') {
      throw new ConflictException({
        codigo: 'VENDA_CANCELADA',
        mensagem: 'Esta venda foi cancelada: não há o que devolver.',
      });
    }

    if (venda.status === 'RASCUNHO') {
      throw new ConflictException({
        codigo: 'VENDA_NAO_CONCLUIDA',
        mensagem: 'Só uma venda concluída tem mercadoria para voltar.',
      });
    }

    /*
      Quanto cada item devolve, com o desconto do item carregado junto:
      `totalItem / quantidade` e o preco EFETIVO da unidade. Usar
      `precoUnitario` devolveria mais do que o cliente pagou.
    */
    const porItem = new Map<string, { quantidade: Dec; valor: Dec }>();
    let valorDevolvido = dec(0);

    for (const pedido of dados.itens) {
      const item = venda.itens.find((i) => i.id === pedido.itemId);

      if (!item) {
        throw new BadRequestException({
          codigo: 'ITEM_NAO_E_DESTA_VENDA',
          mensagem: 'Um dos itens informados não pertence a esta venda.',
        });
      }

      if (porItem.has(item.id)) {
        throw new BadRequestException({
          codigo: 'ITEM_REPETIDO',
          mensagem: 'O mesmo item aparece duas vezes na devolução. Some as quantidades.',
        });
      }

      const quantidade = dec(pedido.quantidade);
      const vendida = dec(item.quantidade.toString());
      const jaVolta = dec(item.quantidadeDevolvida.toString());
      const disponivel = vendida.minus(jaVolta);

      if (quantidade.greaterThan(disponivel)) {
        throw new ConflictException({
          codigo: 'DEVOLUCAO_ACIMA_DO_VENDIDO',
          mensagem: `Foram vendidas ${vendida.toFixed(0)} unidades e ${jaVolta.toFixed(0)} já voltaram. Restam ${disponivel.toFixed(0)}.`,
        });
      }

      const unitario = dec(item.totalItem.toString()).dividedBy(vendida);
      const valor = dec(unitario.times(quantidade).toFixed(2));

      porItem.set(item.id, { quantidade, valor });
      valorDevolvido = valorDevolvido.plus(valor);
    }

    /*
      O caixa e lido ANTES da transacao de escrita porque `meuCaixaAberto`
      abre a dele. Buscado sempre que a venda teve dinheiro: se a cascata
      chegar ate a gaveta e nao houver caixa, a operacao para com um erro que
      diz isso, em vez de mandar o dinheiro para outro lugar.
    */
    const recebidoEmDinheiro = venda.pagamentos
      .filter((p) => p.forma === 'DINHEIRO')
      .reduce((soma, pg) => soma.plus(dec(pg.valor.toString())), dec(0))
      .minus(dec(venda.troco.toString()));

    const caixaAberto = recebidoEmDinheiro.greaterThan(dec(0))
      ? await this.caixa.meuCaixaAberto(venda.lojaId, principal)
      : null;

    const clienteId = venda.clienteId;

    const temCarteira = clienteId
      ? (await comEscopoAtual(this.prisma, async (tx) =>
          this.carteira.carteiraDoCliente(tx, clienteId),
        )) !== null
      : false;

    const destinos: DestinoDevolucao[] = [];
    const motivo = `Devolução da venda ${String(venda.numero)}: ${dados.motivo}`;

    await comEscopoAtual(
      this.prisma,
      async (tx) => {
        const local = await this.estoque.resolverLocalDaLoja(tx, venda.localId, venda.lojaId);

        const originais = await tx.movimentoEstoque.findMany({
          where: { documentoTipo: 'VENDA', documentoId: venda.id, tipo: 'SAIDA_VENDA' },
          select: { id: true, variacaoId: true },
        });

        for (const [itemId, devolucao] of porItem) {
          const item = venda.itens.find((i) => i.id === itemId);
          if (!item) continue;

          const original = originais.find((m) => m.variacaoId === item.variacaoId);

          await this.estoque.estornarSaidaDeVenda(
            tx,
            {
              movimentoOriginalId: original?.id ?? '',
              variacaoId: item.variacaoId,
              local,
              quantidade: devolucao.quantidade.toFixed(6),
              // Custo CONGELADO na saída, não o médio de hoje: uma compra cara
              // feita depois faria a devolução valorizar mercadoria barata.
              custoUnitario: dec(item.custoUnitario.toString()).toFixed(6),
              vendaId: venda.id,
              numeroVenda: String(venda.numero),
              motivo,
            },
            principal,
          );

          await tx.vendaItem.update({
            where: { id: itemId },
            data: {
              quantidadeDevolvida: dec(item.quantidadeDevolvida.toString())
                .plus(devolucao.quantidade)
                .toFixed(6),
            },
          });
        }

        // --- a cascata do dinheiro ---------------------------------------
        let restante = valorDevolvido;

        const noTitulo = await this.contas.abaterPorDevolucao(tx, {
          vendaId: venda.id,
          valor: restante,
          motivo,
        });

        if (noTitulo.abatido.greaterThan(dec(0))) {
          restante = restante.minus(noTitulo.abatido);
          destinos.push({
            onde: 'TITULO',
            valor: noTitulo.abatido.toFixed(2),
            descricao:
              noTitulo.titulos === 1
                ? 'Abatido do título desta venda'
                : `Abatido de ${String(noTitulo.titulos)} títulos desta venda`,
          });
        }

        if (restante.greaterThan(dec(0)) && clienteId && temCarteira) {
          const naCarteira = await this.carteira.creditarPorDevolucao(
            tx,
            { clienteId, vendaId: venda.id, valor: restante, motivo },
            principal,
          );

          if (naCarteira.greaterThan(dec(0))) {
            restante = restante.minus(naCarteira);
            destinos.push({
              onde: 'CARTEIRA',
              valor: naCarteira.toFixed(2),
              descricao: 'Abatido do débito que esta venda deixou na carteira',
            });
          }
        }

        if (restante.greaterThan(dec(0))) {
          /*
            O que sobrou o cliente JA pagou. Em dinheiro, sai da gaveta — ate
            o que a venda recebeu em dinheiro, descontado o que devolucoes
            anteriores ja tiraram. O desconto e conservador de proposito: na
            duvida devolve menos pela gaveta e mais pela carteira, porque
            tirar dinheiro que nao entrou ali quebra a conferencia do turno.
          */
          const jaDevolvido = venda.itens.reduce((soma, i) => {
            const q = dec(i.quantidadeDevolvida.toString());
            if (!q.greaterThan(dec(0))) return soma;
            const unit = dec(i.totalItem.toString()).dividedBy(dec(i.quantidade.toString()));
            return soma.plus(dec(unit.times(q).toFixed(2)));
          }, dec(0));

          const gavetaDisponivel = recebidoEmDinheiro.minus(jaDevolvido);
          const emDinheiro = restante.greaterThan(gavetaDisponivel) ? gavetaDisponivel : restante;

          if (emDinheiro.greaterThan(dec(0))) {
            if (!caixaAberto) {
              throw new ConflictException({
                codigo: 'CAIXA_FECHADO',
                mensagem:
                  'Esta venda foi paga em dinheiro e a devolução sai da gaveta. Abra o seu caixa: dinheiro que sai sem aparecer na conferência do turno vira falta no fechamento.',
              });
            }

            await this.caixa.movimentarEm(
              tx,
              caixaAberto.id,
              { tipo: 'SANGRIA', valor: emDinheiro.toFixed(2), motivo: motivo.slice(0, 400) },
              principal,
            );

            restante = restante.minus(emDinheiro);
            destinos.push({
              onde: 'CAIXA',
              valor: emDinheiro.toFixed(2),
              descricao: 'Devolvido em dinheiro, pela gaveta',
            });
          }
        }

        if (restante.greaterThan(dec(0))) {
          if (!clienteId || !temCarteira) {
            throw new ConflictException({
              codigo: 'DEVOLUCAO_SEM_DESTINO',
              mensagem: `Restam R$ ${restante.toFixed(2)} para devolver e não há onde: a venda não foi em dinheiro e o cliente não tem carteira. O estorno no cartão ou no PIX acontece fora do sistema — cadastre a carteira do cliente para o crédito ficar registrado.`,
            });
          }

          const creditado = await this.carteira.creditarPorDevolucao(
            tx,
            { clienteId, vendaId: venda.id, valor: restante, motivo },
            principal,
          );

          if (!creditado.greaterThanOrEqualTo(restante)) {
            /*
              A carteira so aceita ate o que esta venda deixou nela. O que
              passa disso entrou por cartao ou PIX, e o estorno acontece fora
              do sistema: recusar e melhor do que creditar um valor que a
              venda nunca gerou.
            */
            throw new ConflictException({
              codigo: 'DEVOLUCAO_SEM_DESTINO',
              mensagem: `Restam R$ ${restante.minus(creditado).toFixed(2)} sem destino. O valor entrou por cartão ou PIX e o estorno acontece fora do sistema.`,
            });
          }

          destinos.push({
            onde: 'CARTEIRA',
            valor: creditado.toFixed(2),
            descricao: 'Creditado na carteira do cliente',
          });
        }

        // --- a venda passa a dizer o que aconteceu ------------------------
        const tudoVoltou = venda.itens.every((i) => {
          const agora = porItem.get(i.id)?.quantidade ?? dec(0);
          return dec(i.quantidadeDevolvida.toString())
            .plus(agora)
            .greaterThanOrEqualTo(dec(i.quantidade.toString()));
        });

        await tx.venda.update({
          where: { id: venda.id },
          data: { status: tudoVoltou ? 'DEVOLVIDA_TOTAL' : 'DEVOLVIDA_PARCIAL' },
        });
      },
      { tempoLimiteMs: 30_000 },
    );

    await this.auditoria.registrar({
      contexto,
      acao: 'VENDA_DEVOLVIDA',
      entidade: 'venda',
      entidadeId: id,
      atorNome: principal.nome,
      motivo: dados.motivo,
      depois: {
        valor: valorDevolvido.toFixed(2),
        destinos: destinos.map((d) => `${d.onde} ${d.valor}`),
      },
    });

    return {
      venda: await this.detalhe(id, principal.permissoes.has(PERM.produto.verCusto)),
      valorDevolvido: valorDevolvido.toFixed(2),
      destinos,
    };
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  async detalhe(id: string, podeVerCusto: boolean): Promise<Venda> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const venda = await tx.venda.findFirst({
        where: { id },
        include: this.inclusaoCompleta(),
      });

      if (!venda) {
        throw new NotFoundException({
          codigo: 'VENDA_NAO_ENCONTRADA',
          mensagem: 'Venda não encontrada.',
        });
      }

      return this.paraContrato(venda, podeVerCusto);
    });
  }

  async listar(
    filtro: FiltroVendas,
    principal: Principal,
    podeVerCusto: boolean,
  ): Promise<PaginaVendas> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.lojaId ? { lojaId: filtro.lojaId } : {}),
        ...(filtro.clienteId ? { clienteId: filtro.clienteId } : {}),
        ...(filtro.status ? { status: filtro.status } : {}),
        // Quem não tem `venda.ver_todas` vê apenas as próprias. O filtro por
        // vendedor que ele mandar não amplia isso.
        ...(principal.permissoes.has(PERM.venda.verTodas)
          ? filtro.vendedorId
            ? { vendedorId: filtro.vendedorId }
            : {}
          : { vendedorId: principal.id }),
        ...(filtro.de || filtro.ate
          ? {
              criadoEm: {
                ...(filtro.de ? { gte: new Date(filtro.de) } : {}),
                ...(filtro.ate ? { lte: new Date(filtro.ate) } : {}),
              },
            }
          : {}),
      };

      const linhas = await tx.venda.findMany({
        where: onde,
        orderBy: { id: 'desc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: this.inclusaoCompleta(),
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      const soma = await tx.venda.aggregate({
        where: { ...onde, status: 'CONCLUIDA' },
        _sum: { total: true },
      });

      return {
        itens: pagina.map((v) => this.paraContrato(v, podeVerCusto)),
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        totalVendido: dec((soma._sum.total ?? 0).toString()).toFixed(2),
      };
    });
  }

  /**
   * Busca itens para vender.
   *
   * Devolve o preço da tabela escolhida e o saldo **do local de venda daquela
   * loja** — não o saldo da rede. Mostrar o total da empresa faria o operador
   * prometer ao cliente uma peça que está em outra cidade.
   */
  async buscarItens(busca: BuscaItemVenda): Promise<ItemParaVenda[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const local = await this.estoque.localPadraoDaLoja(tx, busca.lojaId);

      const tabelaId =
        busca.tabelaPrecoId ??
        (
          await tx.tabelaPreco.findFirst({
            where: { padrao: true, status: 'ATIVO' },
            select: { id: true },
          })
        )?.id;

      /**
       * Sem termo, devolve o comeco do catalogo: e a grade com que o PDV
       * abre. Com termo, procura por codigo de barras, SKU, descricao e nome.
       */
      const procura = busca.termo
        ? {
            OR: [
              { codigoBarras: busca.termo },
              { sku: { contains: busca.termo, mode: 'insensitive' as const } },
              { descricao: { contains: busca.termo, mode: 'insensitive' as const } },
              { produto: { nome: { contains: busca.termo, mode: 'insensitive' as const } } },
            ],
          }
        : // Vitrine mostra o que ESTA no balcao. Abrir o PDV com uma tela de
          // itens zerados e oferecer o que nao da para vender; procurando
          // pelo nome, o item sem saldo continua aparecendo.
          { saldos: { some: { localId: local.id, quantidade: { gt: 0 } } } };

      const linhas = await tx.variacao.findMany({
        where: { status: 'ATIVO', ...procura },
        // Por nome quando e vitrine; por SKU quando e busca, que e como o
        // operador confere o que digitou.
        orderBy: busca.termo
          ? [{ sku: 'asc' as const }]
          : [{ produto: { nome: 'asc' as const } }, { sku: 'asc' as const }],
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
          precos: {
            where: tabelaId ? { tabelaPrecoId: tabelaId } : { tabelaPreco: { padrao: true } },
            select: { preco: true },
            take: 1,
          },
          saldos: {
            where: { localId: local.id },
            select: { quantidade: true },
            take: 1,
          },
        },
      });

      return linhas
        .map((v) => ({
          variacaoId: v.id,
          sku: v.sku,
          codigoBarras: v.codigoBarras,
          produto: v.produto.nome,
          descricaoVariacao: v.descricao,
          imagemPrincipalId: v.produto.imagens[0]?.id ?? null,
          preco: v.precos[0] ? dec(v.precos[0].preco.toString()).toFixed(2) : null,
          saldo: dec((v.saldos[0]?.quantidade ?? 0).toString()).toFixed(0),
          casouCodigoBarras: busca.termo.length > 0 && v.codigoBarras === busca.termo,
        }))
        .sort((a, b) => Number(b.casouCodigoBarras) - Number(a.casouCodigoBarras));
    });
  }

  /** O que o PDV precisa saber antes de abrir. */
  async contexto(principal: Principal): Promise<ContextoPdv> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const ctx = exigirContexto();

      const lojas = await tx.loja.findMany({
        where: { id: { in: [...(ctx.lojaIds ?? [])] }, status: 'ATIVO' },
        orderBy: { nome: 'asc' },
        include: {
          locais: {
            where: { padraoVenda: true, status: 'ATIVO' },
            select: { id: true, nome: true },
            take: 1,
          },
        },
      });

      const tabelas = await tx.tabelaPreco.findMany({
        where: { status: 'ATIVO' },
        orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
        select: { id: true, nome: true, chave: true, padrao: true },
      });

      return {
        lojas: lojas.map((l) => ({
          id: l.id,
          nome: l.nome,
          localPadraoId: l.locais[0]?.id ?? null,
          localPadrao: l.locais[0]?.nome ?? null,
        })),
        tabelas,
        podeDarDesconto: principal.permissoes.has(PERM.preco.aplicarDesconto),
        podeVenderSemSaldo: principal.permissoes.has(PERM.estoque.venderSemSaldo),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Próximo número da venda, serializado por empresa.
   *
   * `pg_advisory_xact_lock` vale até o fim da transação e é por empresa: duas
   * lojas da mesma rede não esperam uma pela outra, mas dois caixas da mesma
   * empresa nunca pegam o mesmo número.
   *
   * A alternativa — `SEQUENCE` — não serve: a numeração é por tenant, e uma
   * sequência global deixaria buracos visíveis para o cliente ("minha última
   * venda foi a 41, por que a próxima é a 87?").
   */
  private async proximoNumero(tx: ClienteEmTransacao, tenantId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ':venda'))`;

    const linhas = await tx.$queryRaw<{ proximo: number }[]>`
      SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM venda
    `;

    return linhas[0]?.proximo ?? 1;
  }

  private async resolverTabela(
    tx: ClienteEmTransacao,
    dados: NovaVenda,
  ): Promise<{ tabelaPrecoId: string | null; clienteId: string | null }> {
    let clienteId: string | null = null;
    let tabelaDoCliente: string | null = null;

    if (dados.clienteId) {
      const cliente = await tx.cliente.findFirst({
        where: { id: dados.clienteId },
        select: { id: true, tabelaPrecoId: true },
      });

      if (!cliente) {
        throw new NotFoundException({
          codigo: 'CLIENTE_NAO_ENCONTRADO',
          mensagem: 'Cliente não encontrado.',
        });
      }

      clienteId = cliente.id;
      tabelaDoCliente = cliente.tabelaPrecoId;
    }

    // Precedência: o que o operador escolheu, a tabela do cliente, a padrão.
    // O cliente Professor entra e o preço de professor aparece sozinho — mas
    // o operador ainda pode trocar, porque a exceção existe no balcão.
    const escolhida = dados.tabelaPrecoId ?? tabelaDoCliente;

    if (escolhida) {
      const tabela = await tx.tabelaPreco.findFirst({
        where: { id: escolhida, status: 'ATIVO' },
        select: { id: true },
      });

      if (!tabela) {
        throw new NotFoundException({
          codigo: 'TABELA_PRECO_NAO_ENCONTRADA',
          mensagem: 'Tabela de preço não encontrada ou inativa.',
        });
      }

      return { tabelaPrecoId: tabela.id, clienteId };
    }

    const padrao = await tx.tabelaPreco.findFirst({
      where: { padrao: true, status: 'ATIVO' },
      select: { id: true },
    });

    return { tabelaPrecoId: padrao?.id ?? null, clienteId };
  }

  private async resolverPreco(
    tx: ClienteEmTransacao,
    item: { variacaoId: string; precoUnitario?: string | undefined },
    tabelaPrecoId: string | null,
    principal: Principal,
    precoJaCongelado: boolean,
  ): Promise<{ valor: Dec; origem: string; sku: string }> {
    const variacao = await tx.variacao.findFirst({
      where: { id: item.variacaoId },
      select: { id: true, sku: true, status: true },
    });

    if (!variacao) {
      throw new NotFoundException({
        codigo: 'VARIACAO_NAO_ENCONTRADA',
        mensagem: 'Um dos itens não existe.',
      });
    }

    if (variacao.status !== 'ATIVO') {
      throw new ConflictException({
        codigo: 'VARIACAO_INATIVA',
        mensagem: `O item ${variacao.sku} está inativo e não pode ser vendido.`,
      });
    }

    if (item.precoUnitario !== undefined) {
      // Preco vindo de um pedido ja foi congelado no envio, e e o que o
      // cliente viu. Quem fatura nao digitou nada — exigir permissao de
      // desconto dele seria cobrar por uma decisao que nao foi dele.
      if (precoJaCongelado) {
        return { valor: dec(item.precoUnitario), origem: 'PEDIDO', sku: variacao.sku };
      }

      if (!principal.permissoes.has(PERM.preco.aplicarDesconto)) {
        throw new ForbiddenException({
          codigo: 'SEM_PERMISSAO_PRECO_MANUAL',
          mensagem: 'Você não tem permissão para alterar o preço na venda.',
        });
      }

      // `MANUAL` não é detalhe: o relatório de desconto precisa saber quais
      // preços alguém digitou à mão, e não dá para deduzir isso depois
      // comparando com a tabela, que pode ter mudado.
      return { valor: dec(item.precoUnitario), origem: 'MANUAL', sku: variacao.sku };
    }

    if (!tabelaPrecoId) {
      throw new ConflictException({
        codigo: 'SEM_TABELA_DE_PRECO',
        mensagem: 'Não há tabela de preço ativa para usar.',
      });
    }

    const preco = await tx.precoItem.findFirst({
      where: { tabelaPrecoId, variacaoId: item.variacaoId },
      select: { preco: true },
    });

    if (!preco) {
      throw new ConflictException({
        codigo: 'ITEM_SEM_PRECO',
        mensagem: `O item ${variacao.sku} não tem preço nesta tabela.`,
      });
    }

    return { valor: dec(preco.preco.toString()), origem: 'TABELA', sku: variacao.sku };
  }

  private async registrarPagamentos(
    tx: ClienteEmTransacao,
    vendaId: string,
    dados: NovaVenda,
    total: Dec,
    tenantId: string,
  ): Promise<Dec> {
    let recebido = dec(0);
    let emDinheiro = dec(0);

    for (const pagamento of dados.pagamentos) {
      const valor = dec(pagamento.valor);

      if (valor.lessThanOrEqualTo(0)) {
        throw new BadRequestException({
          codigo: 'PAGAMENTO_INVALIDO',
          mensagem: 'Todo pagamento precisa ter valor maior que zero.',
        });
      }

      recebido = recebido.plus(valor);
      if (pagamento.forma === 'DINHEIRO') {
        emDinheiro = emDinheiro.plus(valor);
      }

      await tx.vendaPagamento.create({
        data: {
          tenantId,
          vendaId,
          forma: pagamento.forma,
          valor: valor.toFixed(2),
          parcelas: pagamento.parcelas,
          ...(pagamento.bandeira ? { bandeira: pagamento.bandeira } : {}),
          ...(pagamento.ultimosQuatro ? { ultimosQuatro: pagamento.ultimosQuatro } : {}),
          ...(pagamento.autorizacao ? { autorizacao: pagamento.autorizacao } : {}),
        },
      });
    }

    if (recebido.lessThan(total)) {
      throw new BadRequestException({
        codigo: 'PAGAMENTO_INSUFICIENTE',
        mensagem: `Falta R$ ${total.minus(recebido).toFixed(2)} para fechar a venda.`,
      });
    }

    const troco = recebido.minus(total);

    // Só dinheiro devolve troco. Passar do total no cartão ou no PIX é erro de
    // digitação, e deixar passar vira um acerto manual no fechamento.
    if (troco.greaterThan(0)) {
      const semTroco = dados.pagamentos.some((p) => SEM_TROCO.has(p.forma));

      if (troco.greaterThan(emDinheiro) || (semTroco && emDinheiro.isZero())) {
        throw new BadRequestException({
          codigo: 'PAGAMENTO_EXCEDE_TOTAL',
          mensagem: `O pagamento passa R$ ${troco.toFixed(2)} do total, e só dinheiro devolve troco.`,
        });
      }
    }

    return troco;
  }

  private inclusaoCompleta() {
    return {
      loja: { select: { nome: true } },
      local: { select: { nome: true } },
      cliente: { select: { nome: true } },
      vendedor: { select: { nome: true } },
      tabelaPreco: { select: { nome: true } },
      pagamentos: true,
      itens: {
        include: {
          variacao: {
            select: { sku: true, descricao: true, produto: { select: { nome: true } } },
          },
        },
      },
    } as const;
  }

  private paraContrato(v: VendaComRelacoes, podeVerCusto: boolean): Venda {
    const total = dec(v.total.toString());

    let recebido = dec(0);
    for (const p of v.pagamentos) {
      recebido = recebido.plus(dec(p.valor.toString()));
    }

    let custoTotal = dec(0);
    for (const i of v.itens) {
      custoTotal = custoTotal.plus(
        dec(i.custoUnitario.toString()).times(dec(i.quantidade.toString())),
      );
    }

    const base: Venda = {
      id: v.id,
      numero: v.numero,
      status: v.status as Venda['status'],
      origem: v.origem as Venda['origem'],
      lojaId: v.lojaId,
      loja: v.loja.nome,
      local: v.local.nome,
      clienteId: v.clienteId,
      cliente: v.cliente?.nome ?? null,
      vendedorId: v.vendedorId,
      vendedor: v.vendedor.nome,
      tabelaPreco: v.tabelaPreco?.nome ?? null,
      subtotal: dec(v.subtotal.toString()).toFixed(2),
      desconto: dec(v.desconto.toString()).toFixed(2),
      acrescimo: dec(v.acrescimo.toString()).toFixed(2),
      total: total.toFixed(2),
      troco: recebido.minus(total).toFixed(2),
      concluidaEm: v.concluidaEm?.toISOString() ?? null,
      canceladaEm: v.canceladaEm?.toISOString() ?? null,
      motivoCancelamento: v.motivoCancelamento,
      itens: v.itens.map((i) => ({
        id: i.id,
        variacaoId: i.variacaoId,
        sku: i.variacao.sku,
        produto: i.variacao.produto.nome,
        descricaoVariacao: i.variacao.descricao,
        quantidade: dec(i.quantidade.toString()).toFixed(6),
        quantidadeDevolvida: dec(i.quantidadeDevolvida.toString()).toFixed(6),
        precoUnitario: dec(i.precoUnitario.toString()).toFixed(2),
        descontoItem: dec(i.descontoItem.toString()).toFixed(2),
        totalItem: dec(i.totalItem.toString()).toFixed(2),
        precoOrigem: i.precoOrigem,
        ...(podeVerCusto ? { custoUnitario: dec(i.custoUnitario.toString()).toFixed(6) } : {}),
      })),
      pagamentos: v.pagamentos.map((p) => ({
        forma: p.forma as Venda['pagamentos'][number]['forma'],
        valor: dec(p.valor.toString()).toFixed(2),
        parcelas: p.parcelas,
        bandeira: p.bandeira,
        ultimosQuatro: p.ultimosQuatro,
      })),
    };

    if (!podeVerCusto) {
      return base;
    }

    return {
      ...base,
      custoTotal: custoTotal.toFixed(2),
      margem: total.minus(custoTotal).toFixed(2),
    };
  }
}

/** O Decimal do Prisma. Só precisamos de 	oString() — dec faz o resto. */
interface Numerico {
  toString(): string;
}

interface VendaComRelacoes {
  id: string;
  numero: number;
  status: string;
  origem: string;
  lojaId: string;
  localId: string;
  clienteId: string | null;
  vendedorId: string;
  subtotal: Numerico;
  desconto: Numerico;
  acrescimo: Numerico;
  total: Numerico;
  concluidaEm: Date | null;
  canceladaEm: Date | null;
  motivoCancelamento: string | null;
  loja: { nome: string };
  local: { nome: string };
  cliente: { nome: string } | null;
  vendedor: { nome: string };
  tabelaPreco: { nome: string } | null;
  pagamentos: {
    forma: string;
    valor: Numerico;
    parcelas: number;
    bandeira: string | null;
    ultimosQuatro: string | null;
  }[];
  itens: {
    id: string;
    variacaoId: string;
    quantidade: Numerico;
    quantidadeDevolvida: Numerico;
    precoUnitario: Numerico;
    descontoItem: Numerico;
    totalItem: Numerico;
    precoOrigem: string;
    custoUnitario: Numerico;
    variacao: { sku: string; descricao: string; produto: { nome: string } };
  }[];
}
