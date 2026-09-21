import type { AdminPlataforma } from '@estoque/contracts';
import { type ReactNode } from 'react';
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
export declare function ProvedorSessaoPlataforma({ children }: {
    readonly children: ReactNode;
}): import("react").JSX.Element;
export declare function useSessaoPlataforma(): ValorSessaoPlataforma;
export {};
//# sourceMappingURL=sessaoPlataforma.d.ts.map