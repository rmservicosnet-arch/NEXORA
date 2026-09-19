import { temPermissao, type UsuarioSessao } from '@estoque/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, definirToken } from '../api/cliente';

interface ValorSessao {
  readonly usuario: UsuarioSessao | null;
  readonly restaurando: boolean;
  readonly entrar: (email: string, senha: string) => Promise<void>;
  readonly sair: () => Promise<void>;
  /** Tem TODAS as permissões pedidas. */
  readonly pode: (...permissoes: readonly string[]) => boolean;
}

const Contexto = createContext<ValorSessao | null>(null);

export function ProvedorSessao({ children }: { readonly children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [restaurando, setRestaurando] = useState(true);

  // Ao abrir a aplicação o token de acesso não existe — ele vive em memória
  // e morreu no recarregamento. O cookie de refresh sobreviveu, então a
  // sessão é restaurada a partir dele.
  useEffect(() => {
    let cancelado = false;

    void (async () => {
      const sessao = await api.restaurar();
      if (cancelado) {
        return;
      }
      if (sessao) {
        definirToken(sessao.tokenAcesso);
        setUsuario(sessao.usuario);
      }
      setRestaurando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    const sessao = await api.entrar(email, senha);
    definirToken(sessao.tokenAcesso);
    setUsuario(sessao.usuario);
  }, []);

  const sair = useCallback(async () => {
    await api.sair();
    setUsuario(null);
  }, []);

  const permissoes = useMemo(() => new Set(usuario?.permissoes ?? []), [usuario]);

  const pode = useCallback(
    (...exigidas: readonly string[]) => temPermissao(permissoes, ...exigidas),
    [permissoes],
  );

  const valor = useMemo<ValorSessao>(
    () => ({ usuario, restaurando, entrar, sair, pode }),
    [usuario, restaurando, entrar, sair, pode],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error('useSessao precisa estar dentro de <ProvedorSessao>.');
  }
  return valor;
}

/**
 * Esconde o que o usuário não pode acionar.
 *
 * **Cortesia de UX, não segurança.** Toda ação que isto protege é
 * revalidada no servidor — o guard de permissões da API é quem decide. Este
 * componente existe para não oferecer um caminho que vai falhar.
 * DESIGN_SYSTEM.md §8.
 */
export function SePode({
  permissoes,
  children,
  alternativa = null,
}: {
  readonly permissoes: readonly string[];
  readonly children: ReactNode;
  readonly alternativa?: ReactNode;
}) {
  const { pode } = useSessao();
  return <>{pode(...permissoes) ? children : alternativa}</>;
}
