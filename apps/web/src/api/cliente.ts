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

export const api = {
  entrar: (email: string, senha: string): Promise<Sessao> =>
    pedir<Sessao>('/auth/login', {
      method: 'POST',
      body: { email, senha, canal: 'web' },
      semRenovar: true,
    }),

  restaurar: async (): Promise<Sessao | null> => {
    try {
      return await pedir<Sessao>('/auth/refresh', {
        method: 'POST',
        body: { canal: 'web' },
        semRenovar: true,
      });
    } catch {
      return null;
    }
  },

  sair: async (): Promise<void> => {
    try {
      await pedir<void>('/auth/logout', { method: 'POST', semRenovar: true });
    } finally {
      definirToken(null);
    }
  },
};
