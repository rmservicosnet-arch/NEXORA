import { type VariacaoParaMovimento } from '@estoque/contracts';
/**
 * O razão de UM item num local.
 *
 * É a tela que a proposta desenha: saldo, custo médio e valor no topo, o
 * aviso quando o saldo está negativo, e cada movimento com saldo antes →
 * depois. O encadeamento é o que permite conferir o razão de fora: se a
 * coluna deixa de encadear, alguém gravou saldo sem passar por aqui.
 */
export declare function RazaoDoItem({ variacao, localId, aoTrocarLocal, aoAjustar, aoVoltar, }: {
    readonly variacao: VariacaoParaMovimento;
    readonly localId: string;
    readonly aoTrocarLocal: (id: string) => void;
    readonly aoAjustar: () => void;
    readonly aoVoltar: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=RazaoDoItem.d.ts.map