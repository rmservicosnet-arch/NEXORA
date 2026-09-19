import { z } from 'zod';

/**
 * Mensagens de validação em português do Brasil.
 *
 * Não é enfeite: o **mesmo** schema valida no navegador e na API. Sem isto,
 * "Too small: expected string to have >=2 characters" chega tanto no campo do
 * formulário quanto no corpo do erro HTTP — inclusive para um aplicativo que
 * nunca abriu a tela.
 *
 * A locale `pt` do Zod é de Portugal ("Demasiado pequeno", "Inválido registo
 * de entrada"). Para as mensagens que o usuário realmente vê — tipo errado,
 * tamanho, valor fora da lista — escrevemos a versão brasileira; o resto cai
 * na locale do Zod, que continua correta ainda que soe lusitana.
 */

const base = z.locales.pt().localeError;

const NOMES: Record<string, string> = {
  string: 'texto',
  number: 'número',
  boolean: 'booleano',
  array: 'lista',
  object: 'objeto',
  date: 'data',
  bigint: 'número inteiro grande',
};

function unidade(origem: string | undefined, plural: boolean): string {
  switch (origem) {
    case 'string':
      return plural ? 'caracteres' : 'caractere';
    case 'array':
    case 'set':
      return plural ? 'itens' : 'item';
    case 'file':
      return plural ? 'bytes' : 'byte';
    default:
      return '';
  }
}

function comUnidade(quantidade: unknown, origem: string | undefined): string {
  const u = unidade(origem, quantidade !== 1 && quantidade !== 1n);
  return u ? `${String(quantidade)} ${u}` : String(quantidade);
}

z.config({
  localeError: (problema) => {
    const p = problema as {
      code?: string;
      expected?: string;
      origin?: string;
      minimum?: unknown;
      maximum?: unknown;
      inclusive?: boolean;
      values?: readonly unknown[];
      input?: unknown;
    };

    switch (p.code) {
      case 'invalid_type':
        return p.input === undefined
          ? 'Campo obrigatório'
          : `Esperava ${NOMES[p.expected ?? ''] ?? p.expected}`;

      case 'too_small':
        return p.inclusive === false
          ? `Precisa ser maior que ${comUnidade(p.minimum, p.origin)}`
          : `Precisa ter ao menos ${comUnidade(p.minimum, p.origin)}`;

      case 'too_big':
        return p.inclusive === false
          ? `Precisa ser menor que ${comUnidade(p.maximum, p.origin)}`
          : `Precisa ter no máximo ${comUnidade(p.maximum, p.origin)}`;

      case 'invalid_value':
        return p.values?.length === 1
          ? `Precisa ser ${JSON.stringify(p.values[0])}`
          : `Valor fora das opções aceitas`;

      default:
        // `base` sempre devolve algo para os códigos que o Zod emite.
        return base(problema) as string;
    }
  },
});
