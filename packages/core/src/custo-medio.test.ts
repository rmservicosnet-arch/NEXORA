import { describe, expect, it } from 'vitest';

import {
  aplicarEntrada,
  aplicarSaida,
  aplicarSaidaComCustoEspecifico,
  aplicarTransferencia,
  posicao,
  posicaoVazia,
  proximaPosicao,
  valorEstoque,
  type Posicao,
  type ResultadoMovimento,
} from './custo-medio';
import { dec, formatarBRL, type Dec } from './dinheiro';
import { CustoInvalidoError, QuantidadeInvalidaError, ValorImprecisoError } from './erros';

/** Compara decimais pelo texto — evita comparar objetos por identidade. */
function igual(valor: Dec, esperado: string): void {
  expect(valor.toString()).toBe(esperado);
}

function custo(valor: Dec, esperado: string): void {
  expect(valor.toFixed(6)).toBe(esperado);
}

describe('dinheiro — a barreira contra ponto flutuante', () => {
  it('recusa number com casas decimais', () => {
    expect(() => dec(0.1)).toThrow(ValorImprecisoError);
    expect(() => dec(38.4)).toThrow(ValorImprecisoError);
  });

  it('aceita inteiro, string e Decimal', () => {
    igual(dec(30), '30');
    igual(dec('38.40'), '38.4');
    igual(dec(dec('42')), '42');
  });

  it('o erro carrega código estável para o aplicativo decidir', () => {
    try {
      dec(1.5);
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect((erro as ValorImprecisoError).codigo).toBe('VALOR_IMPRECISO');
    }
  });

  it('formata no padrão brasileiro, inclusive negativo', () => {
    expect(formatarBRL(dec('1234.5'))).toBe('R$ 1.234,50');
    expect(formatarBRL(dec('-460.8'))).toBe('− R$ 460,80');
    expect(formatarBRL(dec('248317.4'))).toBe('R$ 248.317,40');
  });
});

describe('entrada', () => {
  it('primeira entrada define o custo: não há base para ponderar', () => {
    const r = aplicarEntrada(posicaoVazia(), { quantidade: 30, custoUnitario: '36.00' });

    igual(r.saldoAnterior, '0');
    igual(r.saldoPosterior, '30');
    custo(r.custoMedioDepois, '36.000000');
    expect(r.politica).toBe('CUSTO_REDEFINIDO');
    expect(r.saldoNegativo).toBe(false);
  });

  it('pondera quando o saldo anterior é positivo', () => {
    // (30 × 36,00 + 20 × 42,00) / 50 = 1920 / 50 = 38,40
    const r = aplicarEntrada(posicao(30, '36.00'), { quantidade: 20, custoUnitario: '42.00' });

    igual(r.saldoPosterior, '50');
    custo(r.custoMedioDepois, '38.400000');
    expect(r.politica).toBe('MEDIA_PONDERADA');
  });

  it('mantém 6 casas no custo, porque divisão não costuma ser exata', () => {
    // (3 × 10 + 1 × 11) / 4 = 41 / 4 = 10,25  (exato)
    // (3 × 10 + 1 × 11) / 7 não se aplica; use um caso realmente dizimal:
    // (1 × 10 + 2 × 11) / 3 = 32 / 3 = 10,666666...
    const r = aplicarEntrada(posicao(1, '10.00'), { quantidade: 2, custoUnitario: '11.00' });
    custo(r.custoMedioDepois, '10.666667');
  });

  it('recusa quantidade zero ou negativa: o sinal vive em `sentido`', () => {
    expect(() => aplicarEntrada(posicaoVazia(), { quantidade: 0, custoUnitario: 10 })).toThrow(
      QuantidadeInvalidaError,
    );
    expect(() => aplicarEntrada(posicaoVazia(), { quantidade: -5, custoUnitario: 10 })).toThrow(
      QuantidadeInvalidaError,
    );
  });

  it('recusa custo negativo', () => {
    expect(() => aplicarEntrada(posicaoVazia(), { quantidade: 1, custoUnitario: '-1' })).toThrow(
      CustoInvalidoError,
    );
  });
});

