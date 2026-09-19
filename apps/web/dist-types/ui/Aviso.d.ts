import type { ReactNode } from 'react';
export type TomAviso = 'info' | 'sucesso' | 'atencao' | 'perigo';
export interface AvisoProps {
    readonly tom?: TomAviso;
    readonly titulo?: string;
    readonly children: ReactNode;
    readonly className?: string;
}
/**
 * Mensagem com tom.
 *
 * Sempre com ícone, nunca só cor: monitor de PDV costuma ser ruim, e parte
 * das pessoas não distingue vermelho de verde. DESIGN_SYSTEM.md §3.
 */
export declare function Aviso({ tom, titulo, children, className }: AvisoProps): import("react").JSX.Element;
//# sourceMappingURL=Aviso.d.ts.map