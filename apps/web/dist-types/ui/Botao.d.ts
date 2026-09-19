import type { ButtonHTMLAttributes, ReactNode } from 'react';
export type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';
export type TamanhoBotao = 'padrao' | 'pdv' | 'compacto';
export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    readonly variante?: VarianteBotao;
    readonly tamanho?: TamanhoBotao;
    readonly carregando?: boolean;
    /** Renderiza como o filho — usado para transformar um `<a>` em botão. */
    readonly comoFilho?: boolean;
    readonly children?: ReactNode;
}
export declare function Botao({ variante, tamanho, carregando, comoFilho, className, disabled, children, ...resto }: BotaoProps): import("react").JSX.Element;
//# sourceMappingURL=Botao.d.ts.map