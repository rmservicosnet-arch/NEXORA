import { describe, expect, it } from 'vitest';

import {
  ImagemInvalidaError,
  conferirImagemDeCatalogo,
  lerImagem,
  type Imagem,
} from './imagem';

// ---------------------------------------------------------------------------
// Cabeçalhos montados à mão.
//
// Não uso arquivos de exemplo: um .png de fixture prova que aquele arquivo
// funciona. Montar o cabeçalho prova que o PARSER está certo, e deixa as
// dimensões esperadas explícitas no teste.
// ---------------------------------------------------------------------------

function png(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // tamanho do IHDR
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, largura);
  new DataView(b.buffer).setUint32(20, altura);
  return b;
}

function jpeg(largura: number, altura: number, { comApp0 = true } = {}): Uint8Array {
  const partes: number[] = [0xff, 0xd8];

  if (comApp0) {
    // APP0/JFIF de 16 bytes, que o parser precisa PULAR para achar o SOF0.
    partes.push(0xff, 0xe0, 0x00, 0x10);
    partes.push(...new Array<number>(14).fill(0));
  }

  partes.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  partes.push((altura >> 8) & 0xff, altura & 0xff);
  partes.push((largura >> 8) & 0xff, largura & 0xff);
  partes.push(...new Array<number>(8).fill(0));

  return new Uint8Array(partes);
}

function webpVp8(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b.set([0x9d, 0x01, 0x2a], 23); // assinatura do quadro
  b[26] = largura & 0xff;
  b[27] = (largura >> 8) & 0x3f;
  b[28] = altura & 0xff;
  b[29] = (altura >> 8) & 0x3f;
  return b;
}

function webpVp8x(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const l = largura - 1;
  const a = altura - 1;
  b.set([l & 0xff, (l >> 8) & 0xff, (l >> 16) & 0xff], 24);
  b.set([a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff], 27);
  return b;
}

describe('identificação pelo conteúdo', () => {
  it('lê PNG', () => {
    expect(lerImagem(png(1200, 1200))).toEqual<Imagem>({
      tipo: 'image/png',
      largura: 1200,
      altura: 1200,
    });
  });

  it('lê JPEG pulando o segmento APP0', () => {
    expect(lerImagem(jpeg(1024, 768))).toEqual<Imagem>({
      tipo: 'image/jpeg',
      largura: 1024,
      altura: 768,
    });
  });

  it('lê JPEG sem APP0', () => {
    expect(lerImagem(jpeg(800, 800, { comApp0: false })).largura).toBe(800);
  });

  it('lê WebP com perdas', () => {
    expect(lerImagem(webpVp8(900, 1600))).toEqual<Imagem>({
      tipo: 'image/webp',
      largura: 900,
      altura: 1600,
    });
  });

  it('lê WebP estendido', () => {
    expect(lerImagem(webpVp8x(2400, 2400))).toEqual<Imagem>({
      tipo: 'image/webp',
      largura: 2400,
      altura: 2400,
    });
  });

  it('recusa arquivo que não é imagem, ainda que se chame foto.png', () => {
    // Um executável do Windows. O nome e o Content-Type mentiriam; os bytes não.
    const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    expect(() => lerImagem(mz)).toThrowError(ImagemInvalidaError);
    try {
      lerImagem(mz);
    } catch (erro) {
      expect((erro as ImagemInvalidaError).codigo).toBe('TIPO_NAO_ACEITO');
    }
  });

  it('recusa GIF — formato real, mas fora da lista aceita', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00]);
    expect(() => lerImagem(gif)).toThrowError(/não é JPEG, PNG nem WebP/);
  });

  it('recusa arquivo truncado', () => {
    expect(() => lerImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrowError(
      ImagemInvalidaError,
    );
  });

  it('recusa arquivo vazio', () => {
    expect(() => lerImagem(new Uint8Array(0))).toThrowError(ImagemInvalidaError);
  });
});

describe('regras de catálogo', () => {
  const quadrada: Imagem = { tipo: 'image/png', largura: 1000, altura: 1000 };

  it('aceita imagem dentro dos limites', () => {
    expect(() => conferirImagemDeCatalogo(quadrada, 2_000_000)).not.toThrow();
  });

  it('recusa acima de 10 MB', () => {
    try {
      conferirImagemDeCatalogo(quadrada, 11 * 1024 * 1024);
      expect.unreachable('deveria ter recusado');
    } catch (erro) {
      expect((erro as ImagemInvalidaError).codigo).toBe('IMAGEM_GRANDE_DEMAIS');
      expect((erro as Error).message).toContain('11.0 MB');
    }
  });

  it('aceita exatamente 10 MB — o limite é inclusivo', () => {
    expect(() => conferirImagemDeCatalogo(quadrada, 10 * 1024 * 1024)).not.toThrow();
  });

  it('recusa lado menor que 800 px', () => {
    const estreita: Imagem = { tipo: 'image/jpeg', largura: 1600, altura: 600 };

    try {
      conferirImagemDeCatalogo(estreita, 1000);
      expect.unreachable('deveria ter recusado');
    } catch (erro) {
      expect((erro as ImagemInvalidaError).codigo).toBe('IMAGEM_PEQUENA');
      // A mensagem diz o que o operador tem e o que precisa ter.
      expect((erro as Error).message).toContain('1600×600');
      expect((erro as Error).message).toContain('800×800');
    }
  });

  it('aceita exatamente 800×800', () => {
    expect(() =>
      conferirImagemDeCatalogo({ tipo: 'image/webp', largura: 800, altura: 800 }, 500),
    ).not.toThrow();
  });
});
