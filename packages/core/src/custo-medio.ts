/**
 * Custo médio ponderado.
 *
 * Contrato completo em docs/COST_POLICY.md. Este arquivo é a implementação
 * literal dele — se divergirem, um dos dois está errado e precisa ser
 * corrigido no mesmo commit.
 *
 * Tudo aqui é função pura: mesma entrada, mesma saída, sempre. Sem I/O, sem
 * relógio, sem aleatoriedade. É o que permite testar exaustivamente a regra
 * mais delicada do sistema sem banco de dados.
 */

import {
  arredondarCusto,
  arredondarQuantidade,
  arredondarValor,
  dec,
  ehNegativo,
  menor,
  ZERO,
  type Dec,
  type ValorEntrada,
} from './dinheiro';
import { CustoInvalidoError, QuantidadeInvalidaError } from './erros';

/** Ver docs/COST_POLICY.md §2. Cada valor tem exatamente um significado. */
export type PoliticaCusto =
  /** Entrada com saldo anterior > 0. Média recalculada. */
  | 'MEDIA_PONDERADA'
  /** Entrada com saldo anterior ≤ 0. Média assume o custo da entrada. */
  | 'CUSTO_REDEFINIDO'
  /** Saída ao custo médio vigente. Média inalterada. */
  | 'SEM_EFEITO'
  /** Saída a um custo específico gravado (estorno de entrada). Média inalterada. */
  | 'CUSTO_HISTORICO';

/** Posição de um par (variação × local). */
export interface Posicao {
  readonly saldo: Dec;
  readonly custoMedio: Dec;
}

export interface ResultadoMovimento {
  readonly saldoAnterior: Dec;
  readonly saldoPosterior: Dec;
  readonly custoMedioAntes: Dec;
  readonly custoMedioDepois: Dec;
  /** Custo de uma unidade neste movimento. É dele que sai a margem da venda. */
  readonly custoUnitario: Dec;
  readonly politica: PoliticaCusto;
  /** O saldo terminou abaixo de zero. */
  readonly saldoNegativo: boolean;
  /** Saída de item que nunca teve entrada: margem aparente de 100% é falsa. */
  readonly semBaseDeCusto: boolean;
  /**
   * Unidades que haviam sido vendidas a descoberto e agora foram cobertas
   * por esta entrada.
   */
  readonly unidadesRegularizadas: Dec;
  /**
   * Diferença entre o que essas unidades custaram de verdade e o que se
   * supôs quando saíram.
   *
   * **Informativo. Não é aplicado ao custo médio** — é correção de resultado
   * do período, não ajuste de estoque. Ver docs/COST_POLICY.md §3.
   */
  readonly ajusteRegularizacao: Dec;
}

export interface Entrada {
  readonly quantidade: ValorEntrada;
  readonly custoUnitario: ValorEntrada;
}

export interface Saida {
  readonly quantidade: ValorEntrada;
}

export interface SaidaComCusto extends Saida {
  readonly custoUnitario: ValorEntrada;
}

// ---------------------------------------------------------------------------
// Construção e validação
// ---------------------------------------------------------------------------

export function posicaoVazia(): Posicao {
  return { saldo: ZERO, custoMedio: ZERO };
}

export function posicao(saldo: ValorEntrada, custoMedio: ValorEntrada): Posicao {
  const custo = dec(custoMedio);
  if (ehNegativo(custo)) {
    throw new CustoInvalidoError(custo.toString());
  }
  return {
    saldo: arredondarQuantidade(dec(saldo)),
    custoMedio: arredondarCusto(custo),
  };
}

/** A posição resultante de um movimento. Alimenta o movimento seguinte. */
export function proximaPosicao(resultado: ResultadoMovimento): Posicao {
  return {
    saldo: resultado.saldoPosterior,
    custoMedio: resultado.custoMedioDepois,
  };
}

export function valorEstoque(p: Posicao): Dec {
  return arredondarValor(p.saldo.times(p.custoMedio));
}

function exigirQuantidadePositiva(valor: ValorEntrada): Dec {
  const quantidade = arredondarQuantidade(dec(valor));
  if (quantidade.lessThanOrEqualTo(0)) {
    throw new QuantidadeInvalidaError(quantidade.toString());
  }
  return quantidade;
}

