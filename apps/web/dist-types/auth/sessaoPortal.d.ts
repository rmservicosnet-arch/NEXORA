import type { UsuarioSessao } from '@estoque/contracts';
import { type ReactNode } from 'react';
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
export declare function ProvedorSessaoPortal({ children }: {
    readonly children: ReactNode;
}): import("react").JSX.Element;
export declare function useSessaoPortal(): ValorSessaoPortal;
export {};
//# sourceMappingURL=sessaoPortal.d.ts.map