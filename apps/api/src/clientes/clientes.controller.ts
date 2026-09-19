import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  alteracaoAcessoClienteSchema,
  alteracaoClienteSchema,
  filtroClientesSchema,
  novoAcessoClienteSchema,
  novoClienteSchema,
  PERM,
  type AcessoCliente,
  type AcessoCriado,
  type AlteracaoAcessoCliente,
  type AlteracaoCliente,
  type ApoioCliente,
  type Cliente,
  type FiltroClientes,
  type NovoAcessoCliente,
  type NovoCliente,
  type PaginaClientes,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { AcessosService } from './acessos.service';
import { ClientesService } from './clientes.service';

@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly clientes: ClientesService,
    private readonly acessos: AcessosService,
  ) {}

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

  // --- Acesso ao portal ----------------------------------------------------
  //
  // `cliente.gerenciar_acesso`, e não `cliente.editar`: emitir credencial de
  // login não é o mesmo grau de autoridade que corrigir um telefone. O perfil
  // VENDEDOR tem o segundo e não tem o primeiro.

  @Get(':id/acessos')
  @Permissoes(PERM.cliente.gerenciarAcesso)
  async acessosDoCliente(@Param('id') id: string): Promise<AcessoCliente[]> {
    return this.acessos.listar(id);
  }

  @Post(':id/acessos')
  @Permissoes(PERM.cliente.gerenciarAcesso)
  async criarAcesso(
    @Param('id') id: string,
    @Body(new ZodPipe(novoAcessoClienteSchema)) dados: NovoAcessoCliente,
    @PrincipalAtual() principal: Principal,
  ): Promise<AcessoCriado> {
    return this.acessos.criar(id, dados, principal);
  }

  @Patch(':id/acessos/:acessoId')
  @Permissoes(PERM.cliente.gerenciarAcesso)
  async alterarAcesso(
    @Param('id') id: string,
    @Param('acessoId') acessoId: string,
    @Body(new ZodPipe(alteracaoAcessoClienteSchema)) dados: AlteracaoAcessoCliente,
  ): Promise<AcessoCliente> {
    return this.acessos.alterar(id, acessoId, dados);
  }

  /** Devolve uma senha provisória nova. A anterior deixa de valer na hora. */
  @Post(':id/acessos/:acessoId/senha')
  @Permissoes(PERM.cliente.gerenciarAcesso)
  async redefinirSenha(
    @Param('id') id: string,
    @Param('acessoId') acessoId: string,
  ): Promise<AcessoCriado> {
    return this.acessos.redefinirSenha(id, acessoId);
  }
}
