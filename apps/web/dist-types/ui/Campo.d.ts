import { type InputHTMLAttributes, type ReactNode } from 'react';
export interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
    readonly rotulo: string;
    /**
     * Mensagem de erro.
     *
     * **Sempre textual.** Borda vermelha sozinha não comunica nada a quem não
     * distingue as cores — e nem a quem está com pressa. DESIGN_SYSTEM.md §8.
     */
    readonly erro?: string;
    readonly ajuda?: string;
    readonly acessorio?: ReactNode;
}
export declare function Campo({ rotulo, erro, ajuda, acessorio, className, ...resto }: CampoProps): import("react").JSX.Element;
//# sourceMappingURL=Campo.d.ts.map