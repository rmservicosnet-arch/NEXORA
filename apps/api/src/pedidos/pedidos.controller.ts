import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  aceitePedidoSchema,
  buscaCatalogoSchema,
  confirmacaoPedidoSchema,
  devolucaoPedidoSchema,
  faturamentoPedidoSchema,
  filtroPedidosSchema,
  inclusaoItemSchema,
  novoPedidoSchema,
  remocaoItemSchema,
  PERM,
  type AceitePedido,
  type BuscaCatalogo,
  type ConfirmacaoPedido,
  type DevolucaoPedido,
  type FaturamentoPedido,
  type FiltroPedidos,
  type InclusaoItem,
  type ItemCatalogo,
  type NovoPedido,
  type PaginaPedidos,
  type Pedido,
  type RemocaoItem,
  type ResultadoCheckout,
} from '@estoque/contracts';

import { DOMINIO_CLIENTE, type Principal } from '../auth/dominios';
import { ExigeDominio, Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { PedidosService } from './pedidos.service';

/**
 * A fila da equipe.
 *
 * `daEquipe = true` em toda consulta: e o que faz o JSON carregar
 * `disponivelAgora`, que e quantidade e o cliente nunca ve.
 */
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Get()
  @Permissoes(PERM.pedido.visualizarFila)
  async listar(
    @Query(new ZodPipe(filtroPedidosSchema)) filtro: FiltroPedidos,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaPedidos> {
    return this.pedidos.listar(filtro, principal, true);
  }

  @Get(':id')
  @Permissoes(PERM.pedido.visualizarFila)
  async detalhe(@Param('id') id: string, @PrincipalAtual() principal: Principal): Promise<Pedido> {
    return this.pedidos.detalhe(id, principal, true);
  }

  @Post(':id/itens')
  @Permissoes(PERM.pedido.editarItens)
  async incluirItem(
    @Param('id') id: string,
    @Body(new ZodPipe(inclusaoItemSchema)) dados: InclusaoItem,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.incluirItem(id, dados, principal);
  }

  @Post(':id/itens/:itemId/remover')
  @Permissoes(PERM.pedido.editarItens)
  async removerItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodPipe(remocaoItemSchema)) dados: RemocaoItem,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.removerItem(id, itemId, dados, principal);
  }

  @Post(':id/confirmar')
  @Permissoes(PERM.pedido.confirmar)
  async confirmar(
    @Param('id') id: string,
    @Body(new ZodPipe(confirmacaoPedidoSchema)) dados: ConfirmacaoPedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.confirmar(id, dados, principal);
  }

  @Post(':id/devolver')
  @Permissoes(PERM.pedido.devolver)
  async devolver(
    @Param('id') id: string,
    @Body(new ZodPipe(devolucaoPedidoSchema)) dados: DevolucaoPedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.devolver(id, dados, principal);
  }

  @Post(':id/recusar')
  @Permissoes(PERM.pedido.recusar)
  async recusar(
    @Param('id') id: string,
    @Body(new ZodPipe(devolucaoPedidoSchema)) dados: DevolucaoPedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.recusar(id, dados, principal);
  }

  @Post(':id/cancelar')
  @Permissoes(PERM.pedido.cancelarConfirmado)
  async cancelar(
    @Param('id') id: string,
    @Body(new ZodPipe(devolucaoPedidoSchema)) dados: DevolucaoPedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.cancelar(id, dados, principal);
  }

  @Post(':id/faturar')
  @Permissoes(PERM.pedido.faturar)
  async faturar(
    @Param('id') id: string,
    @Body(new ZodPipe(faturamentoPedidoSchema)) dados: FaturamentoPedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ pedido: Pedido; vendaNumero: number }> {
    return this.pedidos.faturar(id, dados, principal);
  }
}

/**
 * O portal do cliente.
 *
 * `daEquipe = false` em tudo: o JSON nao carrega quantidade em lugar nenhum.
 * E nao ha `clienteId` em rota alguma — ele vem do token. Aceitar o id pela
 * URL abriria o pedido de qualquer um para quem trocasse o numero.
 * Ver docs/ORDERS.md §7.
 */
@Controller('portal/pedidos')
@ExigeDominio(DOMINIO_CLIENTE)
export class PortalPedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Get('catalogo')
  async catalogo(
    @Query(new ZodPipe(buscaCatalogoSchema)) busca: BuscaCatalogo,
    @PrincipalAtual() principal: Principal,
  ): Promise<ItemCatalogo[]> {
    return this.pedidos.catalogo(busca, principal);
  }

  @Get()
  async meusPedidos(
    @Query(new ZodPipe(filtroPedidosSchema)) filtro: FiltroPedidos,
    @PrincipalAtual() principal: Principal,
  ): Promise<PaginaPedidos> {
    return this.pedidos.listar(filtro, principal, false);
  }

  @Get(':id')
  async meuPedido(
    @Param('id') id: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.detalhe(id, principal, false);
  }

  @Post()
  async checkout(
    @Body(new ZodPipe(novoPedidoSchema)) dados: NovoPedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<ResultadoCheckout> {
    return this.pedidos.checkout(dados, principal);
  }

  @Post(':id/aceite')
  async aceitar(
    @Param('id') id: string,
    @Body(new ZodPipe(aceitePedidoSchema)) dados: AceitePedido,
    @PrincipalAtual() principal: Principal,
  ): Promise<Pedido> {
    return this.pedidos.aceitar(id, dados, principal);
  }
}