function exigirCustoNaoNegativo(valor: ValorEntrada): Dec {
  const custo = arredondarCusto(dec(valor));
  if (ehNegativo(custo)) {
    throw new CustoInvalidoError(custo.toString());
  }
  return custo;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Entrada de estoque.
 *
 * - saldo anterior **> 0** → média ponderada
 * - saldo anterior **≤ 0** → custo redefinido (ponderar não faz sentido: não
 *   há base positiva, e o denominador poderia ser zero ou negativo, o que
 *   produziria custo médio negativo)
 *
 * Devolução de venda e estorno de saída usam esta mesma função, passando em
 * `custoUnitario` o custo gravado no movimento original. Ver §5 e §7 do
 * contrato.
 */
export function aplicarEntrada(atual: Posicao, entrada: Entrada): ResultadoMovimento {
  const quantidade = exigirQuantidadePositiva(entrada.quantidade);
  const custoEntrada = exigirCustoNaoNegativo(entrada.custoUnitario);

  const saldoAnterior = atual.saldo;
  const custoMedioAntes = atual.custoMedio;
  const saldoPosterior = arredondarQuantidade(saldoAnterior.plus(quantidade));

  let custoMedioDepois: Dec;
  let politica: PoliticaCusto;

  if (saldoAnterior.greaterThan(0)) {
    // Denominador é sempre positivo aqui: saldo > 0 e quantidade > 0.
    const numerador = saldoAnterior.times(custoMedioAntes).plus(quantidade.times(custoEntrada));
    const denominador = saldoAnterior.plus(quantidade);
    custoMedioDepois = arredondarCusto(numerador.dividedBy(denominador));
    politica = 'MEDIA_PONDERADA';
  } else {
    custoMedioDepois = custoEntrada;
    politica = 'CUSTO_REDEFINIDO';
  }

  // Unidades que saíram a descoberto e agora foram cobertas. Ver §3.
  let unidadesRegularizadas = ZERO;
  let ajusteRegularizacao = ZERO;

  if (ehNegativo(saldoAnterior)) {
    unidadesRegularizadas = menor(saldoAnterior.abs(), quantidade);
    ajusteRegularizacao = arredondarValor(
      unidadesRegularizadas.times(custoEntrada.minus(custoMedioAntes)),
    );
  }

  return {
    saldoAnterior,
    saldoPosterior,
    custoMedioAntes,
    custoMedioDepois,
    custoUnitario: custoEntrada,
    politica,
    saldoNegativo: ehNegativo(saldoPosterior),
    semBaseDeCusto: false,
    unidadesRegularizadas,
    ajusteRegularizacao,
  };
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

/**
 * Saída de estoque ao custo médio vigente.
 *
 * **Nunca altera o custo médio** — nem quando o saldo fica negativo. Zerar a
 * média ao ficar negativo seria conveniente e errado: a próxima entrada
 * perderia a referência do que o item custava.
 */
export function aplicarSaida(atual: Posicao, saida: Saida): ResultadoMovimento {
  const quantidade = exigirQuantidadePositiva(saida.quantidade);
  const saldoPosterior = arredondarQuantidade(atual.saldo.minus(quantidade));

  return {
    saldoAnterior: atual.saldo,
    saldoPosterior,
    custoMedioAntes: atual.custoMedio,
    custoMedioDepois: atual.custoMedio,
    custoUnitario: atual.custoMedio,
    politica: 'SEM_EFEITO',
    saldoNegativo: ehNegativo(saldoPosterior),
    semBaseDeCusto: atual.custoMedio.isZero(),
    unidadesRegularizadas: ZERO,
    ajusteRegularizacao: ZERO,
  };
}

/**
 * Saída a um custo específico, não ao custo médio.
 *
 * Usada no estorno de entrada: cancelar uma compra retira as unidades pelo
 * custo daquela compra. A média **não** volta ao valor anterior, porque
 * outros movimentos podem ter ocorrido no intervalo — reescrever o passado
 * tornaria todo relatório irreprodutível.
 */
export function aplicarSaidaComCustoEspecifico(
  atual: Posicao,
  saida: SaidaComCusto,
): ResultadoMovimento {
  const quantidade = exigirQuantidadePositiva(saida.quantidade);
  const custoUnitario = exigirCustoNaoNegativo(saida.custoUnitario);
  const saldoPosterior = arredondarQuantidade(atual.saldo.minus(quantidade));

  return {
    saldoAnterior: atual.saldo,
    saldoPosterior,
    custoMedioAntes: atual.custoMedio,
    custoMedioDepois: atual.custoMedio,
    custoUnitario,
    politica: 'CUSTO_HISTORICO',
    saldoNegativo: ehNegativo(saldoPosterior),
    semBaseDeCusto: false,
    unidadesRegularizadas: ZERO,
    ajusteRegularizacao: ZERO,
  };
}

// ---------------------------------------------------------------------------
// Transferência
// ---------------------------------------------------------------------------

export interface ResultadoTransferencia {
  readonly origem: ResultadoMovimento;
  readonly destino: ResultadoMovimento;
}

/**
 * Transferência entre locais: o custo atravessa junto com a mercadoria.
 *
 * Transferir não cria nem destrói valor. Se o custo médio da empresa mudasse
 * por mover caixa de uma sala para outra, o modelo estaria errado.
 */
export function aplicarTransferencia(
  origem: Posicao,
  destino: Posicao,
  quantidade: ValorEntrada,
): ResultadoTransferencia {
  const saida = aplicarSaida(origem, { quantidade });
  const entrada = aplicarEntrada(destino, {
    quantidade,
    custoUnitario: saida.custoUnitario,
  });
  return { origem: saida, destino: entrada };
}
