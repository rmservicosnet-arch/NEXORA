import { randomUUID } from 'expo-crypto';

import { apagarRefresh, guardarRefresh, lerRefresh } from './armazenamento';

/**
 * O cliente HTTP do aplicativo.
 *
 * Três diferenças para o do web, e as três vêm de `docs/MOBILE.md` §4:
 *
 * 1. **Sem cookie.** O refresh viaja no CORPO (`canal: 'app'`) e mora no
 *    Keystore. No navegador ele fica num cookie httpOnly que o JavaScript da
 *    página não lê; aqui o equivalente é o armazenamento do sistema.
 * 2. **`Idempotency-Key` em toda escrita.** Conexão de balcão cai e o app
 *    reenvia. Sem a chave, nascem duas vendas.
 * 3. **Erro pelo CÓDIGO.** `{ codigo, mensagem }` é contrato; a frase em
 *    português é para a pessoa. O aplicativo decide pelo código.
 */

/** Uma renovação por vez, como no web: refresh rotativo não admite corrida. */
let renovacaoEmAndamento: Promise<boolean> | null = null;

let tokenAcesso: string | null = null;

/** Chamado quando a sessão morre de verdade — a tela volta para o login. */
let aoPerderSessao: (() => void) | null = null;

export function definirToken(token: string | null): void {
  tokenAcesso = token;
}

export function tokenAtual(): string | null {
  return tokenAcesso;
}

export function aoSairSozinho(acao: () => void): void {
  aoPerderSessao = acao;
}

export interface ErroApi {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly { campo: string; problema: string }[];
}

export class ErroRequisicao extends Error {
  constructor(
    readonly status: number,
    readonly corpo: ErroApi,
  ) {
    super(corpo.mensagem);
    this.name = 'ErroRequisicao';
  }

  /** O servidor recusou por limite de tentativas. Esperar resolve. */
  get eLimite(): boolean {
    return this.corpo.codigo === 'MUITAS_TENTATIVAS';
  }

  /** A mesma operação já está em voo. Reenviar daqui a pouco resolve. */
  get eRepeticaoEmVoo(): boolean {
    return this.corpo.codigo === 'IDEMPOTENCIA_EM_ANDAMENTO';
  }
}

/** Erro de rede: nem chegou ao servidor. Diferente de erro DO servidor. */
export class ErroDeRede extends Error {
  readonly codigo = 'SEM_CONEXAO';

  constructor() {
    super('Sem conexão. Verifique a rede e tente de novo.');
    this.name = 'ErroDeRede';
  }
}

interface Opcoes {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /**
   * Chave de idempotência.
   *
   * Quem a gera é a TELA, não este cliente, e uma vez só: a chave precisa
   * sobreviver ao reenvio. Gerada aqui, cada tentativa teria uma nova — e
   * duas tentativas com chaves diferentes são duas vendas, que é exatamente
   * o que ela existe para impedir.
   */
  readonly chaveIdempotencia?: string;
  readonly semRenovar?: boolean;
}

/** Gera uma chave para uma operação. Guarde-a e reuse no reenvio. */
export function novaChaveIdempotencia(): string {
  return randomUUID();
}

let baseUrl = '';

export function definirBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '');
}

export function baseAtual(): string {
  return baseUrl;
}

async function bruto(caminho: string, opcoes: Opcoes = {}): Promise<Response> {
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };

  if (tokenAcesso) {
    cabecalhos['Authorization'] = `Bearer ${tokenAcesso}`;
  }

  if (opcoes.chaveIdempotencia) {
    cabecalhos['Idempotency-Key'] = opcoes.chaveIdempotencia;
  }

  try {
    return await fetch(`${baseUrl}${caminho}`, {
      method: opcoes.method ?? 'GET',
      headers: cabecalhos,
      ...(opcoes.body === undefined ? {} : { body: JSON.stringify(opcoes.body) }),
    });
  } catch {
    /*
      `fetch` só lança quando a requisição não chegou. Distinguir isso de um
      erro do servidor é o que permite à tela dizer "sem conexão" em vez de
      "algo deu errado" — e é a diferença entre o vendedor tentar de novo ou
      chamar o suporte.
    */
    throw new ErroDeRede();
  }
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

