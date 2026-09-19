import type { UsuarioSessao } from '@estoque/contracts';
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
 * A sessão do PORTAL do cliente.
 *
 * Provedor separado do da equipe, não um parâmetro dele. Os dois domínios têm
 * cookie, segredo e token próprios (ADR-009), e um provedor só acabaria
 * guardando "o usuário" — que aqui são duas pessoas diferentes, podendo estar
 * logadas ao mesmo tempo no mesmo navegador.
 *
 * Não há `pode()`: o cliente carrega uma permissão só, `portal.acessar`. Todo
 * recorte do que ele enxerga é feito no servidor, pelo domínio e pelo RLS —
 * não por uma lista de permissões que a tela consultaria.
 */
interface ValorSessaoPortal {
  readonly cliente: UsuarioSessao | null;
  readonly restaurando: boolean;
  readonly entrar: (email: string, senha: string) => Promise<void>;
  readonly sair: () => Promise<void>;
}

const Contexto = createContext<ValorSessaoPortal | null>(null);

export function ProvedorSessaoPortal({ children }: { readonly children: ReactNode }) {
  const [cliente, setCliente] = useState<UsuarioSessao | null>(null);
  const [restaurando, setRestaurando] = useState(true);
  const fila = useQueryClient();

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      const sessao = await api.portal.restaurar();
      if (cancelado) return;
      if (sessao) setCliente(sessao.usuario);
      setRestaurando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  /**
   * Mesmo motivo do provedor da equipe: a chave de consulta descreve o filtro,
   * não quem perguntou. Aqui é pior — o catálogo e o preço dependem da tabela
   * do cliente, então o cache do anterior mostraria ao seguinte os preços que
   * não são dele.
   */
  const esvaziarCache = useCallback(() => {
    fila.clear();
  }, [fila]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      esvaziarCache();
      const sessao = await api.portal.entrar(email, senha);
      setCliente(sessao.usuario);
    },
    [esvaziarCache],
  );

  const sair = useCallback(async () => {
    try {
      await api.portal.sair();
    } finally {
      setCliente(null);
      esvaziarCache();
    }
  }, [esvaziarCache]);

  const valor = useMemo<ValorSessaoPortal>(
    () => ({ cliente, restaurando, entrar, sair }),
    [cliente, restaurando, entrar, sair],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessaoPortal(): ValorSessaoPortal {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error('useSessaoPortal precisa estar dentro de <ProvedorSessaoPortal>.');
  }
  return valor;
}
