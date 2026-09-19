import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Armazenamento, type DestinoDeEnvio, type OpcoesDeEnvio } from './armazenamento';

export class ChaveForaDaRaizError extends Error {
  readonly codigo = 'CHAVE_INVALIDA';

  constructor(chave: string) {
    super(`A chave "${chave}" sai do diretório de armazenamento.`);
    this.name = 'ChaveForaDaRaizError';
  }
}

export class AutorizacaoDeEnvioInvalidaError extends Error {
  readonly codigo = 'ENVIO_NAO_AUTORIZADO';

  constructor(motivo: string) {
    super(motivo);
    this.name = 'AutorizacaoDeEnvioInvalidaError';
  }
}

interface Autorizacao {
  readonly chave: string;
  readonly tipo: string;
  readonly bytes: number;
  /** Epoch em segundos. */
  readonly expira: number;
}

/**
 * Armazenamento em disco.
 *
 * A "URL pré-assinada" é uma rota desta API carregando um bilhete assinado com
 * HMAC. O bilhete diz **qual chave**, **qual tipo** e **quantos bytes** — e
 * quem faz o PUT não consegue mudar nada disso sem invalidar a assinatura.
 *
 * É o mesmo raciocínio do S3: o crédito para escrever é dado por quem tem
 * autoridade, não por quem envia.
 */
@Injectable()
export class ArmazenamentoLocal extends Armazenamento {
  private readonly log = new Logger(ArmazenamentoLocal.name);
  private readonly raiz: string;
  private readonly segredo: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    super();

    this.raiz = resolve(config.get<string>('STORAGE_LOCAL_PATH') ?? './.storage');

    // O bilhete de envio autoriza escrita. Assiná-lo com o segredo de
    // funcionário manteria dois usos muito diferentes na mesma chave: quem
    // conseguisse forjar um dos dois teria o outro de graça.
    this.segredo = createHmac('sha256', config.getOrThrow<string>('JWT_FUNCIONARIO_SECRET'))
      .update('armazenamento-local')
      .digest('hex');

    // `API_PUBLIC_URL` é o endereço pelo qual o CLIENTE alcança a API, e
    // aceita caminho relativo (`/api`) quando a web e a API saem pela mesma
    // origem. O fallback com `localhost` só serve para desenvolvimento: em
    // contêiner, `localhost` é o próprio contêiner e o navegador não chega.
    const publico = config.get<string>('API_PUBLIC_URL');
    const porta = config.get<string>('API_PORT') ?? '3333';
    const prefixo = config.get<string>('API_PREFIX') ?? 'api';

    this.baseUrl = (publico ?? `http://localhost:${porta}/${prefixo}`).replace(/\/+$/, '');

    this.log.log(`Armazenamento local em ${this.raiz}`);
  }

  async destinoDeEnvio(opcoes: OpcoesDeEnvio): Promise<DestinoDeEnvio> {
    const expira = Math.floor(Date.now() / 1000) + opcoes.validadeSegundos;

    const autorizacao: Autorizacao = {
      chave: opcoes.chave,
      tipo: opcoes.tipo,
      bytes: opcoes.bytes,
      expira,
    };

    const bilhete = this.assinar(autorizacao);

    return {
      url: `${this.baseUrl}/midia/enviar?bilhete=${encodeURIComponent(bilhete)}`,
      metodo: 'PUT',
      cabecalhos: { 'Content-Type': opcoes.tipo },
      expiraEm: new Date(expira * 1000).toISOString(),
    };
  }

  async gravar(chave: string, conteudo: Uint8Array, _tipo: string): Promise<void> {
    const caminho = this.caminhoDe(chave);
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, conteudo);
  }

  async ler(chave: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.caminhoDe(chave)));
  }

  async existe(chave: string): Promise<boolean> {
    try {
      await stat(this.caminhoDe(chave));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Confere o bilhete e devolve o que ele autoriza.
   *
   * Usado pela rota de envio, que é pública — a autenticação dela é o bilhete.
   */
  conferirBilhete(bilhete: string): Autorizacao {
    const partes = bilhete.split('.');

    if (partes.length !== 2) {
      throw new AutorizacaoDeEnvioInvalidaError('Bilhete de envio malformado.');
    }

    const [corpo, assinatura] = partes as [string, string];
    const esperada = this.hmac(corpo);

    const a = Buffer.from(assinatura);
    const b = Buffer.from(esperada);

    // Comparação em tempo constante: comparar com `===` vaza, pelo tempo, o
    // tamanho do prefixo correto — e um atacante descobre a assinatura byte a
    // byte.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AutorizacaoDeEnvioInvalidaError('Assinatura do bilhete não confere.');
    }

    const autorizacao = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Autorizacao;

    if (autorizacao.expira * 1000 < Date.now()) {
      throw new AutorizacaoDeEnvioInvalidaError('A autorização de envio expirou.');
    }

    return autorizacao;
  }

  private assinar(autorizacao: Autorizacao): string {
    const corpo = Buffer.from(JSON.stringify(autorizacao)).toString('base64url');
    return `${corpo}.${this.hmac(corpo)}`;
  }

  private hmac(corpo: string): string {
    return createHmac('sha256', this.segredo).update(corpo).digest('base64url');
  }

  /**
   * Resolve a chave para um caminho DENTRO da raiz.
   *
   * A chave é montada pelo servidor, mas esta função é a última barreira: uma
   * chave com `..` viraria escrita em qualquer lugar do disco.
   */
  private caminhoDe(chave: string): string {
    const caminho = resolve(join(this.raiz, normalize(chave)));

    if (caminho !== this.raiz && !caminho.startsWith(this.raiz + sep)) {
      throw new ChaveForaDaRaizError(chave);
    }

    return caminho;
  }
}
