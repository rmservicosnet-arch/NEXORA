import type { ErroApi, Sessao } from '@estoque/contracts';
/**
 * O token de acesso vive em memória, não em `localStorage`.
 *
 * `localStorage` é legível por qualquer script da página: um XSS entrega a
 * sessão inteira. Em memória, o token morre ao recarregar — e é aí que o
 * refresh em cookie httpOnly entra, restaurando a sessão sem nunca ter
 * ficado exposto ao JavaScript.
 */
/**
 * Equipe e cliente são domínios de autenticação DIFERENTES (ADR-009): tabelas,
 * rotas, segredos e cookies separados. Um token só serviria para um deles, e
 * guardar os dois no mesmo lugar faria entrar no portal derrubar o token da
 * equipe — no mesmo navegador, na mesma aba.
 */
export type Dominio = 'equipe' | 'portal';
export declare function definirToken(token: string | null, dominio?: Dominio): void;
export declare function tokenAtual(dominio?: Dominio): string | null;
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
    /** O portal do cliente. Sessão própria, cookie próprio, token próprio. */
    portal: {
        entrar: (email: string, senha: string) => Promise<Sessao>;
        restaurar: () => Promise<Sessao | null>;
        sair: () => Promise<void>;
    };
    entrar: (email: string, senha: string) => Promise<Sessao>;
    restaurar: () => Promise<Sessao | null>;
    sair: () => Promise<void>;
};
export {};
//# sourceMappingURL=cliente.d.ts.map