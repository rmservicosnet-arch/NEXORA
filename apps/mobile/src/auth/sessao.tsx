import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { aoSairSozinho, sessao as api, type UsuarioDaSessao } from '../api/cliente';

/**
 * Quem está usando o aplicativo.
 *
 * Igual ao provedor do web em intenção e diferente em dois pontos:
 *
 * - **A sessão sobrevive ao fechamento.** No navegador o token morre ao
 *   recarregar e o cookie o traz de volta; aqui o refresh está no Keystore.
 *   Um vendedor não digita senha a cada vez que troca de aplicativo.
 * - **`pode()` decide o que aparece, e só isso.** Toda ação é revalidada no
 *   servidor. Esconder botão é cortesia — não oferecer caminho que vai
 *   falhar —, nunca segurança.
 */
interface ValorSessao {
  readonly usuario: UsuarioDaSessao | null;
  readonly restaurando: boolean;
  readonly entrar: (email: string, senha: string) => Promise<void>;
  readonly sair: () => Promise<void>;
  readonly pode: (permissao: string) => boolean;
  /**
   * Alguma das permissões. O PDV precisa de `venda.criar`; a conferência de
   * pedido, de `pedido.confirmar`. Quem não tem nenhuma das duas não tem o
   * que fazer neste aplicativo.
   */
  readonly podeAlguma: (permissoes: readonly string[]) => boolean;
}

const Contexto = createContext<ValorSessao | null>(null);

export function ProvedorSessao({ children }: { readonly children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioDaSessao | null>(null);
  const [restaurando, setRestaurando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    // Quando o servidor recusa o refresh, o cliente avisa e a tela volta
    // para o login — sem isto, a pessoa ficaria numa tela que só dá erro.
    aoSairSozinho(() => {
      if (!cancelado) setUsuario(null);
    });

    void (async () => {
      const restaurado = await api.restaurar();
      if (cancelado) return;
      setUsuario(restaurado);
      setRestaurando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    setUsuario(await api.entrar(email, senha));
  }, []);

  const sair = useCallback(async () => {
    try {
      await api.sair();
    } finally {
      setUsuario(null);
    }
  }, []);

  const permissoes = useMemo(() => new Set(usuario?.permissoes ?? []), [usuario]);

  const pode = useCallback((permissao: string) => permissoes.has(permissao), [permissoes]);

  const podeAlguma = useCallback(
    (lista: readonly string[]) => lista.some((p) => permissoes.has(p)),
    [permissoes],
  );

  const valor = useMemo<ValorSessao>(
    () => ({ usuario, restaurando, entrar, sair, pode, podeAlguma }),
    [usuario, restaurando, entrar, sair, pode, podeAlguma],
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
