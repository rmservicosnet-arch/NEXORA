import type { ItemCatalogo } from '@estoque/contracts';
import { type ReactNode } from 'react';
/**
 * O que o carrinho guarda de cada item.
 *
 * O preço e a disponibilidade aqui são **retrato do momento em que o item foi
 * escolhido**, para a lista não ficar muda. Nenhuma decisão se apoia neles: a
 * tela do carrinho relê os dois do servidor, e quem dá o preço final é o
 * checkout, contra a tabela do cliente. Guardar e reusar foi a armadilha que
 * já mordeu este repositório — ver a tabela do CLAUDE.md.
 */
export interface ItemCarrinho {
    readonly variacaoId: string;
    readonly sku: string;
    readonly produto: string;
    readonly descricaoVariacao: string;
    readonly imagemPrincipalId: string | null;
    readonly precoVisto: string;
    readonly quantidade: number;
}
interface ValorCarrinho {
    readonly itens: readonly ItemCarrinho[];
    readonly total: number;
    readonly adicionar: (item: ItemCatalogo, quantidade?: number) => void;
    readonly definirQuantidade: (variacaoId: string, quantidade: number) => void;
    readonly remover: (variacaoId: string) => void;
    readonly esvaziar: () => void;
}
export declare function ProvedorCarrinho({ clienteId, children, }: {
    readonly clienteId: string;
    readonly children: ReactNode;
}): import("react").JSX.Element;
export declare function useCarrinho(): ValorCarrinho;
export {};
//# sourceMappingURL=carrinho.d.ts.map