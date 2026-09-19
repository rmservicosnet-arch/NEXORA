import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  alteracaoClienteSchema,
  filtroClientesSchema,
  novoClienteSchema,
  PERM,
  type AlteracaoCliente,
  type ApoioCliente,
  type Cliente,
  type FiltroClientes,
  type NovoCliente,
  type PaginaClientes,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { ClientesService } from './clientes.service';

@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  @Permissoes(PERM.cliente.visualizar)
  async listar(
    @Query(new ZodPipe(filtroClientesSchema)) filtro: FiltroClientes,
  ): Promise<PaginaClientes> {
    return this.clientes.listar(filtro);
  }

  // Antes de `:id`: o NestJS casa na ordem de declaração, e `:id` capturaria
  // "apoio" se viesse primeiro.
  @Get('apoio')
  @Permissoes(PERM.cliente.visualizar)
  async apoio(): Promise<ApoioCliente> {
    return this.clientes.apoio();
  }

  @Get(':id')
  @Permissoes(PERM.cliente.visualizar)
  async detalhe(@Param('id') id: string): Promise<Cliente> {
    return this.clientes.detalhe(id);
  }

  @Post()
  @Permissoes(PERM.cliente.criar)
  async criar(
    @Body(new ZodPipe(novoClienteSchema)) dados: NovoCliente,
    @PrincipalAtual() principal: Principal,
  ): Promise<{ id: string }> {
    return this.clientes.criar(dados, principal);
  }

  /**
   * Alterar inclui **vincular a tabela de preço**.
   *
   * É `cliente.editar`, e não uma permissão de preço: quem muda a tabela não
   * está mexendo em quanto custa, e sim em qual lista este cadastro enxerga.
   * Mexer nos preços em si é `preco.editar`, noutra rota.
   */
  @Patch(':id')
  @Permissoes(PERM.cliente.editar)
  async alterar(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoClienteSchema)) dados: AlteracaoCliente,
  ): Promise<{ id: string }> {
    return this.clientes.alterar(id, dados);
  }
}
