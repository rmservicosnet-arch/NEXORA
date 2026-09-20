/** Valor em reais, sempre em módulo — o sinal é decisão de quem exibe. */
export declare function brl(v: string | number): string;
export declare function dataHora(iso: string): string;
/** Períodos oferecidos. Os mesmos em todo relatório que olha para trás. */
export declare const PERIODOS: readonly [7, 15, 30, 60, 90, 180, 365];
export declare function rotuloPeriodo(dias: number): string;
/** Filtro no alto: rótulo à esquerda, escolha em destaque. */
export declare function Filtro({ rotulo, children, }: {
    readonly rotulo: string;
    readonly children: React.ReactNode;
}): import("react").JSX.Element;
export declare function Selecao({ rotulo, valor, aoMudar, children, }: {
    readonly rotulo: string;
    readonly valor: string;
    readonly aoMudar: (v: string) => void;
    readonly children: React.ReactNode;
}): import("react").JSX.Element;
export declare function Indicador({ rotulo, valor, nota, tom, aoClicar, }: {
    readonly rotulo: string;
    readonly valor: string;
    readonly nota: string;
    readonly tom?: 'normal' | 'atencao' | 'perigo' | 'sucesso';
    readonly aoClicar?: () => void;
}): import("react").JSX.Element;
export declare function Cadeado(): import("react").JSX.Element;
/** Cabeçalho comum: caminho de volta, aviso de custo e exportação. */
export declare function CabecalhoRelatorio({ titulo, comCusto, aoExportar, podeExportar, }: {
    readonly titulo: string;
    readonly comCusto: boolean;
    readonly aoExportar: () => void;
    readonly podeExportar: boolean;
}): import("react").JSX.Element;
/**
 * CSV separado por ponto e vírgula, com marca UTF-8.
 *
 * Sem a marca o Excel em português abre "Camiseta Algodão" como "AlgodÃ£o", e
 * quem exporta conclui que o sistema gravou errado.
 */
export declare function baixarCsv(nome: string, colunas: string[], linhas: (string | number)[][]): void;
/** Painel branco que rola por dentro — a página inteira nunca rola. */
export declare function Painel({ children }: {
    readonly children: React.ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=relatorio-pecas.d.ts.map