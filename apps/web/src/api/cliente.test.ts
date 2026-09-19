import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, definirToken, pedir, tokenAtual } from './cliente';

/**
 * O refresh é rotativo e o servidor trata reapresentação como reuso: ele
 * revoga a família inteira de sessões. Isso é proteção correta — e por isso
 * o cliente nunca pode disparar duas renovações com o mesmo cookie.
 *
 * O caminho de renovação já compartilhava uma promessa. O de restauração —
 * o que roda em TODO carregamento de página — não compartilhava, e o
 * `StrictMode` monta o provedor duas vezes: duas restaurações saíam juntas,
 * a segunda apresentava um token recém-rotacionado, e a sessão boa morria.
 * Quem recarregava a página caía no login.
 */
describe('restauração de sessão', () => {
  let chamadas: string[];

  beforeEach(() => {
    chamadas = [];
    definirToken(null);

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        chamadas.push(url);
        // Uma volta no laço de eventos: sem isso a primeira chamada resolve
        // antes de a segunda começar, e a corrida nunca acontece.
        return new Promise<Response>((resolver) => {
          setTimeout(() => {
            resolver(
              new Response(
                JSON.stringify({
                  tokenAcesso: 'token-novo',
                  usuario: { id: 'u1', nome: 'Alguém', email: 'a@b.c', permissoes: [] },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
              ),
            );
          }, 5);
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    definirToken(null);
  });

  it('duas restaurações simultâneas viram UMA requisição', async () => {
    const [a, b] = await Promise.all([api.restaurar(), api.restaurar()]);

    expect(chamadas.filter((u) => u.includes('/auth/refresh'))).toHaveLength(1);
    // As duas montagens precisam receber a sessão: deduplicar não pode
    // significar que a segunda fica sem resposta.
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('uma restauração posterior é uma requisição nova', async () => {
    await api.restaurar();
    await api.restaurar();

    expect(chamadas.filter((u) => u.includes('/auth/refresh'))).toHaveLength(2);
  });
  /**
   * A promessa compartilhada só enxerga a própria aba. Entre abas quem
   * serializa é `navigator.locks` — e o que se pode afirmar aqui é que o
   * cliente realmente pede a trava; segurar a fila é trabalho do navegador.
   */
  it('a restauração passa pela trava entre abas quando existe', async () => {
    const pedidos: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: async (nome: string, tarefa: () => Promise<unknown>) => {
          pedidos.push(nome);
          return tarefa();
        },
      },
    });

    const sessao = await api.restaurar();

    expect(pedidos).toEqual(['estoque:restaurar-equipe']);
    expect(sessao).not.toBeNull();
  });

  it('sem a trava disponível, ainda restaura', async () => {
    vi.stubGlobal('navigator', undefined);

    await expect(api.restaurar()).resolves.not.toBeNull();
  });
});

/**
 * Equipe e cliente são domínios separados por desenho (ADR-009). No navegador
 * isso significa dois cofres de token: se fossem um só, abrir o portal
 * derrubaria a sessão da equipe na mesma aba — e o inverso.
 */
describe('dois domínios de autenticação', () => {
  beforeEach(() => {
    definirToken(null);
    definirToken(null, 'portal');

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const autorizacao = (init?.headers as Record<string, string> | undefined)?.[
          'Authorization'
        ];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tokenAcesso: url.includes('/portal/') ? 'token-portal' : 'token-equipe',
              usuario: { id: 'u1', nome: 'Alguém', email: 'a@b.c', permissoes: [] },
              // Devolvido para o teste conferir QUAL token viajou.
              autorizacaoRecebida: autorizacao ?? null,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    definirToken(null);
    definirToken(null, 'portal');
  });

  it('entrar no portal não derruba o token da equipe', async () => {
    await api.entrar('a@b.c', 'x');
    expect(tokenAtual()).toBe('token-equipe');

    await api.portal.entrar('cliente@b.c', 'x');

    expect(tokenAtual('portal')).toBe('token-portal');
    expect(tokenAtual()).toBe('token-equipe');
  });

  it('o caminho decide qual token viaja', async () => {
    await api.entrar('a@b.c', 'x');
    await api.portal.entrar('cliente@b.c', 'x');

    const daEquipe = await pedir<{ autorizacaoRecebida: string }>('/pedidos');
    const doPortal = await pedir<{ autorizacaoRecebida: string }>('/portal/pedidos');

    expect(daEquipe.autorizacaoRecebida).toBe('Bearer token-equipe');
    expect(doPortal.autorizacaoRecebida).toBe('Bearer token-portal');
  });
});
