import {
  type BaixaTitulo,
  type CancelamentoTitulo,
  type FiltroTitulos,
  type NovoTitulo,
  type PaginaTitulos,
  type SituacaoTitulo,
  type Titulo,
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
import { CaixaService } from '../caixa/caixa.service';
import { CarteiraService } from '../carteira/carteira.service';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/**
 * Contas — títulos com vencimento, a pagar e a receber.
 *
 * A fronteira com a carteira, por escrito: o saldo do revendedor continua
 * sendo o dela. Este módulo NÃO cria um segundo saldo — acrescenta a DATA, que
 * a carteira não tem. Dar baixa num título a receber lança a quitação NA
 * carteira, e é ela que continua mandando no limite de crédito.
 *
 * Dois lugares registrando o mesmo débito com números diferentes seria a pior
 * coisa que este sistema poderia ganhar.
 */
/**
 * Prazo padrao de uma venda a prazo sem vencimento informado.
 *
 * Trinta dias e a convencao do varejo brasileiro. Fica aqui, com nome, em vez
 * de um `30` solto no meio do codigo da venda — e no dia em que virar
 * configuracao de empresa, e esta constante que sai.
 */
const PRAZO_PADRAO_DIAS = 30;

@Injectable()
export class ContasService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly carteira: CarteiraService,
    private readonly caixa: CaixaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private readonly inclusao = {
    fornecedor: { select: { nome: true } },
    cliente: { select: { nome: true } },
    loja: { select: { nome: true } },
    compra: { select: { numeroNota: true } },
    baixas: { orderBy: { criadoEm: 'asc' as const } },
  };

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  async listar(filtro: FiltroTitulos): Promise<PaginaTitulos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const hoje = this.hoje();

      /*
        `vencidos` é um recorte DERIVADO: não existe coluna "vencido". Um
        título vence sozinho com a passagem do tempo, e uma coluna gravada
        precisaria de uma rotina para virar — que, se não rodar, mostra "a
        vencer" um título de três semanas atrás.
      */
      const recorte =
        filtro.recorte === 'abertos'
          ? { status: 'ABERTO' as const }
          : filtro.recorte === 'vencidos'
            ? { status: 'ABERTO' as const, vencimento: { lt: hoje } }
            : filtro.recorte === 'pagos'
              ? { status: 'PAGO' as const }
              : {};

      const onde = {
        tipo: filtro.tipo,
        ...recorte,
        ...(filtro.termo
          ? {
              OR: [
                { descricao: { contains: filtro.termo, mode: 'insensitive' as const } },
                { fornecedor: { nome: { contains: filtro.termo, mode: 'insensitive' as const } } },
                { cliente: { nome: { contains: filtro.termo, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };

      const linhas = await tx.tituloFinanceiro.findMany({
        where: onde,
        // Pelo vencimento mais antigo: é a ordem em que se paga e se cobra.
        orderBy: [{ vencimento: 'asc' }, { id: 'asc' }],
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: this.inclusao,
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      const nomes = await this.nomesDosAtores(
        tx,
        pagina.flatMap((t) => t.baixas.map((b) => b.atorId)),
      );

      const [resumo, contagens] = await Promise.all([
        this.resumo(tx, filtro.tipo, hoje),
        this.contagens(tx, filtro.tipo, hoje),
      ]);

      return {
        itens: pagina.map((t) => this.paraContrato(t, hoje, nomes)),
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        resumo,
        contagens,
      };
    });
  }

  async detalhe(id: string): Promise<Titulo> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const titulo = await tx.tituloFinanceiro.findFirst({ where: { id }, include: this.inclusao });

      if (!titulo) {
        throw new NotFoundException({
          codigo: 'TITULO_NAO_ENCONTRADO',
          mensagem: 'Título não encontrado.',
        });
      }

      const nomes = await this.nomesDosAtores(
        tx,
        titulo.baixas.map((b) => b.atorId),
      );

      return this.paraContrato(titulo, this.hoje(), nomes);
    });
  }

  // -------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------

  /**
   * Cria o título — ou a série de parcelas.
   *
   * Cada parcela é um título próprio, com o vencimento adiantado de um mês.
   * É assim que o fornecedor cobra, e um título só com "3x" escondido no
   * texto não apareceria no fluxo de caixa de cada mês.
   */
  async criar(dados: NovoTitulo, principal: Principal): Promise<Titulo[]> {
    const contexto = exigirContexto();

    const valorTotal = dec(dados.valor);
    const porParcela = valorTotal.dividedBy(dados.parcelas).toDecimalPlaces(2);

    const ids = await comEscopoAtual(this.prisma, async (tx) => {
      const criados: string[] = [];

      for (let i = 0; i < dados.parcelas; i += 1) {
        /*
          A última parcela absorve a sobra da divisão. Sem isto, 100,00 em 3x
          soma 99,99 — e o fornecedor cobra o centavo que falta.
        */
        const valor =
          i === dados.parcelas - 1
            ? valorTotal.minus(porParcela.times(dados.parcelas - 1))
            : porParcela;

        const vencimento = new Date(`${dados.vencimento}T00:00:00Z`);
        vencimento.setUTCMonth(vencimento.getUTCMonth() + i);

        const criado = await tx.tituloFinanceiro.create({
          data: {
            tenantId: contexto.tenantId,
            tipo: dados.tipo,
            origem: dados.compraId ? 'COMPRA' : 'MANUAL',
            ...(dados.lojaId ? { lojaId: dados.lojaId } : {}),
            ...(dados.fornecedorId ? { fornecedorId: dados.fornecedorId } : {}),
            ...(dados.clienteId ? { clienteId: dados.clienteId } : {}),
            ...(dados.compraId ? { compraId: dados.compraId } : {}),
            descricao: dados.descricao,
            parcela: i + 1,
            parcelas: dados.parcelas,
            vencimento,
            valor: valor.toFixed(2),
            ...(dados.observacao ? { observacao: dados.observacao } : {}),
          },
          select: { id: true },
        });

        criados.push(criado.id);
      }

      return criados;
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'TITULO_CRIADO',
      entidade: 'titulo_financeiro',
      ...(ids[0] ? { entidadeId: ids[0] } : {}),
      atorNome: principal.nome,
      depois: { tipo: dados.tipo, valor: dados.valor, parcelas: dados.parcelas },
    });

    const titulos: Titulo[] = [];
    for (const id of ids) {
      titulos.push(await this.detalhe(id));
    }
    return titulos;
  }

  /**
   * Baixa: um lançamento, nunca uma edição.
   *
   * Em DINHEIRO, sai da gaveta — vira sangria no caixa aberto daquela loja, e
   * sem caixa a API recusa. Contar como pago um dinheiro que ninguém vai
   * conferir no fim do turno é o que transforma diferença em mistério.
   *
   * Em título A RECEBER, a quitação vai para a CARTEIRA: é lá que o saldo do
   * cliente vive, e é ela que manda no limite de crédito.
   */
  async baixar(id: string, dados: BaixaTitulo, principal: Principal): Promise<Titulo> {
    const contexto = exigirContexto();

    const titulo = await comEscopoAtual(this.prisma, async (tx) =>
      tx.tituloFinanceiro.findFirst({ where: { id } }),
    );

    if (!titulo) {
      throw new NotFoundException({
        codigo: 'TITULO_NAO_ENCONTRADO',
        mensagem: 'Título não encontrado.',
      });
    }

    if (titulo.status !== 'ABERTO') {
      throw new ConflictException({
        codigo: 'TITULO_NAO_ESTA_ABERTO',
        mensagem:
          titulo.status === 'PAGO' ? 'Este título já foi quitado.' : 'Este título foi cancelado.',
      });
    }

    const emAberto = dec(titulo.valor.toFixed(2)).minus(dec(titulo.valorPago.toFixed(2)));
    const valor = dec(dados.valor);

    if (valor.greaterThan(emAberto)) {
      throw new BadRequestException({
        codigo: 'BAIXA_ACIMA_DO_SALDO',
        mensagem: `Em aberto há R$ ${emAberto.toFixed(2)}. Baixar mais do que se deve é erro de digitação.`,
      });
    }

    /*
      O caixa e a carteira são serviços próprios, com as suas regras e a sua
      auditoria. Chamá-los é o que impede este módulo de virar um segundo
      lugar onde dinheiro se move.
    */
    let movimentoCaixaId: string | null = null;
    if (dados.forma === 'DINHEIRO') {
      if (!dados.lojaId) {
        throw new BadRequestException({
          codigo: 'LOJA_OBRIGATORIA_EM_DINHEIRO',
          mensagem: 'Pagamento em dinheiro sai da gaveta: diga de qual loja.',
        });
      }

      const caixaAberto = await this.caixa.meuCaixaAberto(dados.lojaId, principal);
      if (!caixaAberto) {
        throw new ConflictException({
          codigo: 'CAIXA_FECHADO',
          mensagem:
            'Sem caixa aberto, o dinheiro que sai da gaveta não aparece na conferência do turno.',
        });
      }

      const atualizado = await this.caixa.movimentar(
        caixaAberto.id,
        {
          tipo: titulo.tipo === 'PAGAR' ? 'SANGRIA' : 'SUPRIMENTO',
          valor: valor.toFixed(2),
          motivo: `Baixa de título: ${titulo.descricao}`.slice(0, 400),
        },
        principal,
      );

      movimentoCaixaId = atualizado.movimentos[atualizado.movimentos.length - 1]?.id ?? null;
    }

    /*
      O ponteiro para o lancamento da carteira fica por preencher: `lancar`
      devolve o extrato, nao o id do movimento. Declarar a coluna e nao ter o
      numero e melhor do que inventar um — e o `documento` do lancamento ja
      amarra os dois lados.
    */
    const carteiraMovimentoId: string | null = null;

    /*
      So quem TEM carteira leva a quitacao para o razao dela.

      Isto era `if (RECEBER && clienteId)`, e `lancar` lanca
      CARTEIRA_NAO_ENCONTRADA para quem nao tem: a baixa inteira morria com
      404. E o titulo de venda a prazo nasce EXATAMENTE para o cliente sem
      carteira (WALLET §6) — ou seja, o titulo era criado num caminho e nao
      podia ser pago em nenhum. Cobranca impossivel, sem erro de compilacao e
      sem teste que cobrisse.

      Cliente sem carteira quita no proprio titulo: nao ha segundo saldo para
      mover, que e o ponto do §6.
    */
    const carteiraDoCliente = titulo.clienteId
      ? await comEscopoAtual(this.prisma, async (tx) =>
          this.carteira.carteiraDoCliente(tx, titulo.clienteId!),
        )
      : null;

    if (titulo.tipo === 'RECEBER' && titulo.clienteId && carteiraDoCliente) {
      await this.carteira.lancar(
        titulo.clienteId,
        {
          tipo: 'QUITACAO',
          valor: valor.toFixed(2),
          // O documento amarra o lançamento da carteira ao título: quem olhar
          // o extrato do cliente vê de onde a quitação veio.
          documento: `TITULO ${titulo.id.slice(0, 8)}`,
          ...(dados.forma === 'CARTEIRA'
            ? {}
            : {
                formaPagamento: dados.forma as
                  'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'TRANSFERENCIA' | 'BOLETO',
              }),
        },
        principal,
      );
    }

    await comEscopoAtual(this.prisma, async (tx) => {
      await tx.baixaTitulo.create({
        data: {
          tenantId: contexto.tenantId,
          tituloId: id,
          valor: valor.toFixed(2),
          pagoEm: new Date(`${dados.pagoEm}T00:00:00Z`),
          forma: dados.forma,
          ...(movimentoCaixaId ? { movimentoCaixaId } : {}),
          ...(carteiraMovimentoId ? { carteiraMovimentoId } : {}),
          ...(dados.observacao ? { observacao: dados.observacao } : {}),
          atorId: principal.id,
        },
      });

      const pago = dec(titulo.valorPago.toFixed(2)).plus(valor);

      await tx.tituloFinanceiro.update({
        where: { id },
        data: {
          valorPago: pago.toFixed(2),
          // Quitado só quando não sobra nada. Marcar como pago o que foi pago
          // pela metade é perder a cobrança do resto.
          ...(pago.greaterThanOrEqualTo(dec(titulo.valor.toFixed(2)))
            ? { status: 'PAGO' as const }
            : {}),
        },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'TITULO_BAIXADO',
      entidade: 'titulo_financeiro',
      entidadeId: id,
      atorNome: principal.nome,
      depois: { valor: valor.toFixed(2), forma: dados.forma },
    });

    return this.detalhe(id);
  }

  async cancelar(id: string, dados: CancelamentoTitulo, principal: Principal): Promise<Titulo> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const titulo = await tx.tituloFinanceiro.findFirst({ where: { id } });

      if (!titulo) {
        throw new NotFoundException({
          codigo: 'TITULO_NAO_ENCONTRADO',
          mensagem: 'Título não encontrado.',
        });
      }

      if (titulo.status !== 'ABERTO') {
        throw new ConflictException({
          codigo: 'TITULO_NAO_ESTA_ABERTO',
          mensagem: 'Só um título em aberto se cancela.',
        });
      }

      // Cancelar um título já baixado em parte apagaria a cobrança do resto
      // sem dizer o que aconteceu com o que já foi pago.
      if (dec(titulo.valorPago.toFixed(2)).greaterThan(dec(0))) {
        throw new ConflictException({
          codigo: 'TITULO_COM_BAIXA',
          mensagem:
            'Este título já tem baixa. Estorne a baixa antes — cancelar apagaria a cobrança do resto.',
        });
      }

      await tx.tituloFinanceiro.update({
        where: { id },
        data: {
          status: 'CANCELADO',
          canceladoEm: new Date(),
          motivoCancelamento: dados.motivo,
        },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'TITULO_CANCELADO',
      entidade: 'titulo_financeiro',
      entidadeId: id,
      atorNome: principal.nome,
      motivo: dados.motivo,
    });

    return this.detalhe(id);
  }

  /**
   * O titulo de uma venda levada a prazo.
   *
   * Vive AQUI, e nao na venda, porque a regra de como um titulo nasce e desta
   * casa. Recebe o `tx` de quem chama: a venda e o titulo entram na mesma
   * transacao ou nao entram — mercadoria saindo sem a divida registrada e o
   * pior desfecho possivel.
   *
   * So para cliente SEM carteira. Quem tem carteira leva o debito no razao
   * dela; gerar os dois contaria a mesma divida duas vezes, que e o erro que
   * o docs/WALLET.md §6 existe para impedir.
   */
  async tituloDeVendaAPrazo(
    tx: ClienteEmTransacao,
    params: {
      readonly clienteId: string;
      readonly vendaId: string;
      readonly numeroVenda: number;
      readonly lojaId: string;
      readonly valor: string;
      readonly vencimento?: string | undefined;
    },
    contexto: { readonly tenantId: string },
  ): Promise<string> {
    const vencimento = params.vencimento
      ? new Date(`${params.vencimento}T00:00:00Z`)
      : this.daquiADias(PRAZO_PADRAO_DIAS);

    const titulo = await tx.tituloFinanceiro.create({
      data: {
        tenantId: contexto.tenantId,
        tipo: 'RECEBER',
        origem: 'VENDA',
        lojaId: params.lojaId,
        clienteId: params.clienteId,
        vendaId: params.vendaId,
        descricao: `Venda ${String(params.numeroVenda)} a prazo`,
        vencimento,
        valor: params.valor,
      },
      select: { id: true },
    });

    return titulo.id;
  }

  /**
   * Cancela os titulos que esta venda gerou.
   *
   * Recebe o `tx` de quem chama, como `tituloDeVendaAPrazo`: a venda cancelada
   * e o titulo cancelado sao o MESMO fato. Se um entrasse sem o outro, a loja
   * cobraria por mercadoria que voltou para a prateleira — e o cliente
   * receberia uma cobranca de uma venda que o proprio sistema diz nao existir.
   *
   * Titulo com baixa DERRUBA o cancelamento da venda inteira, em vez de apagar
   * a cobranca do resto em silencio. Dinheiro ja recebido tem de ter dono:
   * alguem precisa decidir se devolve ou se vira credito, e essa decisao nao e
   * desta funcao.
   */
  async cancelarTitulosDeVenda(
    tx: ClienteEmTransacao,
    params: {
      readonly vendaId: string;
      readonly numeroVenda: number;
      readonly motivo: string;
    },
  ): Promise<number> {
    /*
      Nao so o ABERTO. Um titulo ja PAGO tambem precisa entrar na conferencia:
      se ficasse de fora, cancelar a venda apagaria a venda e deixaria o
      dinheiro recebido sem nada a que se referir — e sem ninguem avisado.
    */
    const titulos = await tx.tituloFinanceiro.findMany({
      where: { vendaId: params.vendaId, status: { not: 'CANCELADO' } },
      select: { id: true, valorPago: true },
    });

    const comBaixa = titulos.filter((t) => dec(t.valorPago.toFixed(2)).greaterThan(dec(0)));

    if (comBaixa.length > 0) {
      throw new ConflictException({
        codigo: 'VENDA_COM_TITULO_BAIXADO',
        /*
          Nao manda "estorne a baixa": estorno de baixa nao existe como rota,
          e mandar alguem apertar um botao que nao ha e pior do que recusar
          sem explicar. A saida honesta hoje e resolver o dinheiro por fora —
          devolucao ou credito — e cancelar o titulo no proprio Contas.
        */
        mensagem: `A venda ${String(params.numeroVenda)} tem ${String(comBaixa.length)} título(s) com dinheiro recebido. Resolva o recebido primeiro — devolução ou crédito ao cliente —, senão a venda some e o dinheiro fica sem dono.`,
      });
    }

    for (const t of titulos) {
      await tx.tituloFinanceiro.update({
        where: { id: t.id },
        data: {
          status: 'CANCELADO',
          canceladoEm: new Date(),
          motivoCancelamento: params.motivo,
        },
      });
    }

    return titulos.length;
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  private daquiADias(dias: number): Date {
    const d = this.hoje();
    d.setUTCDate(d.getUTCDate() + dias);
    return d;
  }

  /** Meia-noite de hoje, em UTC. É contra ela que o vencimento se compara. */
  private hoje(): Date {
    const agora = new Date();
    return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0));
  }

  private async resumo(
    tx: ClienteEmTransacao,
    tipo: 'PAGAR' | 'RECEBER',
    hoje: Date,
  ): Promise<PaginaTitulos['resumo']> {
    const em7 = new Date(hoje);
    em7.setUTCDate(em7.getUTCDate() + 7);

    const amanha = new Date(hoje);
    amanha.setUTCDate(amanha.getUTCDate() + 1);

    const base = { tipo, status: 'ABERTO' as const };

    /*
      O indicador conta o CONJUNTO, nunca a página — e soma `valor − pago`,
      não `valor`: um título de 9.600 com 4.743 já pagos pesa 4.856 no que
      ainda falta pagar.
    */
    const [vencidos, hojeVence, proximos, abertos, maisAntigo] = await Promise.all([
      tx.tituloFinanceiro.aggregate({
        where: { ...base, vencimento: { lt: hoje } },
        _count: { _all: true },
        _sum: { valor: true, valorPago: true },
      }),
      tx.tituloFinanceiro.aggregate({
        where: { ...base, vencimento: { gte: hoje, lt: amanha } },
        _count: { _all: true },
        _sum: { valor: true, valorPago: true },
      }),
      tx.tituloFinanceiro.aggregate({
        where: { ...base, vencimento: { gte: amanha, lte: em7 } },
        _count: { _all: true },
        _sum: { valor: true, valorPago: true },
      }),
      tx.tituloFinanceiro.aggregate({
        where: base,
        _count: { _all: true },
        _sum: { valor: true, valorPago: true },
      }),
      tx.tituloFinanceiro.findFirst({
        where: { ...base, vencimento: { lt: hoje } },
        orderBy: { vencimento: 'asc' },
        select: { vencimento: true },
      }),
    ]);

    const liquido = (a: { _sum: { valor: unknown; valorPago: unknown } }): string =>
      dec((a._sum.valor as { toFixed: (n: number) => string } | null)?.toFixed(2) ?? '0')
        .minus(
          dec((a._sum.valorPago as { toFixed: (n: number) => string } | null)?.toFixed(2) ?? '0'),
        )
        .toFixed(2);

    return {
      vencido: liquido(vencidos),
      titulosVencidos: vencidos._count._all,
      atrasoMaisAntigo: maisAntigo ? this.diasEntre(maisAntigo.vencimento, hoje) : null,
      venceHoje: liquido(hojeVence),
      titulosHoje: hojeVence._count._all,
      proximos7: liquido(proximos),
      titulosProximos7: proximos._count._all,
      emAberto: liquido(abertos),
      titulosEmAberto: abertos._count._all,
    };
  }

  private async contagens(
    tx: ClienteEmTransacao,
    tipo: 'PAGAR' | 'RECEBER',
    hoje: Date,
  ): Promise<PaginaTitulos['contagens']> {
    const [aPagar, aReceber, abertos, vencidos, pagos, todos] = await Promise.all([
      tx.tituloFinanceiro.count({ where: { tipo: 'PAGAR', status: 'ABERTO' } }),
      tx.tituloFinanceiro.count({ where: { tipo: 'RECEBER', status: 'ABERTO' } }),
      tx.tituloFinanceiro.count({ where: { tipo, status: 'ABERTO' } }),
      tx.tituloFinanceiro.count({ where: { tipo, status: 'ABERTO', vencimento: { lt: hoje } } }),
      tx.tituloFinanceiro.count({ where: { tipo, status: 'PAGO' } }),
      tx.tituloFinanceiro.count({ where: { tipo } }),
    ]);

    return { aPagar, aReceber, abertos, vencidos, pagos, todos };
  }

  private diasEntre(de: Date, ate: Date): number {
    const a = Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate());
    const b = Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate());
    return Math.trunc((b - a) / 86_400_000);
  }

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
    t: {
      id: string;
      tipo: string;
      origem: string;
      status: string;
      descricao: string;
      parcela: number;
      parcelas: number;
      vencimento: Date;
      valor: { toFixed: (n: number) => string };
      valorPago: { toFixed: (n: number) => string };
      observacao: string | null;
      motivoCancelamento: string | null;
      fornecedor: { nome: string } | null;
      cliente: { nome: string } | null;
      loja: { nome: string } | null;
      compra: { numeroNota: string | null } | null;
      baixas: {
        id: string;
        valor: { toFixed: (n: number) => string };
        pagoEm: Date;
        forma: string;
        observacao: string | null;
        atorId: string | null;
        criadoEm: Date;
      }[];
    },
    hoje: Date,
    nomes: Map<string, string>,
  ): Titulo {
    const dias = this.diasEntre(t.vencimento, hoje);

    const situacao: SituacaoTitulo =
      t.status === 'PAGO'
        ? 'PAGO'
        : t.status === 'CANCELADO'
          ? 'CANCELADO'
          : dias > 0
            ? 'VENCIDO'
            : dias === 0
              ? 'VENCE_HOJE'
              : 'A_VENCER';

    return {
      id: t.id,
      tipo: t.tipo as Titulo['tipo'],
      origem: t.origem as Titulo['origem'],
      status: t.status as Titulo['status'],
      situacao,
      diasDeAtraso: dias,
      // Nem todo título tem contraparte cadastrada: despesa fixa é lançada à
      // mão. Dizer "lançado à mão" é melhor do que uma linha em branco.
      contraparte: t.fornecedor?.nome ?? t.cliente?.nome ?? 'lançado à mão',
      descricao: t.compra?.numeroNota ? `NF ${t.compra.numeroNota} · ${t.descricao}` : t.descricao,
      parcela: t.parcela,
      parcelas: t.parcelas,
      vencimento: t.vencimento.toISOString().slice(0, 10),
      valor: t.valor.toFixed(2),
      valorPago: t.valorPago.toFixed(2),
      emAberto: dec(t.valor.toFixed(2))
        .minus(dec(t.valorPago.toFixed(2)))
        .toFixed(2),
      loja: t.loja?.nome ?? null,
      observacao: t.observacao,
      motivoCancelamento: t.motivoCancelamento,
      baixas: t.baixas.map((b) => ({
        id: b.id,
        valor: b.valor.toFixed(2),
        pagoEm: b.pagoEm.toISOString().slice(0, 10),
        forma: b.forma,
        observacao: b.observacao,
        ator: b.atorId ? (nomes.get(b.atorId) ?? null) : null,
        criadoEm: b.criadoEm.toISOString(),
      })),
    };
  }
}
