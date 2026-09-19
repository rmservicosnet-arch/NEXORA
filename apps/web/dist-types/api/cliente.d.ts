import type { ErroApi, Sessao } from '@estoque/contracts';
export declare function definirToken(token: string | null): void;
export declare function tokenAtual(): string | null;
export declare class ErroRequisicao extends Error {
    readonly status: number;
    readonly corpo: ErroApi;
    constructor(status: number, corpo: ErroApi);
    get codigo(): string;
}
interface Opcoes extends Omit<RequestInit, 'body'> {
    readonly body?: unknown;
    /** Evita laço infinito de renovação. */
    readonly semRenovar?: boolean;
}
export declare function pedir<T>(caminho: string, opcoes?: Opcoes): Promise<T>;
export declare const api: {
    entrar: (email: string, senha: string) => Promise<Sessao>;
    restaurar: () => Promise<Sessao | null>;
    sair: () => Promise<void>;
};
export {};
//# sourceMappingURL=cliente.d.ts.map