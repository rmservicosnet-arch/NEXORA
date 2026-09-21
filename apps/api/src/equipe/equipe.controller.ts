import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  PERM,
  alteracaoPerfilSchema,
  alteracaoUsuarioSchema,
  filtroUsuariosSchema,
  novoPerfilSchema,
  novoUsuarioSchema,
  type AlteracaoPerfil,
  type AlteracaoUsuario,
  type ApoioEquipe,
  type FiltroUsuarios,
  type NovoPerfil,
  type NovoUsuario,
  type PaginaUsuarios,
  type Perfil,
  type SenhaRedefinida,
  type Usuario,
  type UsuarioCriado,
} from '@estoque/contracts';

import type { Principal } from '../auth/dominios';
import { Permissoes, PrincipalAtual } from '../comum/decoradores';
import { ZodPipe } from '../comum/zod.pipe';
import { PerfisService } from './perfis.service';
import { UsuariosService } from './usuarios.service';

/**
 * A equipe: usuários, perfis e permissões.
 *
 * `usuario.visualizar`, `usuario.criar` e `usuario.editar` estavam declaradas
 * desde a Fase 1 e nenhuma rota as exigia — a equipe só existia pelo seed.
 *
 * Perfil e permissão andam com `usuario.editar`: quem monta perfil está
 * decidindo o que os outros podem fazer, e isso é a mesma responsabilidade.
 */
@Controller('equipe')
export class EquipeController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly perfis: PerfisService,
  ) {}

  /** Perfis, lojas e o catálogo de permissões — o que a tela precisa para oferecer escolha. */
  @Get('apoio')
  @Permissoes(PERM.usuario.visualizar)
  async apoio(): Promise<ApoioEquipe> {
    return this.usuarios.apoio();
  }

  // -------------------------------------------------------------------------
  // Perfis — antes de `:id`, senão "perfis" vira um id
  // -------------------------------------------------------------------------

  @Get('perfis')
  @Permissoes(PERM.usuario.visualizar)
  async listarPerfis(): Promise<Perfil[]> {
    return this.perfis.listar();
  }

  @Post('perfis')
  @Permissoes(PERM.usuario.editar)
  async criarPerfil(@Body(new ZodPipe(novoPerfilSchema)) dados: NovoPerfil): Promise<Perfil> {
    return this.perfis.criar(dados);
  }

  @Put('perfis/:id')
  @Permissoes(PERM.usuario.editar)
  async alterarPerfil(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoPerfilSchema)) dados: AlteracaoPerfil,
  ): Promise<Perfil> {
    return this.perfis.alterar(id, dados);
  }

  /** Duplicar é o caminho para mexer no que um perfil de sistema faz. */
  @Post('perfis/:id/duplicar')
  @Permissoes(PERM.usuario.editar)
  async duplicarPerfil(
    @Param('id') id: string,
    @Body(new ZodPipe(novoPerfilSchema.pick({ nome: true }))) dados: { nome: string },
  ): Promise<Perfil> {
    return this.perfis.duplicar(id, dados.nome);
  }

  @Delete('perfis/:id')
  @Permissoes(PERM.usuario.editar)
  async excluirPerfil(@Param('id') id: string): Promise<{ excluido: boolean }> {
    await this.perfis.excluir(id);
    return { excluido: true };
  }

  // -------------------------------------------------------------------------
  // Usuários
  // -------------------------------------------------------------------------

  @Get()
  @Permissoes(PERM.usuario.visualizar)
  async listar(
    @Query(new ZodPipe(filtroUsuariosSchema)) filtro: FiltroUsuarios,
  ): Promise<PaginaUsuarios> {
    return this.usuarios.listar(filtro);
  }

  @Get(':id')
  @Permissoes(PERM.usuario.visualizar)
  async detalhe(@Param('id') id: string): Promise<Usuario> {
    return this.usuarios.detalhe(id);
  }

  @Post()
  @Permissoes(PERM.usuario.criar)
  async criar(
    @Body(new ZodPipe(novoUsuarioSchema)) dados: NovoUsuario,
    @PrincipalAtual() principal: Principal,
  ): Promise<UsuarioCriado> {
    return this.usuarios.criar(dados, principal);
  }

  @Put(':id')
  @Permissoes(PERM.usuario.editar)
  async alterar(
    @Param('id') id: string,
    @Body(new ZodPipe(alteracaoUsuarioSchema)) dados: AlteracaoUsuario,
    @PrincipalAtual() principal: Principal,
  ): Promise<Usuario> {
    return this.usuarios.alterar(id, dados, principal);
  }

  /**
   * Nova senha provisória. Mostrada uma vez, como na criação.
   *
   * Revoga as sessões abertas: redefine-se porque a senha pode ter vazado, e a
   * sessão aberta sobreviveria à troca.
   */
  @Post(':id/senha')
  @Permissoes(PERM.usuario.editar)
  async redefinirSenha(
    @Param('id') id: string,
    @PrincipalAtual() principal: Principal,
  ): Promise<SenhaRedefinida> {
    return this.usuarios.redefinirSenha(id, principal);
  }
}
