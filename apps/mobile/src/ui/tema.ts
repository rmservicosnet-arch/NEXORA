/**
 * As mesmas cores do canvas e do web.
 *
 * Copiadas como constantes porque o aplicativo não tem CSS: React Native não
 * lê as variáveis de `:root`. A cópia é o preço de não haver WebView — e é
 * por isso que ela mora num arquivo só, com os nomes do desenho.
 */
export const cor = {
  tinta: '#1A1917',
  texto: '#3B3732',
  apagado: '#6E6860',
  fraco: '#938D83',

  fundo: '#FAF9F7',
  papel: '#FFFFFF',
  linha: '#E9E6E1',
  linhaFraca: '#F4F2EF',
  borda: '#D9D5CE',

  /** O azul da marca. O topo do aplicativo usa o escuro. */
  marca: '#33408C',
  marcaClara: '#43529F',
  marcaEscura: '#2A3573',
  marcaTopo: '#222B5C',
  marcaFundo: '#EEF0FA',
  marcaBorda: '#C8CFEC',
  marcaApagada: '#8B98D4',
  marcaTexto: '#DCE0F3',

  bom: '#1B6E46',
  bomEscuro: '#155537',
  bomFundo: '#E6F1EB',

  perigo: '#A81F27',
  perigoFundo: '#FDF5F5',
  perigoBorda: '#F0C9CB',
  perigoForte: '#FAE8E8',

  atencao: '#8F6206',
  atencaoFundo: '#FEFBF3',
  atencaoBorda: '#EBD6A8',
  atencaoForte: '#FBF0DA',

  /** O fundo da câmera, quando ela ainda não abriu. */
  lente: '#1A1917',
} as const;

/**
 * Alvos de toque.
 *
 * 44 é o mínimo que a mão alcança sem erro — e este aplicativo é usado em pé,
 * no balcão, com uma das mãos segurando a mercadoria.
 */
export const TOQUE_MINIMO = 44;

export const espaco = {
  xs: 4,
  s: 8,
  m: 12,
  g: 16,
  gg: 22,
} as const;

export const raio = {
  s: 6,
  m: 8,
  g: 10,
  pilula: 999,
} as const;

/**
 * Tamanhos de texto.
 *
 * `mono` é para número: a fonte monoespaçada com `tabular-nums` mantém a
 * coluna de valores alinhada enquanto o total muda a cada leitura.
 */
export const fonte = {
  titulo: 18,
  subtitulo: 15,
  corpo: 13.5,
  apoio: 12.5,
  miudo: 11.5,
  numero: 14,
  numeroGrande: 30,
} as const;
