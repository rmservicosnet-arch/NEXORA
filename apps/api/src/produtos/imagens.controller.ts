import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  alteracaoImagemSchema,
  pedidoDeEnvioSchema,
  PERM,
  type AlteracaoImagem,
  type AutorizacaoDeEnvio,
  type ImagemProduto,
  type PedidoDeEnvio,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ImagensService } from './imagens.service';

/**
 * Imagens de um produto.
 *
 * Três passos, nesta ordem: `autorizar` devolve para onde enviar, o cliente
 * envia direto para o armazenamento, `confirmar` valida o que chegou.
 * docs/MEDIA.md §4.
 */
@Controller('produtos/:produtoId/imagens')
export class ImagensController {
  constructor(private readonly imagens: ImagensService) {}

  @Get()
  @Permissoes(PERM.produto.visualizar)
  async listar(@Param('produtoId') produtoId: string): Promise<ImagemProduto[]> {
    return this.imagens.listar(produtoId);
  }

  @Post('autorizar')
  @Permissoes(PERM.produto.gerenciarFotos)
  async autorizar(
    @Param('produtoId') produtoId: string,
    @Body(new ZodPipe(pedidoDeEnvioSchema)) pedido: PedidoDeEnvio,
    @PrincipalAtual() principal: Principal,
  ): Promise<AutorizacaoDeEnvio> {
    return this.imagens.autorizar(produtoId, pedido, principal);
  }

  @Post(':imagemId/confirmar')
  @Permissoes(PERM.produto.gerenciarFotos)
  @HttpCode(200)
  async confirmar(
    @Param('produtoId') produtoId: string,
    @Param('imagemId') imagemId: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<ImagemProduto> {
    return this.imagens.confirmar(produtoId, imagemId, principal);
  }

  @Patch(':imagemId')
  @Permissoes(PERM.produto.gerenciarFotos)
  async alterar(
    @Param('produtoId') produtoId: string,
    @Param('imagemId') imagemId: string,
    @Body(new ZodPipe(alteracaoImagemSchema)) dados: AlteracaoImagem,
    @PrincipalAtual() principal: Principal,
  ): Promise<ImagemProduto> {
    return this.imagens.alterar(produtoId, imagemId, dados, principal);
  }

  @Delete(':imagemId')
  @Permissoes(PERM.produto.gerenciarFotos)
  @HttpCode(204)
  async excluir(
    @Param('produtoId') produtoId: string,
    @Param('imagemId') imagemId: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<void> {
    await this.imagens.excluir(produtoId, imagemId, principal);
  }
}
