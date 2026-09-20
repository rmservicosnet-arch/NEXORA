import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BloqueioCarteira,
  Carteira,
  EstornoCarteira,
  ExtratoCarteira,
  FiltroCarteiras,
  FiltroExtrato,
  LancamentoCarteira,
  LimiteCarteira,
  MovimentoCarteira,
  PaginaCarteiras,
  SentidoCarteira,
  TipoMovimentoCarteira,
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

/**
 * De que lado cada tipo cai.
 *
 * A mesma tabela existe como CHECK no banco. Duplicada de proposito: aqui ela
 * recusa cedo, com mensagem; la ela recusa sempre, inclusive para um script de
 * manutencao que nao passa pela aplicacao. Ver docs/WALLET.md §7.
 */
const SENTIDO_POR_TIPO: Readonly<Record<string, SentidoCarteira>> = {
  DEPOSITO: 'CREDITO',
  QUITACAO: 'CREDITO',
  DEVOLUCAO_VENDA: 'CREDITO',
  BONIFICACAO: 'CREDITO',
  ESTORNO_DEBITO: 'CREDITO',
  AJUSTE_CREDITO: 'CREDITO',
  PAGAMENTO_VENDA: 'DEBITO',
  VENDA_A_PRAZO: 'DEBITO',
  TAXA: 'DEBITO',
  ESTORNO_CREDITO: 'DEBITO',
  AJUSTE_DEBITO: 'DEBITO',
};

/** Tipos que criam dinheiro sem contrapartida. */
const EXIGEM_JUSTIFICATIVA = new Set(['AJUSTE_CREDITO', 'AJUSTE_DEBITO', 'BONIFICACAO']);

const PERMISSAO_POR_TIPO: Readonly<Record<string, string>> = {
  DEPOSITO: PERM.carteira.lancarDeposito,
  QUITACAO: PERM.carteira.lancarQuitacao,
  BONIFICACAO: PERM.carteira.ajustar,
  AJUSTE_CREDITO: PERM.carteira.ajustar,
  AJUSTE_DEBITO: PERM.carteira.ajustar,
  TAXA: PERM.carteira.ajustar,
};

export interface DebitoDeVenda {
  readonly movimentoId: string;
  readonly saldoPosterior: Dec;
  readonly excedeuLimite: boolean;
}

