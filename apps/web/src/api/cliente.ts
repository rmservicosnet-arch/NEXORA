import type { ErroApi, Sessao } from '@estoque/contracts';

const BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3333/api';

/**
 * O token de acesso vive em memória, não em `localStorage`.
 *
 * `localStorage` é legível por qualquer script da página: um XSS entrega a
 * sessão inteira. Em memória, o token morre ao recarregar — e é aí que o
 * refresh em cookie httpOnly entra, restaurando a sessão sem nunca ter
 * ficado exposto ao JavaScript.
 */
let tokenAcesso: string | null = null;

export function definirToken(token: string | null): void {
  tokenAcesso = token;
}

export function tokenAtual(): string | null {
  return tokenAcesso;
}

export class ErroRequisicao extends Error {
  constructor(
    readonly status: number,
    readonly corpo: ErroApi,
  ) {
    super(corpo.mensagem);
    this.name = 'ErroRequisicao';
  }

  get codigo(): string {
    return this.corpo.codigo;
  }
}

async function lerErro(resposta: Response): Promise<ErroApi> {
  try {
    const corpo = (await resposta.json()) as Partial<ErroApi>;
    return {
      codigo: corpo.codigo ?? 'ERRO_DESCONHECIDO',
      mensagem: corpo.mensagem ?? 'Não foi possível concluir a operação.',
      ...(corpo.campos ? { campos: corpo.campos } : {}),
      ...(corpo.permissoesFaltantes ? { permissoesFaltantes: corpo.permissoesFaltantes } : {}),
    };
  } catch {
    return { codigo: 'ERRO_DESCONHECIDO', mensagem: 'Não foi possível concluir a operação.' };
  }
}

interface Opcoes extends Omit<RequestInit, 'body'> {
  readonly body?: unknown;
  /** Evita laço infinito de renovação. */
  readonly semRenovar?: boolean;
}

