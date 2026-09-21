import type { ErroApi, Sessao, SessaoPlataformaResposta } from '@estoque/contracts';
/**
 * O token de acesso vive em memória, não em `localStorage`.
 *
 * `localStorage` é legível por qualquer script da página: um XSS entrega a
 * sessão inteira. Em memória, o token morre ao recarregar — e é aí que o
 * refresh em cookie httpOnly entra, restaurando a sessão sem nunca ter
 * ficado exposto ao JavaScript.
 */
/**
 * Equipe, cliente e plataforma são domínios de autenticação DIFERENTES
 * (ADR-009, ADR-011): tabelas, rotas, segredos e cookies separados. Um token
 * só serviria para um deles, e guardar os três no mesmo lugar faria entrar
 * num derrubar a sessão do outro — no mesmo navegador, na mesma aba.
 *
 * O terceiro é o da plataforma, e ele não tem empresa: o token dele não
 * carrega `tid`, e por isso nenhuma rota de empresa o aceita.
 */
export type Dominio = 'equipe' | 'portal' | 'plataforma';
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
        entrar: (email: string, senha: string, manterConectado?: boolean) => Promise<Sessao>;
        restaurar: () => Promise<Sessao | null>;
        sair: () => Promise<void>;
    };
    /** A plataforma. Não tem empresa, e é isso que a separa das outras duas. */
    plataforma: {
        entrar: (email: string, senha: string) => Promise<SessaoPlataformaResposta>;
        restaurar: () => Promise<SessaoPlataformaResposta | null>;
        sair: () => Promise<void>;
    };
    entrar: (email: string, senha: string, manterConectado?: boolean) => Promise<Sessao>;
    restaurar: () => Promise<Sessao | null>;
    sair: () => Promise<void>;
};
export {};
//# sourceMappingURL=cliente.d.ts.map