@Injectable()
export class CarteiraService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  async listar(filtro: FiltroCarteiras): Promise<PaginaCarteiras> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        status: 'ATIVO' as const,
        ...(filtro.busca
          ? { cliente: { nome: { contains: filtro.busca, mode: 'insensitive' as const } } }
          : {}),
        ...(filtro.apenasDevedores ? { saldo: { lt: 0 } } : {}),
      };

      const linhas = await tx.carteira.findMany({
        where: onde,
        orderBy: { saldo: 'asc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: { cliente: { select: { nome: true, tabelaPreco: { select: { nome: true } } } } },
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      // O que a loja tem a receber e a soma dos saldos NEGATIVOS, com o sinal
      // trocado. Somar tudo misturaria o dinheiro que a loja deve a quem tem
      // credito, e o total deixaria de significar qualquer coisa.
      const devedores = await tx.carteira.aggregate({
        where: { status: 'ATIVO', saldo: { lt: 0 } },
        _sum: { saldo: true },
      });

      return {
        itens: pagina.map((c) => this.paraContrato(c)),
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        totalAReceber: dec((devedores._sum.saldo ?? 0).toString())
          .negated()
          .toFixed(2),
      };
    });
  }

  async extrato(clienteId: string, filtro: FiltroExtrato): Promise<ExtratoCarteira> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const carteira = await tx.carteira.findFirst({
        where: { clienteId },
        include: { cliente: { select: { nome: true, tabelaPreco: { select: { nome: true } } } } },
      });

      if (!carteira) {
        throw new NotFoundException({
          codigo: 'CARTEIRA_NAO_ENCONTRADA',
          mensagem: 'Este cliente nao tem carteira.',
        });
      }

      const onde = {
        carteiraId: carteira.id,
        ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
        ...(filtro.sentido ? { sentido: filtro.sentido } : {}),
        ...(filtro.de || filtro.ate
          ? {
              criadoEm: {
                ...(filtro.de ? { gte: new Date(filtro.de) } : {}),
                ...(filtro.ate ? { lte: new Date(filtro.ate) } : {}),
              },
            }
          : {}),
      };

      const linhas = await tx.carteiraMovimento.findMany({
        where: onde,
        // Id descendente: `uuidv7` embute o tempo, e ordenar por `criado_em`
        // empataria movimentos do mesmo milissegundo — a paginacao repetiria
        // linhas no extrato de alguem.
        orderBy: { id: 'desc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: {
          venda: { select: { numero: true } },
          estornos: { select: { id: true }, take: 1 },
        },
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      const totais = await tx.carteiraMovimento.groupBy({
        by: ['sentido'],
        where: onde,
        _sum: { valor: true },
      });

      const soma = (s: string): string =>
        dec((totais.find((t) => t.sentido === s)?._sum.valor ?? 0).toString()).toFixed(2);

      return {
        carteira: this.paraContrato(carteira),
        movimentos: pagina.map((m) => this.movimentoParaContrato(m)),
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
        totalCreditos: soma('CREDITO'),
        totalDebitos: soma('DEBITO'),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Lancamento manual
  // -------------------------------------------------------------------------

  async lancar(
    clienteId: string,
    dados: LancamentoCarteira,
    principal: Principal,
  ): Promise<ExtratoCarteira> {
    const contexto = exigirContexto();

    const permissao = PERMISSAO_POR_TIPO[dados.tipo];
    if (permissao && !principal.permissoes.has(permissao)) {
      throw new ForbiddenException({
        codigo: 'SEM_PERMISSAO',
        mensagem: 'Voce nao tem permissao para este tipo de lancamento.',
      });
    }

    if (EXIGEM_JUSTIFICATIVA.has(dados.tipo) && (dados.justificativa?.trim().length ?? 0) < 5) {
      throw new ConflictException({
        codigo: 'JUSTIFICATIVA_OBRIGATORIA',
        mensagem: 'Ajuste e bonificacao criam dinheiro sem contrapartida. Descreva o motivo.',
      });
    }

    const sentido = SENTIDO_POR_TIPO[dados.tipo];
    if (!sentido) {
      throw new ConflictException({
        codigo: 'TIPO_DESCONHECIDO',
        mensagem: 'Tipo de lancamento desconhecido.',
      });
    }

    await comEscopoAtual(this.prisma, async (tx) => {
      const carteira = await this.travar(tx, clienteId);
      const valor = dec(dados.valor);

      // Debito manual respeita o limite, como qualquer outro.
      //
      // O retorno IMPORTA: ele diz se a operacao passou do limite com
      // autorizacao. Descarta-lo grava o movimento como se tivesse cabido no
      // limite — e "permitido quando autorizado, nunca silencioso" vira
      // silencioso. Ver docs/WALLET.md §4.
      const excedeu =
        sentido === 'DEBITO'
          ? await this.conferirLimite(carteira, valor, principal, dados.justificativa)
          : false;

      await this.gravarMovimento(tx, contexto, {
        carteiraId: carteira.id,
        saldoAtual: carteira.saldo,
        sentido,
        tipo: dados.tipo,
        valor,
        principal,
        excedeuLimite: excedeu,
        ...(dados.formaPagamento ? { formaPagamento: dados.formaPagamento } : {}),
        ...(dados.documento ? { documento: dados.documento } : {}),
        ...(dados.justificativa ? { justificativa: dados.justificativa } : {}),
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: `CARTEIRA_${dados.tipo}`,
      entidade: 'carteira',
      entidadeId: clienteId,
      atorNome: principal.nome,
      ...(dados.justificativa ? { motivo: dados.justificativa } : {}),
      depois: { tipo: dados.tipo, sentido, valor: dados.valor },
    });

    return this.extrato(clienteId, { limite: 50 });
  }

  // -------------------------------------------------------------------------
  // Estorno
  // -------------------------------------------------------------------------

  /**
   * Anula um movimento com o lancamento contrario.
   *
   * O original permanece. O extrato do cliente nao pode mudar de ontem para
   * hoje — o que muda e que passa a existir uma linha a mais explicando.
   */
  async estornar(
    clienteId: string,
    movimentoId: string,
    dados: EstornoCarteira,
    principal: Principal,
  ): Promise<ExtratoCarteira> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const carteira = await this.travar(tx, clienteId);

      const original = await tx.carteiraMovimento.findFirst({
        where: { id: movimentoId, carteiraId: carteira.id },
        include: { estornos: { select: { id: true }, take: 1 } },
      });

      if (!original) {
        throw new NotFoundException({
          codigo: 'MOVIMENTO_NAO_ENCONTRADO',
          mensagem: 'Movimento nao encontrado nesta carteira.',
        });
      }

      if (original.estornos.length > 0) {
        throw new ConflictException({
          codigo: 'MOVIMENTO_JA_ESTORNADO',
          mensagem: 'Este movimento ja foi estornado.',
        });
      }

      if (original.estornoDeId) {
        throw new ConflictException({
          codigo: 'ESTORNO_DE_ESTORNO',
          mensagem: 'Este movimento ja e um estorno. Para desfaze-lo, lance o valor de novo.',
        });
      }

      const contrario: TipoMovimentoCarteira =
        original.sentido === 'CREDITO' ? 'ESTORNO_CREDITO' : 'ESTORNO_DEBITO';

      await this.gravarMovimento(tx, contexto, {
        carteiraId: carteira.id,
        saldoAtual: carteira.saldo,
        sentido: original.sentido === 'CREDITO' ? 'DEBITO' : 'CREDITO',
        tipo: contrario,
        valor: dec(original.valor.toString()),
        principal,
        justificativa: dados.justificativa,
        estornoDeId: original.id,
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'CARTEIRA_ESTORNO',
      entidade: 'carteira_movimento',
      entidadeId: movimentoId,
      atorNome: principal.nome,
      motivo: dados.justificativa,
    });

    return this.extrato(clienteId, { limite: 50 });
  }

  // -------------------------------------------------------------------------
  // Limite e bloqueio
  // -------------------------------------------------------------------------

  async definirLimite(
    clienteId: string,
    dados: LimiteCarteira,
    principal: Principal,
  ): Promise<Carteira> {
    const contexto = exigirContexto();

    const antes = await comEscopoAtual(this.prisma, async (tx) => {
      const carteira = await this.travar(tx, clienteId);

      await tx.carteira.update({
        where: { id: carteira.id },
        data: { limiteCredito: dec(dados.limiteCredito).toFixed(2) },
      });

      return carteira.limiteCredito.toFixed(2);
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'CARTEIRA_LIMITE_DEFINIDO',
      entidade: 'carteira',
      entidadeId: clienteId,
      atorNome: principal.nome,
      ...(dados.justificativa ? { motivo: dados.justificativa } : {}),
      antes: { limiteCredito: antes },
      depois: { limiteCredito: dados.limiteCredito },
    });

    return (await this.extrato(clienteId, { limite: 1 })).carteira;
  }

  /**
   * Bloqueia novos debitos SEM bloquear quitacao.
   *
   * Um cliente inadimplente precisa continuar podendo pagar. Bloquear os dois
   * lados transformaria a cobranca num impasse.
   */
  async bloquear(
    clienteId: string,
    dados: BloqueioCarteira,
    principal: Principal,
  ): Promise<Carteira> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const carteira = await this.travar(tx, clienteId);

      await tx.carteira.update({
        where: { id: carteira.id },
        data: { bloqueadaParaCompra: dados.bloqueada },
      });
    });

    await this.auditoria.registrar({
      contexto,
      acao: dados.bloqueada ? 'CARTEIRA_BLOQUEADA' : 'CARTEIRA_DESBLOQUEADA',
      entidade: 'carteira',
      entidadeId: clienteId,
      atorNome: principal.nome,
      motivo: dados.justificativa,
    });

    return (await this.extrato(clienteId, { limite: 1 })).carteira;
  }

  // -------------------------------------------------------------------------
  // Usado pela venda, dentro da transacao DELA
  // -------------------------------------------------------------------------

  /**
   * Debita a carteira por uma venda paga com `FormaPagamento.CARTEIRA`.
   *
   * Recebe o `tx` de quem chamou: o debito e a venda estao na MESMA transacao.
   * Venda concluida com pagamento em carteira que nao debitou e dinheiro que
   * some — e foi exatamente o que aconteceu enquanto esta funcao nao existia:
   * o PDV aceitava a forma e nao lancava nada.
   */
  async debitarPorVenda(
    tx: ClienteEmTransacao,
    params: {
      readonly clienteId: string;
      readonly valor: Dec;
      readonly vendaId: string;
      /**
       * `PAGAMENTO_VENDA` e o cliente PAGANDO com o saldo que tem.
       * `VENDA_A_PRAZO` e ele LEVANDO e ficando devendo. O saldo se move do
       * mesmo jeito, mas o razao tem de dizer qual dos dois aconteceu — e o
       * extrato dele e o que a cobranca lê depois.
       */
      readonly tipo?: 'PAGAMENTO_VENDA' | 'VENDA_A_PRAZO';
    },
    principal: Principal,
  ): Promise<DebitoDeVenda> {
    const contexto = exigirContexto();
    const carteira = await this.travar(tx, params.clienteId);

    if (carteira.bloqueadaParaCompra) {
      throw new ConflictException({
        codigo: 'CARTEIRA_BLOQUEADA',
        mensagem: 'A carteira deste cliente esta bloqueada para compra.',
      });
    }

    const autorizacao = 'Venda no balcao, acima do limite';
    const excedeu = await this.conferirLimite(carteira, params.valor, principal, autorizacao);

    const movimento = await this.gravarMovimento(tx, contexto, {
      carteiraId: carteira.id,
      saldoAtual: carteira.saldo,
      sentido: 'DEBITO',
      tipo: params.tipo ?? 'PAGAMENTO_VENDA',
      valor: params.valor,
      principal,
      vendaId: params.vendaId,
      excedeuLimite: excedeu,
      /*
        A justificativa vai para o RAZAO, nao so para a conferencia.
        `conferirLimite` ja a exigia, e ela era descartada: o movimento ficava
        marcado como excedido e sem uma linha dizendo por que foi autorizado.
        Quem revisasse depois via a marca e nenhuma explicacao.
      */
      ...(excedeu ? { justificativa: autorizacao } : {}),
      /*
        A chave impede que um reenvio da mesma venda debite duas vezes — e
        carrega o TIPO porque uma venda pode ter as duas coisas: parte paga
        com o saldo e parte levada a prazo. Sem o tipo na chave, o segundo
        lancamento colidiria com o primeiro e sumiria em silencio.
      */
      chaveIdempotencia: `venda:${params.vendaId}:${params.tipo ?? 'PAGAMENTO_VENDA'}`,
    });

    return {
      movimentoId: movimento.id,
      saldoPosterior: carteira.saldo.minus(params.valor),
      excedeuLimite: excedeu,
    };
  }

  /**
   * Credita a carteira por uma DEVOLUCAO de venda.
   *
   * Segundo destino da cascata. Diferente de `estornarPorVendaCancelada`:
   * la a venda inteira deixa de existir e o estorno aponta para o movimento
   * original; aqui parte da mercadoria voltou, e o lancamento e um CREDITO
   * proprio, do tipo `DEVOLUCAO_VENDA` — que ja existia no enum e nunca
   * tinha sido gravado por ninguem.
   *
   * O teto e o que esta venda ainda deve na carteira: debitos dela, menos o
   * que devolucoes anteriores ja creditaram. Sem o teto, devolver dez vezes
   * um item de R$ 10,00 numa venda de R$ 100,00 creditaria R$ 100,00 alem do
   * que a venda levou.
   */
  async creditarPorDevolucao(
    tx: ClienteEmTransacao,
    params: {
      readonly clienteId: string;
      readonly vendaId: string;
      readonly valor: Dec;
      readonly motivo: string;
    },
    principal: Principal,
  ): Promise<Dec> {
    if (!params.valor.greaterThan(dec(0))) return dec(0);

    const movimentos = await tx.carteiraMovimento.findMany({
      where: { vendaId: params.vendaId },
      select: { sentido: true, tipo: true, valor: true },
    });

    let devido = dec(0);
    for (const m of movimentos) {
      const v = dec(m.valor.toString());
      if (m.sentido === 'DEBITO') devido = devido.plus(v);
      else devido = devido.minus(v);
    }

    if (!devido.greaterThan(dec(0))) return dec(0);

    const valor = params.valor.greaterThan(devido) ? devido : params.valor;

    const contexto = exigirContexto();
    const carteira = await this.travar(tx, params.clienteId);

    await this.gravarMovimento(tx, contexto, {
      carteiraId: carteira.id,
      saldoAtual: carteira.saldo,
      sentido: 'CREDITO',
      tipo: 'DEVOLUCAO_VENDA',
      valor,
      principal,
      vendaId: params.vendaId,
      justificativa: params.motivo,
    });

    return valor;
  }

  /**
   * Estorna os debitos que esta venda lancou na carteira.
   *
   * Dentro da transacao de QUEM CANCELA, pelo mesmo motivo do debito: venda
   * cancelada com o debito de pe e o cliente devendo por mercadoria que
   * voltou para a prateleira.
   *
   * Nao usa `estornar`, que abre transacao propria e recusa movimento ja
   * estornado. Aqui o ja estornado e simplesmente PULADO: cancelar duas vezes
   * nao pode creditar duas vezes, e a chave de idempotencia carrega o id do
   * movimento original para garantir isso no banco, nao so na leitura.
   *
   * Carteira bloqueada nao impede: bloqueio e para COMPRAR. Recusar a
   * devolucao do que ela mesma debitou prenderia a divida justamente em quem
   * ja esta bloqueado.
   */
  async estornarPorVendaCancelada(
    tx: ClienteEmTransacao,
    params: {
      readonly clienteId: string;
      readonly vendaId: string;
      readonly motivo: string;
    },
    principal: Principal,
  ): Promise<number> {
    const contexto = exigirContexto();

    const debitos = await tx.carteiraMovimento.findMany({
      where: {
        vendaId: params.vendaId,
        sentido: 'DEBITO',
        estornoDeId: null,
        estornos: { none: {} },
      },
      select: { id: true, valor: true, carteiraId: true },
      orderBy: { criadoEm: 'asc' },
    });

    if (debitos.length === 0) {
      return 0;
    }

    // Trava UMA vez e encadeia o saldo na memoria: `gravarMovimento` grava
    // `saldoAnterior` e `saldoPosterior` em cada linha, e reler o saldo entre
    // um estorno e outro traria o valor de antes — o razao deixaria de
    // encadear na segunda linha.
    const carteira = await this.travar(tx, params.clienteId);
    let saldo = carteira.saldo;

    for (const d of debitos) {
      const valor = dec(d.valor.toString());

      await this.gravarMovimento(tx, contexto, {
        carteiraId: carteira.id,
        saldoAtual: saldo,
        sentido: 'CREDITO',
        tipo: 'ESTORNO_DEBITO',
        valor,
        principal,
        vendaId: params.vendaId,
        justificativa: params.motivo,
        estornoDeId: d.id,
        chaveIdempotencia: `venda:${params.vendaId}:estorno:${d.id}`,
      });

      saldo = saldo.plus(valor);
    }

    return debitos.length;
  }

  /**
   * A quitacao que uma BAIXA de titulo lanca na carteira.
   *
   * Na transacao de quem chama, e devolvendo o id. O ponteiro
   * `baixa_titulo.carteira_movimento_id` existia desde o inicio e nunca era
   * preenchido, porque `lancar` devolve o extrato e nao o movimento — e sem
   * ele o estorno da baixa nao sabe qual linha do razao desfazer.
   *
   * A permissao continua sendo conferida aqui, como em `lancar`: quem da
   * baixa num titulo a receber esta lancando na carteira de alguem.
   */
  async quitarPorBaixa(
    tx: ClienteEmTransacao,
    params: {
      readonly clienteId: string;
      readonly valor: Dec;
      readonly documento: string;
      readonly formaPagamento?: string | undefined;
    },
    principal: Principal,
  ): Promise<string> {
    if (!principal.permissoes.has(PERM.carteira.lancarQuitacao)) {
      throw new ForbiddenException({
        codigo: 'SEM_PERMISSAO',
        mensagem: 'Voce nao tem permissao para lancar quitacao na carteira.',
      });
    }

    const contexto = exigirContexto();
    const carteira = await this.travar(tx, params.clienteId);

    const movimento = await this.gravarMovimento(tx, contexto, {
      carteiraId: carteira.id,
      saldoAtual: carteira.saldo,
      sentido: 'CREDITO',
      tipo: 'QUITACAO',
      valor: params.valor,
      principal,
      documento: params.documento,
      ...(params.formaPagamento ? { formaPagamento: params.formaPagamento } : {}),
    });

    return movimento.id;
  }

  /**
   * Estorna UM movimento, na transacao de quem chama.
   *
   * O irmao tx-aware de `estornar`. Existe porque o estorno de uma baixa de
   * titulo tem de entrar na mesma transacao que desfaz a baixa: o razao
   * creditado sem a baixa desfeita e dinheiro contado duas vezes.
   */
  async estornarMovimentoEm(
    tx: ClienteEmTransacao,
    params: {
      readonly clienteId: string;
      readonly movimentoId: string;
      readonly motivo: string;
    },
    principal: Principal,
  ): Promise<void> {
    const contexto = exigirContexto();

    const original = await tx.carteiraMovimento.findFirst({
      where: { id: params.movimentoId },
      include: { estornos: { select: { id: true }, take: 1 } },
    });

    if (!original) {
      throw new NotFoundException({
        codigo: 'MOVIMENTO_NAO_ENCONTRADO',
        mensagem: 'Movimento nao encontrado nesta carteira.',
      });
    }

    // Ja estornado e PULADO, nao e erro: quem chama esta desfazendo uma
    // operacao maior, e repetir a tentativa nao pode creditar duas vezes.
    if (original.estornos.length > 0) {
      return;
    }

    const carteira = await this.travar(tx, params.clienteId);

    await this.gravarMovimento(tx, contexto, {
      carteiraId: carteira.id,
      saldoAtual: carteira.saldo,
      sentido: original.sentido === 'CREDITO' ? 'DEBITO' : 'CREDITO',
      tipo: original.sentido === 'CREDITO' ? 'ESTORNO_CREDITO' : 'ESTORNO_DEBITO',
      valor: dec(original.valor.toString()),
      principal,
      justificativa: params.motivo,
      estornoDeId: original.id,
      chaveIdempotencia: `estorno:${original.id}`,
    });
  }

  /** A carteira do cliente, se ele tiver uma. Usado pelo PDV. */
  async carteiraDoCliente(tx: ClienteEmTransacao, clienteId: string): Promise<Carteira | null> {
    const carteira = await tx.carteira.findFirst({
      where: { clienteId, status: 'ATIVO' },
      include: { cliente: { select: { nome: true, tabelaPreco: { select: { nome: true } } } } },
    });

    return carteira ? this.paraContrato(carteira) : null;
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Trava a carteira e devolve o saldo confiavel.
   *
   * Sem `FOR UPDATE`, duas quitacoes simultaneas leem o mesmo saldo e uma
   * sobrescreve a outra: o cliente paga duas vezes e a divida cai uma. O
   * extrato ficaria com dois creditos que nao encadeiam — e `saldoAnterior`
   * de um seria diferente do `saldoPosterior` do anterior.
   */
  private async travar(
    tx: ClienteEmTransacao,
    clienteId: string,
  ): Promise<{ id: string; saldo: Dec; limiteCredito: Dec; bloqueadaParaCompra: boolean }> {
    const linhas = await tx.$queryRaw<
      { id: string; saldo: string; limite_credito: string; bloqueada_para_compra: boolean }[]
    >`
      SELECT id, saldo::text, limite_credito::text, bloqueada_para_compra
        FROM carteira
       WHERE cliente_id = ${clienteId}::uuid AND status = 'ATIVO'
       FOR UPDATE
    `;

    const linha = linhas[0];

    if (!linha) {
      throw new NotFoundException({
        codigo: 'CARTEIRA_NAO_ENCONTRADA',
        mensagem: 'Este cliente nao tem carteira ativa.',
      });
    }

    return {
      id: linha.id,
      saldo: dec(linha.saldo),
      limiteCredito: dec(linha.limite_credito),
      bloqueadaParaCompra: linha.bloqueada_para_compra,
    };
  }

  /**
   * Confere se o debito cabe em `saldo + limite`.
   *
   * Devolve `true` quando passou do limite COM autorizacao. Igual ao saldo
   * negativo de estoque: permitido quando autorizado, nunca silencioso.
   */
  private async conferirLimite(
    carteira: { saldo: Dec; limiteCredito: Dec },
    valor: Dec,
    principal: Principal,
    justificativa?: string | undefined,
  ): Promise<boolean> {
    const disponivel = carteira.saldo.plus(carteira.limiteCredito);

    if (valor.lessThanOrEqualTo(disponivel)) {
      return false;
    }

    if (!principal.permissoes.has(PERM.carteira.excederLimite)) {
      throw new ConflictException({
        codigo: 'LIMITE_EXCEDIDO',
        mensagem:
          `Disponivel: R$ ${disponivel.toFixed(2)} (saldo ${carteira.saldo.toFixed(2)} + limite ` +
          `${carteira.limiteCredito.toFixed(2)}). A operacao e de R$ ${valor.toFixed(2)}.`,
      });
    }

    if ((justificativa?.trim().length ?? 0) < 5) {
      throw new ConflictException({
        codigo: 'JUSTIFICATIVA_OBRIGATORIA_PARA_EXCEDER',
        mensagem: 'Passar do limite exige justificativa.',
      });
    }

    return true;
  }

  private async gravarMovimento(
    tx: ClienteEmTransacao,
    contexto: Contexto,
    p: {
      carteiraId: string;
      saldoAtual: Dec;
      sentido: SentidoCarteira;
      tipo: string;
      valor: Dec;
      principal: Principal;
      vendaId?: string;
      formaPagamento?: string;
      documento?: string;
      justificativa?: string;
      estornoDeId?: string;
      excedeuLimite?: boolean;
      chaveIdempotencia?: string;
    },
  ): Promise<{ id: string }> {
    const saldoPosterior =
      p.sentido === 'CREDITO' ? p.saldoAtual.plus(p.valor) : p.saldoAtual.minus(p.valor);

    const movimento = await tx.carteiraMovimento.create({
      data: {
        tenantId: contexto.tenantId,
        carteiraId: p.carteiraId,
        sentido: p.sentido,
        tipo: p.tipo as never,
        // Sempre positivo. O sinal esta em `sentido` — e o banco recusa o
        // contrario, por CHECK.
        valor: p.valor.toFixed(2),
        saldoAnterior: p.saldoAtual.toFixed(2),
        saldoPosterior: saldoPosterior.toFixed(2),
        excedeuLimite: p.excedeuLimite ?? false,
        ...(p.vendaId ? { vendaId: p.vendaId } : {}),
        ...(p.formaPagamento ? { formaPagamento: p.formaPagamento as never } : {}),
        ...(p.documento ? { documento: p.documento } : {}),
        ...(p.justificativa ? { justificativa: p.justificativa } : {}),
        ...(p.estornoDeId ? { estornoDeId: p.estornoDeId } : {}),
        ...(p.chaveIdempotencia ? { chaveIdempotencia: p.chaveIdempotencia } : {}),
        atorTipo: 'FUNCIONARIO',
        atorId: p.principal.id,
        atorNome: p.principal.nome,
      },
      select: { id: true },
    });

    // O saldo da carteira e cache do razao. Atualizado na mesma transacao, com
    // a linha travada — e isso que mantem os dois sempre iguais.
    await tx.carteira.update({
      where: { id: p.carteiraId },
      data: { saldo: saldoPosterior.toFixed(2) },
    });

    return movimento;
  }

  private paraContrato(c: {
    id: string;
    clienteId: string;
    saldo: { toString(): string };
    limiteCredito: { toString(): string };
    bloqueadaParaCompra: boolean;
    status: string;
    observacao: string | null;
    criadoEm: Date;
    cliente: { nome: string; tabelaPreco: { nome: string } | null };
  }): Carteira {
    const saldo = dec(c.saldo.toString());
    const limite = dec(c.limiteCredito.toString());

    return {
      id: c.id,
      clienteId: c.clienteId,
      cliente: c.cliente.nome,
      saldo: saldo.toFixed(2),
      limiteCredito: limite.toFixed(2),
      disponivel: saldo.plus(limite).toFixed(2),
      bloqueadaParaCompra: c.bloqueadaParaCompra,
      status: c.status as Carteira['status'],
      observacao: c.observacao,
      criadoEm: c.criadoEm.toISOString(),
      tabelaPreco: c.cliente.tabelaPreco?.nome ?? null,
    };
  }

  private movimentoParaContrato(m: {
    id: string;
    criadoEm: Date;
    sentido: string;
    tipo: string;
    valor: { toString(): string };
    saldoAnterior: { toString(): string };
    saldoPosterior: { toString(): string };
    excedeuLimite: boolean;
    vendaId: string | null;
    formaPagamento: string | null;
    documento: string | null;
    justificativa: string | null;
    atorNome: string | null;
    estornoDeId: string | null;
    venda: { numero: number } | null;
    estornos: { id: string }[];
  }): MovimentoCarteira {
    return {
      id: m.id,
      criadoEm: m.criadoEm.toISOString(),
      sentido: m.sentido as SentidoCarteira,
      tipo: m.tipo as TipoMovimentoCarteira,
      valor: dec(m.valor.toString()).toFixed(2),
      saldoAnterior: dec(m.saldoAnterior.toString()).toFixed(2),
      saldoPosterior: dec(m.saldoPosterior.toString()).toFixed(2),
      excedeuLimite: m.excedeuLimite,
      vendaId: m.vendaId,
      vendaNumero: m.venda?.numero ?? null,
      formaPagamento: m.formaPagamento,
      documento: m.documento,
      justificativa: m.justificativa,
      ator: m.atorNome,
      estornoDeId: m.estornoDeId,
      estornado: m.estornos.length > 0,
    };
  }
}
