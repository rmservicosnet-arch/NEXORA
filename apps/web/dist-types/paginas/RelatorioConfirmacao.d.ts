/**
 * Taxa de confirmação.
 *
 * A taxa se mede sobre os pedidos DECIDIDOS, não sobre os enviados: um pedido
 * que chegou há dez minutos e ainda está na fila não é fracasso, é pendência.
 * Contá-lo como não confirmado faria a taxa piorar sozinha toda vez que a
 * loja recebesse pedido.
 */
export declare function RelatorioConfirmacaoTela(): import("react").JSX.Element;
//# sourceMappingURL=RelatorioConfirmacao.d.ts.map