import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BuscaVariacao,
  ContagemEstoque,
  EntradaEstoque,
  FiltroMovimentos,
  LocalResumo,
  Movimento,
  PaginaMovimentos,
  ResultadoMovimento,
  ResultadoTransferencia,
  SaidaEstoque,
  TransferenciaEstoque,
  VariacaoParaMovimento,
} from '@estoque/contracts';
import {
  aplicarEntrada,
  aplicarSaida,
  dec,
  posicao,
  type Dec,
  type ResultadoMovimento as ResultadoCalculo,
} from '@estoque/core';
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

interface Aviso {
  readonly codigo: string;
  readonly mensagem: string;
}

export interface LocalResolvido {
  readonly id: string;
  readonly nome: string;
  readonly lojaId: string;
  readonly loja: string;
}

export interface BaixaDeVenda {
  readonly movimento: Movimento;
  /** Custo médio no instante da saída. É o que congela no item da venda. */
  readonly custoUnitario: Dec;
  readonly avisos: Aviso[];
}

/** O que a gravação de um movimento precisa saber. */
interface Lancamento {
  readonly variacaoId: string;
  readonly local: LocalResolvido;
  readonly sentido: 'ENTRADA' | 'SAIDA';
  readonly tipo: string;
  readonly quantidade: Dec;
  readonly calculo: ResultadoCalculo;
  readonly justificativa?: string | undefined;
  readonly documentoTipo?: string | undefined;
  readonly documentoId?: string | undefined;
  readonly documentoNumero?: string | undefined;
  /** Movimento que este lançamento estorna. O original permanece. */
  readonly estornoDeId?: string | undefined;
}

@Injectable()
export class EstoqueService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  async entrada(dados: EntradaEstoque, principal: Principal): Promise<ResultadoMovimento> {
    const contexto = exigirContexto();

    const { lancamento, movimento } = await comEscopoAtual(this.prisma, async (tx) => {
      const local = await this.resolverLocal(tx, dados.localId, dados.lojaId, contexto);
      await this.exigirVariacao(tx, dados.variacaoId);

      const atual = await this.travarPosicao(tx, dados.variacaoId, local.id, contexto);

      const calculo = aplicarEntrada(atual, {
        quantidade: dados.quantidade,
        custoUnitario: dados.custoUnitario,
      });

      const lanc: Lancamento = {
        variacaoId: dados.variacaoId,
        local,
        sentido: 'ENTRADA',
        tipo: dados.tipo,
        quantidade: dec(dados.quantidade),
        calculo,
        justificativa: dados.justificativa,
        documentoTipo: 'ENTRADA_MANUAL',
        documentoNumero: dados.documentoNumero,
      };

      return { lancamento: lanc, movimento: await this.gravar(tx, lanc, principal, contexto) };
    });

    await this.auditar('ESTOQUE_ENTRADA', movimento, lancamento, principal, contexto);