async function lerErro(resposta: Response): Promise<ErroApi> {
  try {
    const corpo = (await resposta.json()) as Partial<ErroApi>;
    if (corpo.codigo) {
      return corpo as ErroApi;
    }
  } catch {
    // Corpo vazio ou não-JSON.
  }

  /*
    Todo erro da API sai com `codigo` desde o `ErroFiltro` global. Cair aqui
    significa que a resposta não veio da nossa API — proxy, portal cativo de
    wi-fi, servidor fora do ar devolvendo HTML.
  */
  return {
    codigo: 'RESPOSTA_INESPERADA',
    mensagem: 'O servidor respondeu algo que o aplicativo não entende.',
  };
}

/**
 * Renova o acesso com o refresh do Keystore.
 *
 * Uma promessa compartilhada: cinco requisições que recebem 401 ao mesmo
 * tempo disparariam cinco renovações, e como o refresh é rotativo, quatro
 * apresentariam um token já usado. O servidor trata reuso como roubo e
 * derruba a família inteira — a própria proteção viraria o defeito.
 */
async function renovar(): Promise<boolean> {
  renovacaoEmAndamento ??= (async () => {
    try {
      const refresh = await lerRefresh();
      if (!refresh) {
        return false;
      }

      const resposta = await bruto('/auth/refresh', {
        method: 'POST',
        body: { canal: 'app', refreshToken: refresh },
        semRenovar: true,
      });

      if (!resposta.ok) {
        await encerrar();
        return false;
      }

      const sessao = (await resposta.json()) as { tokenAcesso: string; tokenRefresh: string };
      definirToken(sessao.tokenAcesso);
      await guardarRefresh(sessao.tokenRefresh);
      return true;
    } catch {
      // Sem rede: NÃO encerra a sessão. O token voltará a valer quando a
      // conexão voltar, e deslogar o vendedor por causa de um elevador seria
      // o aplicativo brigando com a realidade do balcão.
      return false;
    } finally {
      renovacaoEmAndamento = null;
    }
  })();

  return renovacaoEmAndamento;
}

async function encerrar(): Promise<void> {
  definirToken(null);
  await apagarRefresh();
  aoPerderSessao?.();
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

export interface UsuarioDaSessao {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly permissoes: readonly string[];
  readonly lojaIds: readonly string[];
  readonly suporteDe?: string;
}

interface RespostaSessao {
  readonly tokenAcesso: string;
  readonly tokenRefresh: string;
  readonly usuario: UsuarioDaSessao;
}

export const sessao = {
  async entrar(email: string, senha: string): Promise<UsuarioDaSessao> {
    const r = await pedir<RespostaSessao>('/auth/login', {
      method: 'POST',
      body: { email, senha, canal: 'app' },
      semRenovar: true,
    });

    definirToken(r.tokenAcesso);
    await guardarRefresh(r.tokenRefresh);
    return r.usuario;
  },

  /** Volta a valer a sessão guardada, se houver. */
  async restaurar(): Promise<UsuarioDaSessao | null> {
    const refresh = await lerRefresh();
    if (!refresh) {
      return null;
    }

    try {
      const r = await pedir<RespostaSessao>('/auth/refresh', {
        method: 'POST',
        body: { canal: 'app', refreshToken: refresh },
        semRenovar: true,
      });

      definirToken(r.tokenAcesso);
      await guardarRefresh(r.tokenRefresh);
      return r.usuario;
    } catch (erro) {
      /*
        Sem rede o refresh guardado continua bom: apagá-lo mandaria a pessoa
        digitar a senha de novo por causa de um instante sem sinal. Só uma
        RECUSA do servidor encerra a sessão.
      */
      if (erro instanceof ErroDeRede) {
        return null;
      }
      await encerrar();
      return null;
    }
  },

  async sair(): Promise<void> {
    const refresh = await lerRefresh();
    try {
      if (refresh) {
        // Revoga no SERVIDOR. Só apagar o token local deixaria a sessão viva
        // pelos 30 dias do refresh — era o defeito do logout antes de 09/2026.
        await pedir<void>('/auth/logout', {
          method: 'POST',
          body: { canal: 'app', refreshToken: refresh },
          semRenovar: true,
        });
      }
    } catch {
      // Sair não pode falhar por causa da rede: o local é limpo de todo jeito.
    } finally {
      definirToken(null);
      await apagarRefresh();
    }
  },

  async eu(): Promise<UsuarioDaSessao> {
    return pedir<UsuarioDaSessao>('/auth/eu');
  },
};
