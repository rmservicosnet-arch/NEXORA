/**
 * Erros de domínio.
 *
 * Cada um carrega um `codigo` estável, legível por máquina. O aplicativo
 * mobile decide o que fazer pelo código, não pela mensagem em português —
 * requisito registrado em docs/MOBILE.md §4.
 *
 * Mensagem é para humano e pode mudar. Código é contrato e não muda.
 */

export type DetalhesErro = Readonly<Record<string, string | number | boolean>>;

export class ErroDominio extends Error {
  readonly codigo: string;
  readonly detalhes: DetalhesErro;

  constructor(codigo: string, mensagem: string, detalhes: DetalhesErro = {}) {
    super(mensagem);
    this.name = new.target.name;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/**
 * Um `number` com casas decimais foi usado onde se espera dinheiro ou
 * quantidade.
 *
 * Não é preciosismo: `0.1 + 0.2 === 0.30000000000000004`. Em JavaScript, todo
 * literal decimal já nasce impreciso, antes mesmo de qualquer conta. Aceitar
 * um deles aqui significaria aceitar o erro e propagá-lo até o balanço.
 *
 * Inteiro é aceito porque é exato dentro do intervalo seguro.
 */
export class ValorImprecisoError extends ErroDominio {
  constructor(valor: number) {
    super(
      'VALOR_IMPRECISO',
      `O número ${valor} não pode ser usado como valor monetário ou quantidade. ` +
        `Passe como string ("${valor}") ou como Decimal. Ponto flutuante não representa dinheiro.`,
      { valor },
    );
  }
}

export class QuantidadeInvalidaError extends ErroDominio {
  constructor(quantidade: string) {
    super(
      'QUANTIDADE_INVALIDA',
      `Quantidade de movimento deve ser maior que zero. Recebido: ${quantidade}. ` +
        `O sentido (entrada ou saída) é um campo próprio, não o sinal da quantidade.`,
      { quantidade },
    );
  }
}

export class CustoInvalidoError extends ErroDominio {
  constructor(custo: string) {
    super('CUSTO_INVALIDO', `Custo unitário não pode ser negativo. Recebido: ${custo}.`, {
      custo,
    });
  }
}
