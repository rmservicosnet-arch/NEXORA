/**
 * Os preços do produto em cada tabela.
 *
 * A API existia desde a fatia do portal e nenhuma tela a usava — o mesmo
 * defeito de `cliente.tabelaPrecoId`: o sistema lia um dado que ninguém
 * conseguia gravar. Sem preço na tabela do cliente, o item simplesmente não
 * existe para ele: o catálogo o omite, não mostra "consulte".
 */
export declare function PrecosDoProduto({ produtoId }: {
    readonly produtoId: string;
}): import("react").JSX.Element | null;
//# sourceMappingURL=PrecosDoProduto.d.ts.map