import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AlteracaoImagem,
  AutorizacaoDeEnvio,
  ImagemProduto,
  PedidoDeEnvio,
} from '@estoque/contracts';
import { LIMITE_FOTOS_PRODUTO } from '@estoque/contracts';
import { ImagemInvalidaError, conferirImagemDeCatalogo, lerImagem } from '@estoque/core';
import {
  Prisma,
  comEscopoAtual,
  exigirContexto,
  type ClienteEmTransacao,
  type PrismaClient,
} from '@estoque/db';

import type { Principal } from '../auth/dominios';
import {
  Armazenamento,
  EXTENSAO_POR_TIPO,
  montarChave,
} from '../armazenamento/armazenamento';
import { AuditoriaService } from '../comum/auditoria.service';
import { PRISMA } from '../infra/prisma/prisma.module';

/** docs/MEDIA.md §4: a URL expira em 5 minutos. */
const VALIDADE_ENVIO_SEGUNDOS = 300;

/** O recorte da linha que vira contrato. */
interface ProdutoImagemLinha {
  id: string;
  variacaoId: string | null;
  ordem: number;
  principal: boolean;
  textoAlternativo: string;
  largura: number | null;
  altura: number | null;
  bytes: bigint | null;
  status: string;
}

@Injectable()
export class ImagensService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly armazenamento: Armazenamento,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Passo 1 — autorizar
  // -------------------------------------------------------------------------

  /**
   * Autoriza um envio e cria a linha em `PROCESSANDO`.
   *
   * A linha nasce antes do arquivo existir de propósito: é ela que reserva o
   * id que compõe a chave do objeto. Sem isso, dois envios simultâneos
   * poderiam disputar o mesmo caminho.
   *
   * Uma linha que fica em `PROCESSANDO` porque o envio nunca aconteceu é lixo
   * conhecido e inofensivo — não conta como foto, não aparece no catálogo, e
   * some com a rotina de limpeza.
   */
  async autorizar(
    produtoId: string,
    pedido: PedidoDeEnvio,
    principal: Principal,
  ): Promise<AutorizacaoDeEnvio> {
    const contexto = exigirContexto();

    const { imagemId, chave } = await comEscopoAtual(this.prisma, async (tx) => {
      const produto = await this.exigirProduto(tx, produtoId);

      if (pedido.variacaoId) {
        const variacao = await tx.variacao.findFirst({
          where: { id: pedido.variacaoId, produtoId },
          select: { id: true },
        });

        if (!variacao) {
          throw new NotFoundException({
            codigo: 'VARIACAO_NAO_ENCONTRADA',
            mensagem: 'A variação não pertence a este produto.',
          });
        }
      }

      const vivas = await tx.produtoImagem.count({
        where: { produtoId, variacaoId: pedido.variacaoId ?? null, excluidoEm: null },
      });

      const limite = pedido.variacaoId ? 1 : LIMITE_FOTOS_PRODUTO;

      if (vivas >= limite) {
        throw new ConflictException({
          codigo: 'LIMITE_DE_FOTOS',
          mensagem: pedido.variacaoId
            ? 'A variação já tem foto. Remova a atual para enviar outra.'
            : `O produto já tem ${String(LIMITE_FOTOS_PRODUTO)} fotos.`,
        });
      }

      // Texto alternativo vazio é preenchido com o nome do produto: serve
      // acessibilidade e o SEO do catálogo, e custa nada ao operador.
      // docs/MEDIA.md §7.
      const textoAlternativo = pedido.textoAlternativo?.trim() || produto.nome;

      const imagem = await tx.produtoImagem.create({
        data: {
          tenantId: contexto.tenantId,
          produtoId,
          variacaoId: pedido.variacaoId ?? null,
          chaveObjeto: '',
          ordem: vivas,
          // A capa é eleita na CONFIRMAÇÃO, nunca aqui. Marcar principal
          // agora significaria que um envio que nunca chegou — ou que chegou
          // corrompido — vira a capa do produto no catálogo.
          principal: false,
          textoAlternativo: textoAlternativo.slice(0, 255),
          bytes: BigInt(pedido.bytes),
          criadoPor: principal.id,
        },
        select: { id: true },
      });

      const chaveObjeto = montarChave(
        contexto.tenantId,
        produtoId,
        imagem.id,
        'original',
        EXTENSAO_POR_TIPO[pedido.tipo] ?? 'bin',
      );

      await tx.produtoImagem.update({
        where: { id: imagem.id },
        data: { chaveObjeto },
      });

      return { imagemId: imagem.id, chave: chaveObjeto };
    });

    const envio = await this.armazenamento.destinoDeEnvio({
      chave,
      tipo: pedido.tipo,
      bytes: pedido.bytes,
      validadeSegundos: VALIDADE_ENVIO_SEGUNDOS,
    });

    return { imagemId, envio };
  }

  // -------------------------------------------------------------------------
  // Passo 3 — confirmar
  // -------------------------------------------------------------------------

  /**
   * Confere o arquivo que chegou e marca a imagem como pronta.
   *
   * É aqui que o conteúdo é validado, **não** no passo 1. O tipo e o tamanho
   * declarados antes do envio são intenção; o que vale é o que foi gravado.
   */
  async confirmar(
    produtoId: string,
    imagemId: string,
    principal: Principal,
  ): Promise<ImagemProduto> {
    const contexto = exigirContexto();

    const registro = await comEscopoAtual(this.prisma, async (tx) => {
      const imagem = await tx.produtoImagem.findFirst({
        where: { id: imagemId, produtoId, excluidoEm: null },
      });

      if (!imagem) {
        throw new NotFoundException({
          codigo: 'IMAGEM_NAO_ENCONTRADA',
          mensagem: 'Imagem não encontrada.',
        });
      }

      return imagem;
    });

    if (!(await this.armazenamento.existe(registro.chaveObjeto))) {
      throw new BadRequestException({
        codigo: 'ARQUIVO_NAO_ENVIADO',
        mensagem: 'O arquivo ainda não chegou ao armazenamento.',
      });
    }

    const conteudo = await this.armazenamento.ler(registro.chaveObjeto);

    try {
      const imagem = lerImagem(conteudo);
      conferirImagemDeCatalogo(imagem, conteudo.byteLength);

      let atualizada: ProdutoImagemLinha = await comEscopoAtual(this.prisma, (tx) =>
        tx.produtoImagem.update({
          where: { id: imagemId },
          data: {
            status: 'PRONTA',
            largura: imagem.largura,
            altura: imagem.altura,
            bytes: BigInt(conteudo.byteLength),
            hashConteudo: createHash('sha256').update(conteudo).digest('hex'),
          },
        }),
      );

      // A eleição da capa é uma operação separada, e que pode falhar sem
      // levar o envio junto.
      //
      // Quem envia quatro fotos de uma vez dispara quatro confirmações em
      // paralelo. Todas veem "este produto não tem capa" antes de qualquer
      // uma gravar, todas tentam assumir, e o índice único parcial derruba as
      // perdedoras. Isso já aconteceu aqui: uma foto ficou PROCESSANDO para
      // sempre porque a exceção da eleição abortou a confirmação inteira.
      //
      // Perder a eleição é resultado correto — significa que outra foto virou
      // capa —, então ela é engolida de propósito.
      if (!registro.variacaoId) {
        atualizada = (await this.elegerCapa(produtoId, imagemId)) ?? atualizada;
      }

      await this.auditoria.registrar({
        contexto,
        acao: 'IMAGEM_ENVIADA',
        entidade: 'produto_imagem',
        entidadeId: imagemId,
        atorNome: principal.nome,
        depois: {
          produtoId,
          tipo: imagem.tipo,
          dimensoes: `${String(imagem.largura)}x${String(imagem.altura)}`,
          bytes: conteudo.byteLength,
        },
      });

      return this.paraContrato(atualizada);
    } catch (erro) {
      if (erro instanceof ImagemInvalidaError) {
        // A linha fica em FALHA, não some: o operador precisa ver o motivo na
        // tela, e não adianta a foto sumir sem explicação.
        await comEscopoAtual(this.prisma, (tx) =>
          tx.produtoImagem.update({ where: { id: imagemId }, data: { status: 'FALHA' } }),
        );

        throw new BadRequestException({ codigo: erro.codigo, mensagem: erro.message });
      }
      throw erro;
    }
  }

  // -------------------------------------------------------------------------
  // Listar, alterar, excluir
  // -------------------------------------------------------------------------

  async listar(produtoId: string): Promise<ImagemProduto[]> {
    return comEscopoAtual(this.prisma, async (tx) => {
      await this.exigirProduto(tx, produtoId);

      const imagens = await tx.produtoImagem.findMany({
        where: { produtoId, excluidoEm: null },
        orderBy: [{ principal: 'desc' }, { ordem: 'asc' }, { criadoEm: 'asc' }],
      });

      return imagens.map((i) => this.paraContrato(i));
    });
  }

  async alterar(
    produtoId: string,
    imagemId: string,
    dados: AlteracaoImagem,
    principal: Principal,
  ): Promise<ImagemProduto> {
    const contexto = exigirContexto();

    const atualizada = await comEscopoAtual(this.prisma, async (tx) => {
      const imagem = await tx.produtoImagem.findFirst({
        where: { id: imagemId, produtoId, excluidoEm: null },
      });

      if (!imagem) {
        throw new NotFoundException({
          codigo: 'IMAGEM_NAO_ENCONTRADA',
          mensagem: 'Imagem não encontrada.',
        });
      }

      if (dados.principal) {
        if (imagem.variacaoId) {
          throw new ConflictException({
            codigo: 'FOTO_DE_VARIACAO_NAO_E_CAPA',
            mensagem: 'A capa do produto não pode ser a foto de uma variação.',
          });
        }

        if (imagem.status !== 'PRONTA') {
          throw new ConflictException({
            codigo: 'IMAGEM_NAO_ESTA_PRONTA',
            mensagem: 'Só uma imagem pronta pode virar capa.',
          });
        }

        // Rebaixa a anterior ANTES de promover esta: o índice único parcial
        // recusaria duas principais, e a ordem errada derrubaria a operação.
        await tx.produtoImagem.updateMany({
          where: { produtoId, principal: true, excluidoEm: null },
          data: { principal: false },
        });
      }

      return tx.produtoImagem.update({
        where: { id: imagemId },
        data: {
          ...(dados.principal ? { principal: true } : {}),
          ...(dados.ordem === undefined ? {} : { ordem: dados.ordem }),
          ...(dados.textoAlternativo === undefined
            ? {}
            : { textoAlternativo: dados.textoAlternativo }),
        },
      });
    });

    if (dados.principal) {
      await this.auditoria.registrar({
        contexto,
        acao: 'IMAGEM_CAPA_DEFINIDA',
        entidade: 'produto_imagem',
        entidadeId: imagemId,
        atorNome: principal.nome,
        depois: { produtoId },
      });
    }

    return this.paraContrato(atualizada);
  }

  /**
   * Exclusão **lógica**.
   *
   * O objeto continua no armazenamento até uma rotina confirmar que nenhuma
   * venda nem catálogo publicado o referencia. docs/MEDIA.md §3.
   */
  async excluir(produtoId: string, imagemId: string, principal: Principal): Promise<void> {
    const contexto = exigirContexto();

    await comEscopoAtual(this.prisma, async (tx) => {
      const imagem = await tx.produtoImagem.findFirst({
        where: { id: imagemId, produtoId, excluidoEm: null },
      });

      if (!imagem) {
        throw new NotFoundException({
          codigo: 'IMAGEM_NAO_ENCONTRADA',
          mensagem: 'Imagem não encontrada.',
        });
      }

      const produto = await tx.produto.findFirstOrThrow({
        where: { id: produtoId },
        select: { publicadoNoCatalogo: true },
      });

      const restantes = await tx.produtoImagem.count({
        where: { produtoId, variacaoId: null, excluidoEm: null, id: { not: imagemId } },
      });

      // Um produto publicado sem foto nenhuma é um buraco no catálogo. A
      // recusa é aqui e não na rotina de limpeza porque aqui há alguém na
      // frente da tela para despublicar antes.
      if (produto.publicadoNoCatalogo && restantes === 0 && !imagem.variacaoId) {
        throw new ConflictException({
          codigo: 'CATALOGO_FICARIA_SEM_FOTO',
          mensagem:
            'Esta é a última foto de um produto publicado. Despublique o produto antes de removê-la.',
        });
      }

      await tx.produtoImagem.update({
        where: { id: imagemId },
        data: { excluidoEm: new Date(), principal: false },
      });

      // A capa não pode simplesmente sumir: a próxima foto viva assume.
      if (imagem.principal && restantes > 0) {
        const proxima = await tx.produtoImagem.findFirst({
          where: { produtoId, variacaoId: null, excluidoEm: null, status: 'PRONTA' },
          orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
          select: { id: true },
        });

        if (proxima) {
          await tx.produtoImagem.update({
            where: { id: proxima.id },
            data: { principal: true },
          });
        }
      }
    });

    await this.auditoria.registrar({
      contexto,
      acao: 'IMAGEM_EXCLUIDA',
      entidade: 'produto_imagem',
      entidadeId: imagemId,
      atorNome: principal.nome,
      depois: { produtoId, exclusao: 'logica' },
    });
  }

  // -------------------------------------------------------------------------
  // Entrega do binário
  // -------------------------------------------------------------------------

  /**
   * Devolve os bytes de uma imagem do tenant atual.
   *
   * A leitura passa pelo banco **dentro do escopo** antes de tocar o
   * armazenamento: é o RLS que decide se aquela imagem é desta empresa. Servir
   * a partir do id sem essa volta transformaria o id em senha.
   */
  async conteudo(imagemId: string): Promise<{ bytes: Uint8Array; tipo: string }> {
    const registro = await comEscopoAtual(this.prisma, (tx) =>
      tx.produtoImagem.findFirst({
        where: { id: imagemId, excluidoEm: null },
        select: { chaveObjeto: true },
      }),
    );

    if (!registro?.chaveObjeto) {
      throw new NotFoundException({
        codigo: 'IMAGEM_NAO_ENCONTRADA',
        mensagem: 'Imagem não encontrada.',
      });
    }

    const bytes = await this.armazenamento.ler(registro.chaveObjeto);

    // O tipo sai do conteúdo, como em todo o resto deste módulo.
    return { bytes, tipo: lerImagem(bytes).tipo };
  }

  // -------------------------------------------------------------------------

  /**
   * Promove a imagem a capa, se o produto ainda não tiver uma.
   *
   * Devolve a linha atualizada, ou `null` quando outra foto já é a capa —
   * inclusive quando a corrida é perdida no commit, que o PostgreSQL relata
   * como violação de unicidade (P2002).
   */
  private async elegerCapa(
    produtoId: string,
    imagemId: string,
  ): Promise<ProdutoImagemLinha | null> {
    try {
      return await comEscopoAtual(this.prisma, async (tx) => {
        const jaTemCapa = await tx.produtoImagem.count({
          where: { produtoId, principal: true, excluidoEm: null },
        });

        if (jaTemCapa > 0) {
          return null;
        }

        return tx.produtoImagem.update({
          where: { id: imagemId },
          data: { principal: true },
        });
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return null;
      }
      throw erro;
    }
  }

  private async exigirProduto(
    tx: ClienteEmTransacao,
    produtoId: string,
  ): Promise<{ id: string; nome: string }> {
    const produto = await tx.produto.findFirst({
      where: { id: produtoId },
      select: { id: true, nome: true },
    });

    if (!produto) {
      // 404 e não 403: produto de outra empresa não existe para esta.
      throw new NotFoundException({
        codigo: 'PRODUTO_NAO_ENCONTRADO',
        mensagem: 'Produto não encontrado.',
      });
    }

    return produto;
  }

  private paraContrato(i: ProdutoImagemLinha): ImagemProduto {
    return {
      id: i.id,
      variacaoId: i.variacaoId,
      ordem: i.ordem,
      principal: i.principal,
      textoAlternativo: i.textoAlternativo,
      largura: i.largura,
      altura: i.altura,
      // BigInt não sobrevive a JSON.stringify. Bytes de imagem cabem
      // folgadamente em Number — o limite é 10 MB.
      bytes: i.bytes === null ? null : Number(i.bytes),
      status: i.status as ImagemProduto['status'],
      url: `/midia/${i.id}`,
    };
  }
}
