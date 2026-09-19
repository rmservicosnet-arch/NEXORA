import { deflateSync } from 'node:zlib';

/**
 * Gera um PNG válido de verdade.
 *
 * Um cabeçalho montado à mão bastaria para o parser de `@estoque/core` — e é
 * assim que ele é testado lá, unitariamente. Aqui não serve: o teste de ponta
 * a ponta grava o arquivo, lê de volta e calcula hash. Se o conteúdo não for
 * um PNG de verdade, o teste passa a provar menos do que parece.
 */

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const byte of dados) {
    c = (TABELA_CRC[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);

  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));

  return Buffer.concat([tamanho, corpo, crc]);
}

/** PNG em tons de cinza, de cor sólida. */
export function pngSolido(largura: number, altura: number, tom = 0x8a): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por amostra
  ihdr[9] = 0; // tons de cinza
  ihdr[10] = 0; // compressão deflate
  ihdr[11] = 0; // filtro padrão
  ihdr[12] = 0; // sem entrelaçamento

  // Cada linha começa com o byte de filtro (0 = nenhum).
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(largura, tom)]);
  const bruto = Buffer.concat(new Array<Buffer>(altura).fill(linha));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
