import type { AdminPlataforma } from '@estoque/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '../api/cliente';

/**
 * A sessão da PLATAFORMA.
 *
 * Terceiro provedor, não um parâmetro dos outros dois. Os três domínios têm
 * cookie, segredo e token próprios (ADR-009, ADR-011), e um provedor só
 * acabaria guardando "o usuário" — que aqui são três pessoas diferentes,
 * podendo estar logadas ao mesmo tempo no mesmo navegador.
 *
 * Não há `pode()`, e a ausência é deliberada: permissões vivem dentro de uma
 * empresa, e quem entra aqui não tem empresa. O que autoriza é o domínio — o
 * token da plataforma não abre nenhuma rota de empresa, e o de empresa não
 * abre nenhuma daqui. Dá 401, não 403: falha na autenticação.
 */
interface ValorSessaoPlataforma {
  readonly admin: AdminPlataforma | null;
  readonly restaurando: boolean;
  readonly entrar: (email: string, senha: string) => Promise<void>;
  readonly sair: () => Promise<void>;
}

const Contexto = createContext<ValorSessaoPlataforma | null>(null);

export function ProvedorSessaoPlataforma({ children }: { readonly children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminPlataforma | null>(null);
  const [restaurando, setRestaurando] = useState(true);
  const fila = useQueryClient();

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      const sessao = await api.plataforma.restaurar();
      if (cancelado) return;
      if (sessao) setAdmin(sessao.admin);
      setRestaurando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  /**
   * Esvazia o cache ao entrar e ao sair.
   *
   * Mesmo motivo dos outros dois provedores, e aqui o estrago seria maior: a
   * chave de consulta descreve o filtro, não quem perguntou, e o que está em
   * cache é a lista de TODAS as empresas.
   */
  const esvaziarCache = useCallback(() => {
    fila.clear();
  }, [fila]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      esvaziarCache();
      const sessao = await api.plataforma.entrar(email, senha);
      setAdmin(sessao.admin);
    },
    [esvaziarCache],
  );

  const sair = useCallback(async () => {
    try {
      await api.plataforma.sair();
    } finally {
      setAdmin(null);
      esvaziarCache();
    }
  }, [esvaziarCache]);

  const valor = useMemo<ValorSessaoPlataforma>(
    () => ({ admin, restaurando, entrar, sair }),
    [admin, restaurando, entrar, sair],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessaoPlataforma(): ValorSessaoPlataforma {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error('useSessaoPlataforma precisa estar dentro de <ProvedorSessaoPlataforma>.');
  }
  return valor;
}
