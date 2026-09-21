/**
 * Categorias e marcas — como o produto é classificado.
 *
 * As duas só existiam pelo seed: a API as listava e nenhuma rota as criava.
 * O cadastro de produto ganhou um botão para criar no fluxo, mas criar no
 * fluxo não dá onde VER todas, renomear e organizar — e um nome digitado
 * errado ficava preso para sempre.
 *
 * A regra das três ações está escrita no alto, antes de alguém apertar o
 * botão errado:
 *
 *   sem vínculo  → exclui
 *   com vínculo  → desativa (some das escolhas novas, não mexe no passado)
 *   desativada   → reativa
 *
 * Apagar com vínculo deixaria os produtos sem categoria, e quem olhasse
 * depois não saberia que já tiveram uma.
 *
 * **A árvore de subcategorias não aparece aqui de propósito.** A coluna
 * `pai_id` existe no banco desde o início e nada a escreve nem a lê — dar
 * uma tela a ela seria oferecer uma organização que nenhuma outra parte do
 * sistema enxerga.
 */
export declare function Classificacao(): import("react").JSX.Element;
//# sourceMappingURL=Classificacao.d.ts.map