    return {
      movimento,
      saldoPosterior: lancamento.calculo.saldoPosterior.toFixed(6),
      custoMedioDepois: lancamento.calculo.custoMedioDepois.toFixed(6),
      avisos: this.avisos(lancamento.calculo),
    };
  }

  // -------------------------------------------------------------------------
  // Saída
  // -------------------------------------------------------------------------

  async saida(dados: SaidaEstoque, principal: Principal): Promise<ResultadoMovimento> {
    const contexto = exigirContexto();

    const { lancamento, movimento } = await comEscopoAtual(this.prisma, async (tx) => {
      const local = await this.resolverLocal(tx, dados.localId, dados.lojaId, contexto);
      await this.exigirVariacao(tx, dados.variacaoId);

      const atual = await this.travarPosicao(tx, dados.variacaoId, local.id, contexto);
      const calculo = aplicarSaida(atual, { quantidade: dados.quantidade });

      await this.conferirSaldoNegativo(tx, calculo, principal);

      const lanc: Lancamento = {
        variacaoId: dados.variacaoId,
        local,
        sentido: 'SAIDA',
        tipo: dados.tipo,
        quantidade: dec(dados.quantidade),
        calculo,
        justificativa: dados.justificativa,
        documentoTipo: 'SAIDA_MANUAL',
        documentoNumero: dados.documentoNumero,
      };

      return { lancamento: lanc, movimento: await this.gravar(tx, lanc, principal, contexto) };
    });

    await this.auditar('ESTOQUE_SAIDA', movimento, lancamento, principal, contexto);

    return {
      movimento,
      saldoPosterior: lancamento.calculo.saldoPosterior.toFixed(6),
      custoMedioDepois: lancamento.calculo.custoMedioDepois.toFixed(6),
      avisos: this.avisos(lancamento.calculo),
    };
  }

  // -------------------------------------------------------------------------
  // Transferência
  // -------------------------------------------------------------------------

  /**
   * Move mercadoria entre locais, levando o custo junto.
   *
   * As duas pontas gravam na **mesma transação**. Meia transferência —
   * mercadoria que saiu e não chegou — é pior do que nenhuma: some do
   * patrimônio sem nada explicando.
   */
  async transferencia(
    dados: TransferenciaEstoque,
    principal: Principal,
  ): Promise<ResultadoTransferencia> {
    const contexto = exigirContexto();
    const documentoId = crypto.randomUUID();

    const resultado = await comEscopoAtual(this.prisma, async (tx) => {
      const origem = await this.resolverLocal(
        tx,
        dados.localOrigemId,
        dados.lojaOrigemId,
        contexto,
      );
      const destino = await this.resolverLocal(
        tx,
        dados.localDestinoId,
        dados.lojaDestinoId,
        contexto,
      );

      await this.exigirVariacao(tx, dados.variacaoId);

      // Trava sempre na mesma ordem de id. Duas transferências cruzadas entre
      // os mesmos dois locais travariam uma à outra e o banco mataria as duas
      // por deadlock.
      const [primeiro, segundo] =
        origem.id < destino.id ? [origem.id, destino.id] : [destino.id, origem.id];

      const posicoes = new Map<string, ReturnType<typeof posicao>>();
      posicoes.set(primeiro, await this.travarPosicao(tx, dados.variacaoId, primeiro, contexto));
      posicoes.set(segundo, await this.travarPosicao(tx, dados.variacaoId, segundo, contexto));

      const posOrigem = posicoes.get(origem.id);
      const posDestino = posicoes.get(destino.id);

      if (!posOrigem || !posDestino) {
        throw new Error('posição não travada');
      }

      const saidaCalc = aplicarSaida(posOrigem, { quantidade: dados.quantidade });
      await this.conferirSaldoNegativo(tx, saidaCalc, principal);

      const entradaCalc = aplicarEntrada(posDestino, {
        quantidade: dados.quantidade,
        // O custo atravessa. Transferir não cria nem destrói valor.
        custoUnitario: saidaCalc.custoUnitario,
      });

      const lancSaida: Lancamento = {
        variacaoId: dados.variacaoId,
        local: origem,
        sentido: 'SAIDA',
        tipo: 'SAIDA_TRANSFERENCIA',
        quantidade: dec(dados.quantidade),
        calculo: saidaCalc,
        justificativa:
          dados.justificativa ?? `Transferência para ${destino.loja} · ${destino.nome}`,
        documentoTipo: 'TRANSFERENCIA',
        documentoId,
      };

      const lancEntrada: Lancamento = {
        variacaoId: dados.variacaoId,
        local: destino,
        sentido: 'ENTRADA',
        tipo: 'ENTRADA_TRANSFERENCIA',
        quantidade: dec(dados.quantidade),
        calculo: entradaCalc,
        justificativa: dados.justificativa ?? `Transferência de ${origem.loja} · ${origem.nome}`,
        documentoTipo: 'TRANSFERENCIA',
        documentoId,
      };

      return {
        saida: await this.gravar(tx, lancSaida, principal, contexto),
        entrada: await this.gravar(tx, lancEntrada, principal, contexto),
        calculoSaida: saidaCalc,
        calculoEntrada: entradaCalc,
      };
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'ESTOQUE_TRANSFERENCIA',
      entidade: 'movimento_estoque',
      entidadeId: documentoId,
      atorNome: principal.nome,
      depois: {
        variacaoId: dados.variacaoId,
        quantidade: dados.quantidade,
        de: resultado.saida.local,
        para: resultado.entrada.local,
      },
    });

    return {
      saida: resultado.saida,
      entrada: resultado.entrada,
      avisos: this.avisos(resultado.calculoSaida),
    };
  }

  // -------------------------------------------------------------------------
  // Contagem (inventário)
  // -------------------------------------------------------------------------

  /**
   * Ajusta o saldo para o que foi contado na prateleira.
   *
   * A contagem informa o saldo FINAL, não a diferença. Pedir a diferença
   * obrigaria o operador a fazer a subtração de cabeça em frente à
   * prateleira — e é dessa subtração que sai o erro.
   *
   * Contagem igual ao saldo não gera movimento. Um razão cheio de movimentos
   * de quantidade zero esconde os que importam.
   */
  async contagem(dados: ContagemEstoque, principal: Principal): Promise<ResultadoMovimento | null> {
    const contexto = exigirContexto();

    const resultado = await comEscopoAtual(this.prisma, async (tx) => {
      const local = await this.resolverLocal(tx, dados.localId, dados.lojaId, contexto);
      await this.exigirVariacao(tx, dados.variacaoId);

      const atual = await this.travarPosicao(tx, dados.variacaoId, local.id, contexto);
      const contada = dec(dados.quantidadeContada);
      const diferenca = contada.minus(atual.saldo);

      if (diferenca.isZero()) {
        return null;
      }

      const sobra = diferenca.greaterThan(0);
      const quantidade = diferenca.abs();

      // Sobra reentra ao custo médio vigente: mercadoria que estava lá o tempo
      // todo não muda de valor por ter sido encontrada. Com saldo zerado e sem
      // custo conhecido, entra a zero — e o aviso de "sem base de custo"
      // avisa quem precisa corrigir.
      const calculo = sobra
        ? aplicarEntrada(atual, { quantidade, custoUnitario: atual.custoMedio })
        : aplicarSaida(atual, { quantidade });

      const lanc: Lancamento = {
        variacaoId: dados.variacaoId,
        local,
        sentido: sobra ? 'ENTRADA' : 'SAIDA',
        tipo: sobra ? 'ENTRADA_INVENTARIO' : 'SAIDA_INVENTARIO',
        quantidade,
        calculo,
        justificativa:
          dados.justificativa ??
          `Contagem: sistema ${atual.saldo.toFixed(0)}, contado ${contada.toFixed(0)}`,
        documentoTipo: 'CONTAGEM',
      };

      return { lancamento: lanc, movimento: await this.gravar(tx, lanc, principal, contexto) };
    });

    if (!resultado) {
      return null;
    }

    await this.auditar(
      'ESTOQUE_CONTAGEM',
      resultado.movimento,
      resultado.lancamento,
      principal,
      contexto,
    );

    return {
      movimento: resultado.movimento,
      saldoPosterior: resultado.lancamento.calculo.saldoPosterior.toFixed(6),
      custoMedioDepois: resultado.lancamento.calculo.custoMedioDepois.toFixed(6),
      avisos: this.avisos(resultado.lancamento.calculo),
    };
  }

  // -------------------------------------------------------------------------
  // Usado por outros módulos, dentro da transação DELES
  // -------------------------------------------------------------------------

  /**
   * Baixa o estoque de um item vendido.
   *
   * Recebe o `tx` de quem chamou de propósito: a baixa e a venda precisam
   * estar na **mesma transação**. Venda gravada com estoque não baixado — ou o
   * contrário — é divergência que ninguém encontra depois.
   *
   * É o mesmo caminho da saída manual: mesmo travamento, mesmo cálculo, mesma
   * regra de saldo negativo. Uma segunda implementação "só para a venda" seria
   * uma segunda verdade sobre o custo.
   */
  async baixarParaVenda(
    tx: ClienteEmTransacao,
    params: {
      readonly variacaoId: string;
      readonly local: LocalResolvido;
      readonly quantidade: string;
      readonly vendaId: string;
      readonly numeroVenda: string;
    },
    principal: Principal,
  ): Promise<BaixaDeVenda> {
    const contexto = exigirContexto();

    const atual = await this.travarPosicao(tx, params.variacaoId, params.local.id, contexto);
    const calculo = aplicarSaida(atual, { quantidade: params.quantidade });

    await this.conferirSaldoNegativo(tx, calculo, principal);

    const movimento = await this.gravar(
      tx,
      {
        variacaoId: params.variacaoId,
        local: params.local,
        sentido: 'SAIDA',
        tipo: 'SAIDA_VENDA',
        quantidade: dec(params.quantidade),
        calculo,
        documentoTipo: 'VENDA',
        documentoId: params.vendaId,
        documentoNumero: params.numeroVenda,
      },
      principal,
      contexto,
    );

    return { movimento, custoUnitario: calculo.custoUnitario, avisos: this.avisos(calculo) };
  }

  /**
   * Devolve ao estoque o que uma venda cancelada havia tirado.
   *
   * **Lançamento contrário, não exclusão.** O movimento original permanece e o
   * novo aponta para ele por `estorno_de_id`. Apagar a saída faria o razão
   * mentir sobre o que aconteceu no balcão.
   *
   * A reentrada é pelo custo congelado na saída — a mercadoria volta valendo o
   * que valia quando saiu. Se outras entradas ocorreram no meio, a média é
   * recalculada normalmente, e a política gravada diz qual regra foi aplicada.
   */
  async estornarSaidaDeVenda(
    tx: ClienteEmTransacao,
    params: {
      readonly movimentoOriginalId: string;
      readonly variacaoId: string;
      readonly local: LocalResolvido;
      readonly quantidade: string;
      readonly custoUnitario: string;
      readonly vendaId: string;
      readonly numeroVenda: string;
      readonly motivo: string;
    },
    principal: Principal,
  ): Promise<Movimento> {
    const contexto = exigirContexto();

    const atual = await this.travarPosicao(tx, params.variacaoId, params.local.id, contexto);

    const calculo = aplicarEntrada(atual, {
      quantidade: params.quantidade,
      custoUnitario: params.custoUnitario,
    });

    return this.gravar(
      tx,
      {
        variacaoId: params.variacaoId,
        local: params.local,
        sentido: 'ENTRADA',
        tipo: 'ENTRADA_DEVOLUCAO_CLIENTE',
        quantidade: dec(params.quantidade),
        calculo,
        justificativa: params.motivo,
        documentoTipo: 'VENDA_CANCELADA',
        documentoId: params.vendaId,
        documentoNumero: params.numeroVenda,
        estornoDeId: params.movimentoOriginalId,
      },
      principal,
      contexto,
    );
  }

  /** Resolve e confere o local. Público porque a venda precisa do mesmo. */
  async resolverLocalDaLoja(
    tx: ClienteEmTransacao,
    localId: string,
    lojaId: string,
  ): Promise<LocalResolvido> {
    return this.resolverLocal(tx, localId, lojaId, exigirContexto());
  }

  /** O local padrão de venda da loja. É onde o PDV baixa por omissão. */
  async localPadraoDaLoja(tx: ClienteEmTransacao, lojaId: string): Promise<LocalResolvido> {
    const local = await tx.localEstoque.findFirst({
      where: { lojaId, padraoVenda: true, status: 'ATIVO' },
      include: { loja: { select: { id: true, nome: true } } },
    });

    if (!local) {
      throw new ConflictException({
        codigo: 'LOJA_SEM_LOCAL_PADRAO',
        mensagem: 'Esta loja não tem local padrão de venda. Defina um antes de operar o PDV.',
      });
    }

    return this.resolverLocal(tx, local.id, lojaId, exigirContexto());
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  async movimentos(filtro: FiltroMovimentos, podeVerCusto: boolean): Promise<PaginaMovimentos> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const onde = {
        ...(filtro.variacaoId ? { variacaoId: filtro.variacaoId } : {}),
        ...(filtro.produtoId ? { variacao: { produtoId: filtro.produtoId } } : {}),
        ...(filtro.localId ? { localId: filtro.localId } : {}),
        ...(filtro.lojaId ? { local: { lojaId: filtro.lojaId } } : {}),
        ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
        ...(filtro.sentido ? { sentido: filtro.sentido } : {}),
        ...(filtro.apenasNegativos ? { saldoNegativo: true } : {}),
        ...(filtro.de || filtro.ate
          ? {
              criadoEm: {
                ...(filtro.de ? { gte: new Date(filtro.de) } : {}),
                ...(filtro.ate ? { lte: new Date(filtro.ate) } : {}),
              },
            }
          : {}),
      };

      const linhas = await tx.movimentoEstoque.findMany({
        where: onde,
        // Id descendente é ordem cronológica reversa de graça: uuidv7 embute o
        // tempo. Ordenar por `criado_em` empataria movimentos do mesmo
        // milissegundo e a paginação repetiria linhas.
        orderBy: { id: 'desc' },
        take: filtro.limite + 1,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: {
          variacao: { select: { sku: true, descricao: true, produto: { select: { nome: true } } } },
          local: { select: { nome: true, loja: { select: { nome: true } } } },
        },
      });

      const temMais = linhas.length > filtro.limite;
      const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

      return {
        itens: pagina.map((m) => this.paraContrato(m, podeVerCusto)),
        proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
      };
    });
  }

  /**
   * Busca variações para movimentar.
   *
   * O código de barras tem precedência: a tela é usada com leitor na mão, e um
   * código lido precisa cair direto no item, não numa lista para escolher.
   */
  async buscarVariacoes(
    busca: BuscaVariacao,
    podeVerCusto: boolean,
  ): Promise<VariacaoParaMovimento[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const termo = busca.termo;

      const linhas = await tx.variacao.findMany({
        where: {
          OR: [
            { codigoBarras: termo },
            { sku: { contains: termo, mode: 'insensitive' } },
            { descricao: { contains: termo, mode: 'insensitive' } },
            { produto: { nome: { contains: termo, mode: 'insensitive' } } },
            { produto: { skuBase: { contains: termo, mode: 'insensitive' } } },
          ],
        },
        orderBy: { sku: 'asc' },
        take: busca.limite,
        include: {
          produto: {
            select: {
              id: true,
              nome: true,
              imagens: {
                where: { excluidoEm: null, status: 'PRONTA', principal: true },
                select: { id: true },
                take: 1,
              },
            },
          },
          saldos: {
            include: {
              local: {
                select: { id: true, nome: true, loja: { select: { id: true, nome: true } } },
              },
            },
          },
        },
      });

      const itens = linhas.map((v) => {
        let saldoTotal = dec(0);

        const saldosPorLocal = v.saldos.map((s) => {
          const quantidade = dec(s.quantidade.toString());
          saldoTotal = saldoTotal.plus(quantidade);

          return {
            localId: s.local.id,
            local: s.local.nome,
            lojaId: s.local.loja.id,
            loja: s.local.loja.nome,
            quantidade: quantidade.toFixed(0),
            ...(podeVerCusto ? { custoMedio: dec(s.custoMedio.toString()).toFixed(6) } : {}),
          };
        });

        return {
          id: v.id,
          sku: v.sku,
          codigoBarras: v.codigoBarras,
          descricao: v.descricao,
          produtoId: v.produto.id,
          produto: v.produto.nome,
          imagemPrincipalId: v.produto.imagens[0]?.id ?? null,
          saldoTotal: saldoTotal.toFixed(0),
          saldosPorLocal,
          casouCodigoBarras: v.codigoBarras === termo,
        };
      });

      // Casou o código de barras vem primeiro, sempre.
      return itens.sort((a, b) => Number(b.casouCodigoBarras) - Number(a.casouCodigoBarras));
    });
  }

  async locais(): Promise<LocalResumo[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      const contexto = exigirContexto();

      const linhas = await tx.localEstoque.findMany({
        where: {
          status: 'ATIVO',
          // Só os locais das lojas às quais a pessoa tem vínculo. Listar os
          // outros ofereceria um destino de transferência que a API recusaria.
          lojaId: { in: [...(contexto.lojaIds ?? [])] },
        },
        orderBy: [{ loja: { nome: 'asc' } }, { nome: 'asc' }],
        include: { loja: { select: { id: true, nome: true } } },
      });

      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        codigo: l.codigo,
        lojaId: l.loja.id,
        loja: l.loja.nome,
        padraoVenda: l.padraoVenda,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Trava a linha de saldo e devolve a posição atual.
   *
   * Sem `FOR UPDATE`, duas saídas simultâneas leem o mesmo saldo, calculam a
   * partir dele e gravam — e uma das duas some. O razão continuaria com dois
   * movimentos, mas `saldo_anterior` e `saldo_posterior` deixariam de encadear:
   * o histórico passaria a mentir.
   *
   * O `INSERT ... ON CONFLICT DO NOTHING` antes existe porque não dá para
   * travar linha que ainda não existe — e a primeira entrada de um item é
   * exatamente esse caso.
   */
  private async travarPosicao(
    tx: ClienteEmTransacao,
    variacaoId: string,
    localId: string,
    contexto: Contexto,
  ): Promise<ReturnType<typeof posicao>> {
    await tx.$executeRaw`
      INSERT INTO saldo_estoque (id, tenant_id, variacao_id, local_id, quantidade, custo_medio, alterado_em)
      VALUES (uuidv7(), ${contexto.tenantId}::uuid, ${variacaoId}::uuid, ${localId}::uuid, 0, 0, now())
      ON CONFLICT (variacao_id, local_id) DO NOTHING
    `;

    const linhas = await tx.$queryRaw<{ quantidade: string; custo_medio: string }[]>`
      SELECT quantidade::text, custo_medio::text
        FROM saldo_estoque
       WHERE variacao_id = ${variacaoId}::uuid AND local_id = ${localId}::uuid
       FOR UPDATE
    `;

    const linha = linhas[0];

    if (!linha) {
      // Só acontece se o RLS barrar a linha — ou seja, outra empresa.
      throw new NotFoundException({
        codigo: 'SALDO_NAO_ENCONTRADO',
        mensagem: 'Não foi possível abrir a posição de estoque.',
      });
    }

    return posicao(linha.quantidade, linha.custo_medio);
  }

  private async gravar(
    tx: ClienteEmTransacao,
    lanc: Lancamento,
    principal: Principal,
    contexto: Contexto,
  ): Promise<Movimento> {
    const { calculo } = lanc;

    await tx.saldoEstoque.update({
      where: { variacaoId_localId: { variacaoId: lanc.variacaoId, localId: lanc.local.id } },
      data: {
        quantidade: calculo.saldoPosterior.toFixed(6),
        custoMedio: calculo.custoMedioDepois.toFixed(6),
      },
    });

    const movimento = await tx.movimentoEstoque.create({
      data: {
        tenantId: contexto.tenantId,
        variacaoId: lanc.variacaoId,
        localId: lanc.local.id,
        sentido: lanc.sentido,
        tipo: lanc.tipo as never,
        quantidade: lanc.quantidade.toFixed(6),
        saldoAnterior: calculo.saldoAnterior.toFixed(6),
        saldoPosterior: calculo.saldoPosterior.toFixed(6),
        custoUnitario: calculo.custoUnitario.toFixed(6),
        custoMedioAntes: calculo.custoMedioAntes.toFixed(6),
        custoMedioDepois: calculo.custoMedioDepois.toFixed(6),
        politicaCusto: calculo.politica,
        saldoNegativo: calculo.saldoNegativo,
        ...(lanc.documentoTipo ? { documentoTipo: lanc.documentoTipo } : {}),
        ...(lanc.documentoId ? { documentoId: lanc.documentoId } : {}),
        ...(lanc.documentoNumero ? { documentoNumero: lanc.documentoNumero } : {}),
        ...(lanc.estornoDeId ? { estornoDeId: lanc.estornoDeId } : {}),
        ...(lanc.justificativa ? { justificativa: lanc.justificativa } : {}),
        atorTipo: 'FUNCIONARIO',
        atorId: principal.id,
      },
      include: {
        variacao: { select: { sku: true, descricao: true, produto: { select: { nome: true } } } },
        local: { select: { nome: true, loja: { select: { nome: true } } } },
      },
    });

    // Quem grava o movimento vê o custo: é ele que acabou de informá-lo.
    return this.paraContrato(movimento, true);
  }

  private async resolverLocal(
    tx: ClienteEmTransacao,
    localId: string,
    lojaIdInformada: string,
    contexto: Contexto,
  ): Promise<LocalResolvido> {
    const local = await tx.localEstoque.findFirst({
      where: { id: localId },
      include: { loja: { select: { id: true, nome: true } } },
    });

    if (!local) {
      throw new NotFoundException({
        codigo: 'LOCAL_NAO_ENCONTRADO',
        mensagem: 'Local de estoque não encontrado.',
      });
    }

    // A loja de verdade é a do local, não a que veio no corpo. O guard de
    // escopo confere o campo do corpo; se os dois divergirem, alguém está
    // usando uma loja a que tem acesso para alcançar o local de outra.
    if (local.loja.id !== lojaIdInformada) {
      throw new BadRequestException({
        codigo: 'LOCAL_DE_OUTRA_LOJA',
        mensagem: 'O local informado não pertence a essa loja.',
      });
    }

    // Ausente é tratado como vazio, ou seja, nega. O contrário — tratar a
    // ausência como "pode tudo" — transformaria um contexto mal montado em
    // acesso irrestrito ao estoque de todas as lojas.
    if (!(contexto.lojaIds ?? []).includes(local.loja.id)) {
      throw new ForbiddenException({
        codigo: 'SEM_ACESSO_A_LOJA',
        mensagem: 'Você não tem vínculo com esta loja.',
      });
    }

    if (local.status !== 'ATIVO') {
      throw new ConflictException({
        codigo: 'LOCAL_INATIVO',
        mensagem: 'Este local de estoque está inativo.',
      });
    }

    return { id: local.id, nome: local.nome, lojaId: local.loja.id, loja: local.loja.nome };
  }

  private async exigirVariacao(tx: ClienteEmTransacao, variacaoId: string): Promise<void> {
    const variacao = await tx.variacao.findFirst({
      where: { id: variacaoId },
      select: { id: true, status: true },
    });

    if (!variacao) {
      throw new NotFoundException({
        codigo: 'VARIACAO_NAO_ENCONTRADA',
        mensagem: 'Variação não encontrada.',
      });
    }

    // Variação inativa ainda movimenta: é preciso poder zerar o estoque de um
    // item que saiu de linha. Impedir aqui deixaria saldo preso para sempre.
  }

  /**
   * Recusa a saída se a empresa não permitir saldo negativo.
   *
   * O padrão da plataforma é permitir — e nunca silenciosamente. Quem desliga
   * troca a venda a descoberto por um bloqueio no balcão, e essa é uma decisão
   * da loja, não do sistema.
   */
  private async conferirSaldoNegativo(
    tx: ClienteEmTransacao,
    calculo: ResultadoCalculo,
    principal: Principal,
  ): Promise<void> {
    if (!calculo.saldoNegativo) {
      return;
    }

    const contexto = exigirContexto();

    const config = await tx.tenantConfiguracao.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { permitirSaldoNegativo: true },
    });

    if (config?.permitirSaldoNegativo === false) {
      throw new ConflictException({
        codigo: 'SALDO_INSUFICIENTE',
        mensagem: `Saldo insuficiente: há ${calculo.saldoAnterior.toFixed(0)} e a operação deixaria ${calculo.saldoPosterior.toFixed(0)}.`,
      });
    }

    // Permitido, mas não para qualquer um.
    if (!principal.permissoes.has('estoque.vender_sem_saldo')) {
      throw new ConflictException({
        codigo: 'SEM_PERMISSAO_SALDO_NEGATIVO',
        mensagem: `A operação deixaria o saldo em ${calculo.saldoPosterior.toFixed(0)}. Você não tem permissão para deixar o saldo negativo.`,
      });
    }
  }

  private avisos(calculo: ResultadoCalculo): Aviso[] {
    const lista: Aviso[] = [];

    if (calculo.saldoNegativo) {
      lista.push({
        codigo: 'SALDO_NEGATIVO',
        mensagem: `O saldo ficou em ${calculo.saldoPosterior.toFixed(0)}. A divergência está registrada no razão.`,
      });
    }

    if (calculo.semBaseDeCusto && calculo.politica === 'SEM_EFEITO') {
      lista.push({
        codigo: 'SEM_BASE_DE_CUSTO',
        mensagem:
          'Esta saída não tem custo conhecido. A margem calculada sobre ela será falsa até a entrada correspondente ser lançada.',
      });
    }

    if (calculo.unidadesRegularizadas.greaterThan(0)) {
      lista.push({
        codigo: 'REGULARIZACAO',
        mensagem: `${calculo.unidadesRegularizadas.toFixed(0)} unidade(s) que haviam saído a descoberto foram cobertas por esta entrada.`,
      });
    }

    return lista;
  }

  private async auditar(
    acao: string,
    movimento: Movimento,
    lanc: Lancamento,
    principal: Principal,
    contexto: Contexto,
  ): Promise<void> {
    await this.auditoria.registrar({
      contexto,
      acao,
      entidade: 'movimento_estoque',
      entidadeId: movimento.id,
      atorNome: principal.nome,
      ...(lanc.justificativa ? { motivo: lanc.justificativa } : {}),
      depois: {
        sku: movimento.sku,
        local: `${lanc.local.loja} · ${lanc.local.nome}`,
        tipo: lanc.tipo,
        quantidade: lanc.quantidade.toFixed(6),
        saldoAnterior: lanc.calculo.saldoAnterior.toFixed(6),
        saldoPosterior: lanc.calculo.saldoPosterior.toFixed(6),
        politica: lanc.calculo.politica,
      },
    });
  }

  private paraContrato(
    m: {
      id: string;
      criadoEm: Date;
      sentido: string;
      tipo: string;
      variacaoId: string;
      localId: string;
      quantidade: unknown;
      saldoAnterior: unknown;
      saldoPosterior: unknown;
      custoUnitario: unknown;
      custoMedioAntes: unknown;
      custoMedioDepois: unknown;
      politicaCusto: string;
      saldoNegativo: boolean;
      justificativa: string | null;
      documentoNumero: string | null;
      atorId: string | null;
      variacao: { sku: string; descricao: string; produto: { nome: string } };
      local: { nome: string; loja: { nome: string } };
    },
    podeVerCusto: boolean,
  ): Movimento {
    const base: Movimento = {
      id: m.id,
      criadoEm: m.criadoEm.toISOString(),
      sentido: m.sentido as Movimento['sentido'],
      tipo: m.tipo as Movimento['tipo'],
      variacaoId: m.variacaoId,
      sku: m.variacao.sku,
      produto: m.variacao.produto.nome,
      descricaoVariacao: m.variacao.descricao,
      localId: m.localId,
      local: m.local.nome,
      loja: m.local.loja.nome,
      quantidade: dec(String(m.quantidade)).toFixed(6),
      saldoAnterior: dec(String(m.saldoAnterior)).toFixed(6),
      saldoPosterior: dec(String(m.saldoPosterior)).toFixed(6),
      saldoNegativo: m.saldoNegativo,
      justificativa: m.justificativa,
      documentoNumero: m.documentoNumero,
      ator: m.atorId,
    };

    if (!podeVerCusto) {
      return base;
    }

    return {
      ...base,
      custoUnitario: dec(String(m.custoUnitario)).toFixed(6),
      custoMedioAntes: dec(String(m.custoMedioAntes)).toFixed(6),
      custoMedioDepois: dec(String(m.custoMedioDepois)).toFixed(6),
      politicaCusto: m.politicaCusto as Movimento['politicaCusto'],
    };
  }
}
