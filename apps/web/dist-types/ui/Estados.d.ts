import type { ReactNode } from 'react';
/**
 * Estados vazio, carregando e de erro.
 *
 * São telas projetadas, não `null`. Uma lista vazia sem explicação deixa o
 * operador sem saber se não há dados, se o filtro está errado ou se a
 * aplicação quebrou. DESIGN_SYSTEM.md §1.
 */
interface EstadoBase {
    readonly titulo: string;
    readonly descricao?: string;
    readonly acao?: ReactNode;
}
export declare function EstadoVazio({ titulo, descricao, acao }: EstadoBase): import("react").JSX.Element;
export declare function EstadoCarregando({ titulo }: {
    readonly titulo?: string;
}): import("react").JSX.Element;
export declare function EstadoErro({ titulo, descricao, aoTentarNovamente, }: EstadoBase & {
    readonly aoTentarNovamente?: () => void;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=Estados.d.ts.map