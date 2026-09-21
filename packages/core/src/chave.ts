/**
 * Chave legível a partir de um nome.
 *
 * "Revendedor Atacado" → REVENDEDOR_ATACADO. Acentos caem, porque a chave é
 * identificador: vai aparecer em log, em `where` e em conversa de suporte.
 *
 * Estava escrita três vezes — tabela de preço, loja e perfil —, e duas delas
 * tinham o intervalo de acentos gravado como CARACTERES COMBINANTES LITERAIS
 * no fonte. Bytes invisíveis que somem em qualquer cópia e não dão erro:
 * `chaveDe('Ação')` devolveria `A_AO` num arquivo e `ACAO` no outro.
 *
 * `\p{Diacritic}` com a bandeira `u` diz a mesma coisa em ASCII puro, e não
 * há o que se perder ao copiar.
 */
export function chaveDe(nome: string, tamanho = 40): string {
  return nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, tamanho);
}