describe('saída', () => {
  it('consome ao custo médio vigente e não o altera', () => {
    const r = aplicarSaida(posicao(50, '38.40'), { quantidade: 16 });

    igual(r.saldoPosterior, '34');
    custo(r.custoMedioDepois, '38.400000');
    custo(r.custoUnitario, '38.400000');
    expect(r.politica).toBe('SEM_EFEITO');
  });

  it('permite saldo negativo e PRESERVA o custo médio', () => {
    const r = aplicarSaida(posicao(2, '38.40'), { quantidade: 8 });

    igual(r.saldoPosterior, '-6');
    expect(r.saldoNegativo).toBe(true);
    // Zerar a média aqui seria conveniente e errado: a próxima entrada
    // perderia a referência do que o item custava.
    custo(r.custoMedioDepois, '38.400000');
  });

  it('marca saída de item que nunca teve entrada', () => {
    const r = aplicarSaida(posicaoVazia(), { quantidade: 3 });

    expect(r.semBaseDeCusto).toBe(true);
    custo(r.custoUnitario, '0.000000');
    // A margem dessa venda seria 100% — e falsa. O relatório precisa separar.
  });

  it('saída com custo específico não mexe na média (estorno de entrada)', () => {
    const r = aplicarSaidaComCustoEspecifico(posicao(50, '38.40'), {
      quantidade: 20,
      custoUnitario: '42.00',
    });

    igual(r.saldoPosterior, '30');
    custo(r.custoUnitario, '42.000000');
    custo(r.custoMedioDepois, '38.400000');
    expect(r.politica).toBe('CUSTO_HISTORICO');
  });
});

describe('entrada sobre saldo negativo', () => {
  it('redefine o custo em vez de ponderar', () => {
    const r = aplicarEntrada(posicao(-12, '38.40'), { quantidade: 30, custoUnitario: '41.00' });

    igual(r.saldoPosterior, '18');
    custo(r.custoMedioDepois, '41.000000');
    expect(r.politica).toBe('CUSTO_REDEFINIDO');
  });

  it('expõe a regularização sem aplicá-la ao custo médio', () => {
    // 12 unidades saíram supondo 38,40 e custaram 41,00.
    // Diferença: 12 × (41,00 − 38,40) = 12 × 2,60 = 31,20
    const r = aplicarEntrada(posicao(-12, '38.40'), { quantidade: 30, custoUnitario: '41.00' });

    igual(r.unidadesRegularizadas, '12');
    expect(r.ajusteRegularizacao.toFixed(2)).toBe('31.20');
    // Não foi aplicado: a média é o custo da entrada, limpo.
    custo(r.custoMedioDepois, '41.000000');
  });

  it('regulariza no máximo o que a entrada cobre', () => {
    const r = aplicarEntrada(posicao(-30, '38.40'), { quantidade: 10, custoUnitario: '41.00' });

    igual(r.unidadesRegularizadas, '10');
    expect(r.ajusteRegularizacao.toFixed(2)).toBe('26.00');
    igual(r.saldoPosterior, '-20');
    expect(r.saldoNegativo).toBe(true);
  });

  it('entrada com saldo exatamente zero também redefine', () => {
    const r = aplicarEntrada(posicao(0, '38.40'), { quantidade: 5, custoUnitario: '50.00' });

    custo(r.custoMedioDepois, '50.000000');
    expect(r.politica).toBe('CUSTO_REDEFINIDO');
    igual(r.unidadesRegularizadas, '0');
  });
});

