/**
 * Leitura de imagem pelos bytes.
 *
 * `Content-Type` e extensão são declarados por quem envia — não são prova de
 * nada. Um `.png` pode ser um executável, e um navegador honesto pode errar o
 * MIME. Aqui o formato e as dimensões saem do **conteúdo**, lendo o cabeçalho
 * do arquivo. docs/MEDIA.md §4.
 *
 * Sem dependência externa de propósito: são três formatos e cabeçalhos
 * estáveis há décadas. Trazer uma biblioteca de processamento de imagem para
 * ler dois inteiros custaria mais do que resolve.
 */

export type TipoImagem = 'image/jpeg' | 'image/png' | 'image/webp';

/** O que a API aceita. docs/MEDIA.md §6. */
export const TIPOS_IMAGEM_ACEITOS: readonly TipoImagem[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** 10 MB. docs/MEDIA.md §4. */
export const LIMITE_BYTES_IMAGEM = 10 * 1024 * 1024;

/** Abaixo disso o catálogo fica ruim no celular. docs/MEDIA.md §6. */
export const LADO_MINIMO_IMAGEM = 800;

export interface Imagem {
  readonly tipo: TipoImagem;
  readonly largura: number;
  readonly altura: number;
}

export class ImagemInvalidaError extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'ImagemInvalidaError';
    this.codigo = codigo;
  }
}

function ehPng(b: Uint8Array): boolean {
  return (
    b.length >= 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

function ehJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function ehWebp(b: Uint8Array): boolean {
  return (
    b.length >= 16 &&
    texto(b, 0, 4) === 'RIFF' &&
    texto(b, 8, 4) === 'WEBP'
  );
}

function texto(b: Uint8Array, inicio: number, tamanho: number): string {
  let s = '';
  for (let i = inicio; i < inicio + tamanho && i < b.length; i += 1) {
    s += String.fromCharCode(b[i] as number);
  }
  return s;
}

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] as number) << 8) | (b[i + 1] as number);
}

function u32be(b: Uint8Array, i: number): number {
  return (
    ((b[i] as number) << 24) |
    ((b[i + 1] as number) << 16) |
    ((b[i + 2] as number) << 8) |
    (b[i + 3] as number)
  ) >>> 0;
}

function u24le(b: Uint8Array, i: number): number {
  return (b[i] as number) | ((b[i + 1] as number) << 8) | ((b[i + 2] as number) << 16);
}

function dimensoesPng(b: Uint8Array): { largura: number; altura: number } {
  // O IHDR é obrigatoriamente o primeiro chunk: 8 bytes de assinatura,
  // 4 de tamanho, 4 do tipo "IHDR", então largura e altura.
  if (texto(b, 12, 4) !== 'IHDR') {
    throw new ImagemInvalidaError('IMAGEM_CORROMPIDA', 'PNG sem cabeçalho IHDR.');
  }
  return { largura: u32be(b, 16), altura: u32be(b, 20) };
}

/** Marcadores SOF (Start Of Frame). Os demais 0xC_ não carregam dimensão. */
const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function dimensoesJpeg(b: Uint8Array): { largura: number; altura: number } {
  let i = 2;

  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }

    const marcador = b[i + 1] as number;

    // Preenchimento (0xFF repetido) e marcadores sem carga útil.
    if (marcador === 0xff || marcador === 0xd8 || (marcador >= 0xd0 && marcador <= 0xd9)) {
      i += 2;
      continue;
    }

    const tamanho = u16be(b, i + 2);

    if (SOF.has(marcador)) {
      return { altura: u16be(b, i + 5), largura: u16be(b, i + 7) };
    }

    if (tamanho < 2) {
      break;
    }
    i += 2 + tamanho;
  }

  throw new ImagemInvalidaError('IMAGEM_CORROMPIDA', 'JPEG sem marcador de dimensão.');
}

function dimensoesWebp(b: Uint8Array): { largura: number; altura: number } {
  const chunk = texto(b, 12, 4);

  // Estendido: as dimensões da tela ficam no próprio VP8X.
  if (chunk === 'VP8X' && b.length >= 30) {
    return { largura: u24le(b, 24) + 1, altura: u24le(b, 27) + 1 };
  }

  // Com perdas.
  if (chunk === 'VP8 ' && b.length >= 30) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      throw new ImagemInvalidaError('IMAGEM_CORROMPIDA', 'WebP VP8 sem assinatura de quadro.');
    }
    const largura = ((b[27] as number) << 8) | (b[26] as number);
    const altura = ((b[29] as number) << 8) | (b[28] as number);
    return { largura: largura & 0x3fff, altura: altura & 0x3fff };
  }

  // Sem perdas: as dimensões vêm empacotadas em bits, não em bytes.
  if (chunk === 'VP8L' && b.length >= 25) {
    if (b[20] !== 0x2f) {
      throw new ImagemInvalidaError('IMAGEM_CORROMPIDA', 'WebP VP8L sem assinatura.');
    }
    const b0 = b[21] as number;
    const b1 = b[22] as number;
    const b2 = b[23] as number;
    const b3 = b[24] as number;

    return {
      largura: (b0 | ((b1 & 0x3f) << 8)) + 1,
      altura: (((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) & 0x3fff) + 1,
    };
  }

  throw new ImagemInvalidaError('IMAGEM_CORROMPIDA', `WebP com chunk inesperado: ${chunk}.`);
}

/**
 * Identifica formato e dimensões a partir dos bytes.
 *
 * Lança `ImagemInvalidaError` se o conteúdo não for uma das três imagens
 * aceitas. Não consulta nome de arquivo nem `Content-Type`.
 */
export function lerImagem(bytes: Uint8Array): Imagem {
  if (ehPng(bytes)) {
    return { tipo: 'image/png', ...dimensoesPng(bytes) };
  }
  if (ehJpeg(bytes)) {
    return { tipo: 'image/jpeg', ...dimensoesJpeg(bytes) };
  }
  if (ehWebp(bytes)) {
    return { tipo: 'image/webp', ...dimensoesWebp(bytes) };
  }

  throw new ImagemInvalidaError(
    'TIPO_NAO_ACEITO',
    'O arquivo enviado não é JPEG, PNG nem WebP.',
  );
}

/**
 * Confere o que o operador precisa saber antes de publicar o catálogo.
 *
 * Separado de `lerImagem` porque são perguntas diferentes: uma é "isto é uma
 * imagem?", a outra é "esta imagem serve para o catálogo?". A segunda pode
 * afrouxar por configuração da empresa um dia; a primeira, nunca.
 */
export function conferirImagemDeCatalogo(imagem: Imagem, bytes: number): void {
  if (bytes > LIMITE_BYTES_IMAGEM) {
    throw new ImagemInvalidaError(
      'IMAGEM_GRANDE_DEMAIS',
      `A imagem tem ${(bytes / 1024 / 1024).toFixed(1)} MB. O limite é 10 MB.`,
    );
  }

  const menorLado = Math.min(imagem.largura, imagem.altura);

  if (menorLado < LADO_MINIMO_IMAGEM) {
    throw new ImagemInvalidaError(
      'IMAGEM_PEQUENA',
      `A imagem tem ${imagem.largura}×${imagem.altura} px. O mínimo é ${LADO_MINIMO_IMAGEM}×${LADO_MINIMO_IMAGEM}.`,
    );
  }
}
