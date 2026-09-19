import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, definirToken } from './cliente';

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

    expect(pedidos).toEqual(['estoque:restaurar-sessao']);
    expect(sessao).not.toBeNull();
  });

  it('sem a trava disponível, ainda restaura', async () => {
    vi.stubGlobal('navigator', undefined);

    await expect(api.restaurar()).resolves.not.toBeNull();
  });
});
