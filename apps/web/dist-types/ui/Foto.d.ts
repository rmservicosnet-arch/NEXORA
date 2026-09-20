/**
 * Imagem servida pela API autenticada.
 *
 * O binário vem por `fetch` com o token e vira um `blob:` local. Trocar isso
 * por `<img src="/api/midia/…">` exigiria abrir a rota — e o id da foto
 * passaria a ser a única coisa entre um estranho e o catálogo da loja.
 */
export declare function Foto({ imagemId, alt, className, raiz, seFalhar, }: {
    readonly imagemId: string;
    readonly alt: string;
    readonly className?: string;
    /**
     * A rota que serve os bytes. O portal do cliente usa `/portal/midia`: outro
     * domínio de autenticação, outro token, e um recorte a menos — o cliente só
     * alcança imagem de produto publicado.
     */
    readonly raiz?: '/midia' | '/portal/midia';
    /**
     * O que desenhar quando os bytes não vierem.
     *
     * Sem isto, a falha aparece em vermelho — e é assim que deve ser nas telas
     * da equipe: foto quebrada é problema dela, e silêncio seria pior. No
     * catálogo do CLIENTE a mesma caixa vira uma parede de erros numa loja, por
     * um defeito que não é dele; ali o item apenas não tem foto para mostrar.
     */
    readonly seFalhar?: React.ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=Foto.d.ts.map