describe('devolução de venda', () => {
  it('reentra pelo custo gravado na saída, não pelo custo médio de hoje', () => {
    // Vendeu a 38,40. Depois comprou caro e a média subiu para 60,00.
    // A devolução daquela venda deve voltar a 38,40.
    const r = aplicarEntrada(posicao(10, '60.00'), { quantidade: 2, custoUnitario: '38.40' });

    custo(r.custoUnitario, '38.400000');
    // (10 × 60 + 2 × 38,40) / 12 = 676,80 / 12 = 56,40
    custo(r.custoMedioDepois, '56.400000');
    // Se tivesse entrado a 60,00, a média continuaria 60,00 — a loja teria
    // "valorizado" mercadoria que sempre foi barata.
  });
});

describe('transferência', () => {
  it('o custo atravessa: nada é criado nem destruído', () => {
    const origem = posicao(47, '38.40');
    const destino = posicao(10, '20.00');

    const { origem: saida, destino: entrada } = aplicarTransferencia(origem, destino, 25);

    igual(saida.saldoPosterior, '22');
    custo(saida.custoMedioDepois, '38.400000');
    custo(entrada.custoUnitario, '38.400000');

    igual(entrada.saldoPosterior, '35');
    // (10 × 20 + 25 × 38,40) / 35 = 1160 / 35 = 33,142857...
    custo(entrada.custoMedioDepois, '33.142857');
  });

  it('o valor total da empresa se mantém', () => {
    const origem = posicao(40, '10.00');
    const destino = posicao(0, '0');
    const antes = valorEstoque(origem).plus(valorEstoque(destino));

    const t = aplicarTransferencia(origem, destino, 15);
    const depois = valorEstoque(proximaPosicao(t.origem)).plus(
      valorEstoque(proximaPosicao(t.destino)),
    );

    expect(depois.toFixed(2)).toBe(antes.toFixed(2));
  });
});

describe('valor do estoque', () => {
  it('é negativo quando o saldo é negativo, e isso não é escondido', () => {
    const v = valorEstoque(posicao(-12, '38.40'));
    expect(v.toFixed(2)).toBe('-460.80');
    expect(formatarBRL(v)).toBe('− R$ 460,80');
  });
});

describe('invariantes do contrato', () => {
  it('custo médio nunca fica negativo, nem com saldo negativo', () => {
    let p = posicaoVazia();
    const roteiro: Array<() => ResultadoMovimento> = [
      () => aplicarEntrada(p, { quantidade: 10, custoUnitario: '5.00' }),
      () => aplicarSaida(p, { quantidade: 40 }),
      () => aplicarEntrada(p, { quantidade: 3, custoUnitario: '0' }),
      () => aplicarSaida(p, { quantidade: 2 }),
      () => aplicarEntrada(p, { quantidade: 100, custoUnitario: '7.25' }),
    ];

    for (const passo of roteiro) {
      const r = passo();
      expect(r.custoMedioDepois.isNegative()).toBe(false);
      p = proximaPosicao(r);
    }
  });

  it('média ponderada fica entre o custo antigo e o custo da entrada', () => {
    const casos = [
      { saldo: 10, antigo: '10.00', qtd: 5, novo: '20.00' },
      { saldo: 3, antigo: '99.99', qtd: 97, novo: '1.01' },
      { saldo: 1, antigo: '7.00', qtd: 1, novo: '7.00' },
      { saldo: 250, antigo: '12.345678', qtd: 7, novo: '900.00' },
    ];

    for (const c of casos) {
      const r = aplicarEntrada(posicao(c.saldo, c.antigo), {
        quantidade: c.qtd,
        custoUnitario: c.novo,
      });
      const piso = dec(c.antigo).lessThan(dec(c.novo)) ? dec(c.antigo) : dec(c.novo);
      const teto = dec(c.antigo).greaterThan(dec(c.novo)) ? dec(c.antigo) : dec(c.novo);

      expect(r.custoMedioDepois.greaterThanOrEqualTo(piso)).toBe(true);
      expect(r.custoMedioDepois.lessThanOrEqualTo(teto)).toBe(true);
    }
  });

  it('saldo posterior de um movimento é o anterior do próximo', () => {
    let p = posicaoVazia();
    const resultados: ResultadoMovimento[] = [];

    resultados.push(aplicarEntrada(p, { quantidade: 30, custoUnitario: '36.00' }));
    p = proximaPosicao(resultados[0]!);
    resultados.push(aplicarSaida(p, { quantidade: 4 }));
    p = proximaPosicao(resultados[1]!);
    resultados.push(aplicarEntrada(p, { quantidade: 20, custoUnitario: '42.00' }));

    for (let i = 1; i < resultados.length; i += 1) {
      igual(resultados[i]!.saldoAnterior, resultados[i - 1]!.saldoPosterior.toString());
    }
  });

  it('reaplicar a mesma sequência produz exatamente o mesmo resultado', () => {
    function rodar(): Posicao {
      let p = posicaoVazia();
      p = proximaPosicao(aplicarEntrada(p, { quantidade: 30, custoUnitario: '36.00' }));
      p = proximaPosicao(aplicarEntrada(p, { quantidade: 20, custoUnitario: '42.00' }));
      p = proximaPosicao(aplicarSaida(p, { quantidade: 3 }));
      p = proximaPosicao(aplicarEntrada(p, { quantidade: 7, custoUnitario: '39.99' }));
      return p;
    }

    const a = rodar();
    const b = rodar();
    expect(a.saldo.toString()).toBe(b.saldo.toString());
    expect(a.custoMedio.toFixed(6)).toBe(b.custoMedio.toFixed(6));
  });
});

