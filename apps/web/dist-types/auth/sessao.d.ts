import { type UsuarioSessao } from '@estoque/contracts';
import { type ReactNode } from 'react';
interface ValorSessao {
    readonly usuario: UsuarioSessao | null;
    readonly restaurando: boolean;
    readonly entrar: (email: string, senha: string, manterConectado?: boolean) => Promise<void>;
    readonly sair: () => Promise<void>;
    /** Tem TODAS as permissões pedidas. */
    readonly pode: (...permissoes: readonly string[]) => boolean;
}
export declare function ProvedorSessao({ children }: {
    readonly children: ReactNode;
}): import("react").JSX.Element;
export declare function useSessao(): ValorSessao;
/**
 * Esconde o que o usuário não pode acionar.
 *
 * **Cortesia de UX, não segurança.** Toda ação que isto protege é
 * revalidada no servidor — o guard de permissões da API é quem decide. Este
 * componente existe para não oferecer um caminho que vai falhar.
 * DESIGN_SYSTEM.md §8.
 */
export declare function SePode({ permissoes, children, alternativa, }: {
    readonly permissoes: readonly string[];
    readonly children: ReactNode;
    readonly alternativa?: ReactNode;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=sessao.d.ts.map