/**
 * Imagem servida pela API autenticada.
 *
 * O binário vem por `fetch` com o token e vira um `blob:` local. Trocar isso
 * por `<img src="/api/midia/…">` exigiria abrir a rota — e o id da foto
 * passaria a ser a única coisa entre um estranho e o catálogo da loja.
 */
export declare function Foto({ imagemId, alt, className, }: {
    readonly imagemId: string;
    readonly alt: string;
    readonly className?: string;
}): import("react").JSX.Element;
//# sourceMappingURL=Foto.d.ts.map