describe('razão completo — o mesmo da tela "Estoque · Razão de movimentações"', () => {
  it('reproduz saldo −12, custo médio 38,40 e valor − R$ 460,80', () => {
    let p = posicaoVazia();
    const trilha: Array<{ rotulo: string; r: ResultadoMovimento }> = [];

    function entrada(rotulo: string, quantidade: number, custoUnitario: string): void {
      const r = aplicarEntrada(p, { quantidade, custoUnitario });
      trilha.push({ rotulo, r });
      p = proximaPosicao(r);
    }

    function saida(rotulo: string, quantidade: number): void {
      const r = aplicarSaida(p, { quantidade });
      trilha.push({ rotulo, r });
      p = proximaPosicao(r);
    }

    entrada('02/09 compra CP-0201', 30, '36.00');
    entrada('08/09 compra CP-0208', 20, '42.00');
    saida('11/09 ajuste por avaria', 3);
    saida('13/09 transferência enviada', 25);
    saida('15/09 venda #001251', 16);
    saida('18/09 venda #001268', 4);
    saida('19/09 venda #001279', 8);
    saida('19/09 venda #001284', 6);

    const saldos = trilha.map((t) => t.r.saldoPosterior.toString());
    expect(saldos).toEqual(['30', '50', '47', '22', '6', '2', '-6', '-12']);

    // A entrada de 02/09 redefine porque o saldo era zero.
    expect(trilha[0]!.r.politica).toBe('CUSTO_REDEFINIDO');
    custo(trilha[0]!.r.custoMedioDepois, '36.000000');

    // A de 08/09 pondera.
    expect(trilha[1]!.r.politica).toBe('MEDIA_PONDERADA');
    custo(trilha[1]!.r.custoMedioDepois, '38.400000');

    // Nenhuma saída alterou a média.
    for (const t of trilha.slice(2)) {
      expect(t.r.politica).toBe('SEM_EFEITO');
      custo(t.r.custoMedioDepois, '38.400000');
    }

    // As duas últimas ficaram negativas.
    expect(trilha[6]!.r.saldoNegativo).toBe(true);
    expect(trilha[7]!.r.saldoNegativo).toBe(true);

    custo(p.custoMedio, '38.400000');
    igual(p.saldo, '-12');
    expect(formatarBRL(valorEstoque(p))).toBe('− R$ 460,80');
  });
});
