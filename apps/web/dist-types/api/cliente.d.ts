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
/**
 * Busca um binário (imagem) com o token de acesso.
 *
 * `<img src="/api/midia/…">` não serve: a tag não manda cabeçalho de
 * autorização. Ou a rota de mídia viraria pública — e o id da foto viraria
 * senha —, ou o binário vem por aqui e o navegador recebe um `blob:` local.
 */
export declare function pedirBlob(caminho: string): Promise<Blob>;
/** Envia o arquivo para onde a API autorizou. Não passa pelo cliente da API. */
export declare function enviarArquivo(destino: {
    url: string;
    metodo: string;
    cabecalhos: Record<string, string>;
}, arquivo: File): Promise<void>;
export declare const api: {
    entrar: (email: string, senha: string) => Promise<Sessao>;
    restaurar: () => Promise<Sessao | null>;
    sair: () => Promise<void>;
};
export {};
//# sourceMappingURL=cliente.d.ts.map