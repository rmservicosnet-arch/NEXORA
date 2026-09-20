/**
 * Um módulo que o menu prevê e que ainda não existe.
 *
 * O menu é o mapa do sistema: tirar "Compras" e "Contas" dele faria o mapa
 * mentir por omissão. Mas levar a uma tela montada com dados inventados
 * mentiria pior. Esta página diz o que falta e para onde ir enquanto isso.
 */
export declare function ModuloPendente({ titulo, oQueFaz, ondeEstaHoje, }: {
    readonly titulo: string;
    readonly oQueFaz: string;
    readonly ondeEstaHoje: {
        readonly texto: string;
        readonly para: string;
    } | null;
}): import("react").JSX.Element;
//# sourceMappingURL=ModuloPendente.d.ts.map