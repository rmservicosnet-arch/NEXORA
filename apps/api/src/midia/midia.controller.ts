import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { PERM } from '@estoque/contracts';
import type { Response } from 'express';

import { Armazenamento } from '../armazenamento/armazenamento';
import {
  ArmazenamentoLocal,
  AutorizacaoDeEnvioInvalidaError,
} from '../armazenamento/armazenamento-local.service';
import { DOMINIO_CLIENTE } from '../auth/dominios';
import { ExigeDominio, Permissoes, Publico } from '../comum/decoradores';
import { ImagensService } from '../produtos/imagens.service';

@Controller('midia')
export class MidiaController {
  constructor(
    private readonly armazenamento: Armazenamento,
    private readonly imagens: ImagensService,
  ) {}

  /**
   * Recebe o binário autorizado pelo bilhete.
   *
   * **Pública de propósito.** Esta rota é o que, no S3, seria o próprio bucket
   * — e o bucket não conhece a sessão do usuário. A autorização é o bilhete
   * assinado: ele diz qual chave pode ser escrita, com qual tipo e até quantos
   * bytes, e expira em cinco minutos.
   *
   * Ela não lê nem escreve nada no banco, então não precisa de contexto de
   * tenant: o isolamento está na chave, que foi montada pelo servidor a partir
   * do tenant da sessão no passo 1.
   */
  @Put('enviar')
  @Publico()
  @HttpCode(200)
  async enviar(
    @Query('bilhete') bilhete: string | undefined,
    @Body() corpo: unknown,
  ): Promise<{ recebido: number }> {
    if (!(this.armazenamento instanceof ArmazenamentoLocal)) {
      throw new BadRequestException({
        codigo: 'ROTA_SO_PARA_DRIVER_LOCAL',
        mensagem: 'Com armazenamento externo o envio vai direto para o bucket.',
      });
    }

    if (!bilhete) {
      throw new BadRequestException({
        codigo: 'ENVIO_NAO_AUTORIZADO',
        mensagem: 'Envio sem autorização.',
      });
    }

    if (!Buffer.isBuffer(corpo)) {
      throw new BadRequestException({
        codigo: 'CORPO_INVALIDO',
        mensagem: 'O corpo da requisição precisa ser o arquivo.',
      });
    }

    try {
      const autorizacao = this.armazenamento.conferirBilhete(bilhete);

      // O bilhete diz quantos bytes foram autorizados. Aceitar mais permitiria
      // encher o disco com uma autorização de 1 KB.
      if (corpo.byteLength > autorizacao.bytes) {
        throw new BadRequestException({
          codigo: 'TAMANHO_ACIMA_DO_AUTORIZADO',
          mensagem: `O arquivo tem ${String(corpo.byteLength)} bytes; a autorização era de ${String(autorizacao.bytes)}.`,
        });
      }

      await this.armazenamento.gravar(autorizacao.chave, new Uint8Array(corpo), autorizacao.tipo);

      return { recebido: corpo.byteLength };
    } catch (erro) {
      if (erro instanceof AutorizacaoDeEnvioInvalidaError) {
        throw new BadRequestException({ codigo: erro.codigo, mensagem: erro.message });
      }
      throw erro;
    }
  }

  /**
   * Entrega os bytes da imagem.
   *
   * Autenticada e com escopo: o id não é credencial. Ver `ImagensService.conteudo`.
   */
  @Get(':imagemId')
  @Permissoes(PERM.produto.visualizar)
  @Header('Cache-Control', 'private, max-age=300')
  async servir(@Param('imagemId') imagemId: string, @Res() resposta: Response): Promise<void> {
    const { bytes, tipo } = await this.imagens.conteudo(imagemId);

    resposta.setHeader('Content-Type', tipo);
    resposta.setHeader('Content-Length', bytes.byteLength);
    resposta.end(Buffer.from(bytes));
  }
}

/**
 * As imagens, para o PORTAL do cliente.
 *
 * Rota separada pelo mesmo motivo de `portal/pedidos`: os dois domínios são
 * independentes por desenho (ADR-009) e cada um precisa dizer o que autoriza.
 * O cliente carrega só `portal.acessar` — na rota da equipe ele levaria 403 e
 * o catálogo apareceria sem foto nenhuma.
 *
 * Aqui não há `@Permissoes`: quem chega já é do domínio do cliente, e o
 * recorte de o QUE ele pode ver é feito na consulta, contra o catálogo.
 */
@Controller('portal/midia')
@ExigeDominio(DOMINIO_CLIENTE)
export class PortalMidiaController {
  constructor(private readonly imagens: ImagensService) {}

  @Get(':imagemId')
  @Header('Cache-Control', 'private, max-age=300')
  async servir(@Param('imagemId') imagemId: string, @Res() resposta: Response): Promise<void> {
    const { bytes, tipo } = await this.imagens.conteudoDoCatalogo(imagemId);

    resposta.setHeader('Content-Type', tipo);
    resposta.setHeader('Content-Length', bytes.byteLength);
    resposta.end(Buffer.from(bytes));
  }
}