async function bruto(caminho: string, opcoes: Opcoes = {}): Promise<Response> {
  const { body, semRenovar: _semRenovar, headers, ...resto } = opcoes;

  return fetch(`${BASE}${caminho}`, {
    ...resto,
    // Necessário para o cookie de refresh viajar.
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(tokenAcesso ? { Authorization: `Bearer ${tokenAcesso}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Renovação em andamento, compartilhada.
 *
 * Sem isto, cinco requisições que recebem 401 ao mesmo tempo disparariam
 * cinco renovações — e como o refresh é rotativo, quatro delas apresentariam
 * um token já rotacionado. O servidor trataria como reuso e derrubaria a
 * sessão inteira. A própria proteção do servidor viraria um bug do cliente.
 */
let renovacaoEmAndamento: Promise<boolean> | null = null;

/** Restauração de boot em andamento. Ver o comentário em `restaurar`. */
let restauracaoEmAndamento: Promise<Sessao | null> | null = null;

/**
 * Serializa uma tarefa entre as abas da mesma origem.
 *
 * A promessa compartilhada resolve a corrida dentro de UMA aba. Duas abas são
 * dois contextos de JavaScript e não se enxergam: abertas juntas, as duas
 * restauram com o mesmo cookie e a segunda derruba a família. O cookie, ao
 * contrário da memória, é compartilhado — então basta esperar a vez: quando a
 * segunda aba for, o cookie já é o rotacionado, e ela renova normalmente.
 *
 * Sem `navigator.locks` a tarefa roda direto. É pior que travar, e melhor que
 * não restaurar.
 */
async function emFila<T>(nome: string, tarefa: () => Promise<T>): Promise<T> {
  const travas = globalThis.navigator?.locks;
  if (!travas) {
    return tarefa();
  }
  return travas.request(nome, tarefa) as Promise<T>;
}

async function renovar(): Promise<boolean> {
  renovacaoEmAndamento ??= (async () => {
    try {
      const resposta = await bruto('/auth/refresh', {
        method: 'POST',
        body: { canal: 'web' },
        semRenovar: true,
      });

      if (!resposta.ok) {
        definirToken(null);
        return false;
      }

      const sessao = (await resposta.json()) as Sessao;
      definirToken(sessao.tokenAcesso);
      return true;
    } catch {
      definirToken(null);
      return false;
    } finally {
      // Libera na próxima volta do laço de eventos, para que chamadas
      // simultâneas ainda peguem esta mesma promessa.
      queueMicrotask(() => {
        renovacaoEmAndamento = null;
      });
    }
  })();

  return renovacaoEmAndamento;
}

export async function pedir<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  let resposta = await bruto(caminho, opcoes);

  if (resposta.status === 401 && !opcoes.semRenovar) {
    const renovou = await renovar();
    if (renovou) {
      resposta = await bruto(caminho, { ...opcoes, semRenovar: true });
    }
  }

  if (!resposta.ok) {
    throw new ErroRequisicao(resposta.status, await lerErro(resposta));
  }

  if (resposta.status === 204) {
    return undefined as T;
  }

  return (await resposta.json()) as T;
}

/**
 * Busca um binário (imagem) com o token de acesso.
 *
 * `<img src="/api/midia/…">` não serve: a tag não manda cabeçalho de
 * autorização. Ou a rota de mídia viraria pública — e o id da foto viraria
 * senha —, ou o binário vem por aqui e o navegador recebe um `blob:` local.
 */
export async function pedirBlob(caminho: string): Promise<Blob> {
  let resposta = await bruto(caminho);

  if (resposta.status === 401) {
    const renovou = await renovar();
    if (renovou) {
      resposta = await bruto(caminho, { semRenovar: true });
    }
  }

  if (!resposta.ok) {
    throw new ErroRequisicao(resposta.status, await lerErro(resposta));
  }

  return resposta.blob();
}

/** Envia o arquivo para onde a API autorizou. Não passa pelo cliente da API. */
export async function enviarArquivo(
  destino: { url: string; metodo: string; cabecalhos: Record<string, string> },
  arquivo: File,
): Promise<void> {
  const resposta = await fetch(destino.url, {
    method: destino.metodo,
    headers: destino.cabecalhos,
    body: arquivo,
  });

  if (!resposta.ok) {
    throw new ErroRequisicao(resposta.status, await lerErro(resposta));
  }
}

export const api = {
  entrar: (email: string, senha: string): Promise<Sessao> =>
    pedir<Sessao>('/auth/login', {
      method: 'POST',
      body: { email, senha, canal: 'web' },
      semRenovar: true,
    }),

  restaurar: async (): Promise<Sessao | null> => {
    // Mesma proteção de `renovacaoEmAndamento`, num caminho que escapara dela.
    //
    // O `StrictMode` monta o provedor duas vezes em desenvolvimento, e as duas
    // montagens chamam `restaurar`. O sinal de cancelamento descarta o segundo
    // *resultado*, mas as duas requisições já saíram — com o mesmo cookie. A
    // segunda apresenta um token recém-rotacionado, o servidor lê reuso e
    // revoga a família inteira. Não é o boot que falha: é a sessão boa que
    // morre junto, e o próximo carregamento cai no login.
    restauracaoEmAndamento ??= (async () => {
      try {
        return await emFila('estoque:restaurar-sessao', () =>
          pedir<Sessao>('/auth/refresh', {
            method: 'POST',
            body: { canal: 'web' },
            semRenovar: true,
          }),
        );
      } catch {
        return null;
      } finally {
        queueMicrotask(() => {
          restauracaoEmAndamento = null;
        });
      }
    })();

    return restauracaoEmAndamento;
  },

  sair: async (): Promise<void> => {
    try {
      await pedir<void>('/auth/logout', { method: 'POST', semRenovar: true });
    } finally {
      definirToken(null);
    }
  },
};
