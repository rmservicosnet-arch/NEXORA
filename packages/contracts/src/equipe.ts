import { z } from 'zod';

/**
 * A equipe: quem entra no sistema, com qual perfil e em quais lojas.
 *
 * O modelo existe desde a Fase 1 — `usuario`, `usuario_perfil`,
 * `usuario_loja_acesso`, `perfil`, `perfil_permissao` — e não havia rota nem
 * tela: a equipe só existia pelo seed. `PERM.usuario.visualizar`, `criar` e
 * `editar` estavam declaradas e nada as usava.
 *
 * Duas perguntas diferentes, dois campos diferentes:
 *
 *   PERFIL diz o que a pessoa **pode**  → `@Permissoes()`
 *   LOJA   diz **onde**                 → `@EscopoLoja()`
 */

export const statusUsuarioSchema = z.enum(['ATIVO', 'INATIVO']);
export type StatusUsuario = z.infer<typeof statusUsuarioSchema>;

const email = z.string().trim().toLowerCase().email('Informe um e-mail válido').max(180);

// ---------------------------------------------------------------------------
// Perfis e permissões
// ---------------------------------------------------------------------------

export const permissaoSchema = z.object({
  chave: z.string(),
  grupo: z.string(),
  descricao: z.string(),
});
export type Permissao = z.infer<typeof permissaoSchema>;

export const perfilSchema = z.object({
  id: z.string(),
  nome: z.string(),
  chave: z.string(),
  descricao: z.string().nullable(),
  /**
   * Perfil de sistema é **só leitura**.
   *
   * Não é capricho: `npm run db:sync-perfis` reescreve as permissões dos
   * perfis de sistema a partir de `docs/`. Uma edição feita na tela voltaria
   * atrás na próxima sincronização, sem ninguém entender por quê. Quem
   * precisa de algo diferente DUPLICA e ajusta a cópia.
   */
  sistema: z.boolean(),
  permissoes: z.array(z.string()),
  /** Quantas pessoas usam. Excluir perfil com gente é recusado. */
  usuarios: z.number().int(),
});
export type Perfil = z.infer<typeof perfilSchema>;

export const novoPerfilSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao perfil').max(80),
  descricao: z.string().trim().max(200).optional(),
  /**
   * Lista EXPLÍCITA. Nunca um curinga de grupo.
   *
   * "Todo o grupo carteira" passaria a conceder cada permissão que aparecesse
   * ali depois, sem ninguém decidir — foi assim que o perfil FINANCEIRO ganhou
   * `carteira.ajustar` duas vezes. A tela pode oferecer "marcar o grupo"; o
   * que ela manda é a lista de hoje, uma a uma.
   */
  permissoes: z.array(z.string()).min(1, 'Um perfil sem permissão não deixa ninguém fazer nada'),
});
export type NovoPerfil = z.infer<typeof novoPerfilSchema>;

export const alteracaoPerfilSchema = z.object({
  nome: z.string().trim().min(2).max(80).optional(),
  descricao: z.string().trim().max(200).nullable().optional(),
  permissoes: z.array(z.string()).min(1).optional(),
});
export type AlteracaoPerfil = z.infer<typeof alteracaoPerfilSchema>;

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

export const usuarioSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string(),
  status: statusUsuarioSchema,
  perfis: z.array(z.object({ id: z.string(), nome: z.string(), chave: z.string() })),
  lojas: z.array(z.object({ id: z.string(), nome: z.string() })),
  ultimoLoginEm: z.string().nullable(),
  criadoEm: z.string(),
  /**
   * Entra e não consegue fazer nada.
   *
   * Sem perfil, nenhum menu aparece. Sem loja, as telas vêm vazias — e
   * **nenhuma loja não é "todas", é nenhuma**. Nenhum dos dois dá erro em
   * lugar nenhum, então quem acabou de ser cadastrado acha que o sistema
   * quebrou. Por isso o estado vem da API, não é deduzido na tela.
   */
  inerte: z.boolean(),
  /** Administrador da plataforma, fora do RBAC da empresa. Não se edita aqui. */
  plataformaAdmin: z.boolean(),
});
export type Usuario = z.infer<typeof usuarioSchema>;

export const filtroUsuariosSchema = z.object({
  status: statusUsuarioSchema.optional(),
  busca: z.string().trim().max(120).optional(),
  perfilId: z.string().uuid().optional(),
  lojaId: z.string().uuid().optional(),
});
export type FiltroUsuarios = z.infer<typeof filtroUsuariosSchema>;

export const paginaUsuariosSchema = z.object({
  itens: z.array(usuarioSchema),
  /** Contam o CONJUNTO do filtro, nunca a página. */
  contagens: z.object({
    total: z.number().int(),
    ativos: z.number().int(),
    inativos: z.number().int(),
    /** Ativos que entram e não fazem nada. É o número da faixa de aviso. */
    inertes: z.number().int(),
  }),
});
export type PaginaUsuarios = z.infer<typeof paginaUsuariosSchema>;

export const novoUsuarioSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome').max(160),
  email,
  /*
    Ao menos um de cada, na CRIAÇÃO. Criar alguém que entra e não faz nada é
    produzir o problema de propósito; tirar depois é possível, e aí a lista
    avisa em faixa.
  */
  perfilIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos um perfil'),
  lojaIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos uma loja'),
});
export type NovoUsuario = z.infer<typeof novoUsuarioSchema>;

/**
 * A senha vem UMA VEZ.
 *
 * O servidor gera, devolve aqui e guarda só o hash argon2id. Poder mostrar de
 * novo significaria ter guardado a senha — e quem cadastra não digita senha de
 * terceiro. Perdeu, gera outra.
 */
export const usuarioCriadoSchema = z.object({
  usuario: usuarioSchema,
  senhaProvisoria: z.string(),
});
export type UsuarioCriado = z.infer<typeof usuarioCriadoSchema>;

export const alteracaoUsuarioSchema = z.object({
  nome: z.string().trim().min(2).max(160).optional(),
  status: statusUsuarioSchema.optional(),
  perfilIds: z.array(z.string().uuid()).optional(),
  lojaIds: z.array(z.string().uuid()).optional(),
});
export type AlteracaoUsuario = z.infer<typeof alteracaoUsuarioSchema>;

export const senhaRedefinidaSchema = z.object({ senhaProvisoria: z.string() });
export type SenhaRedefinida = z.infer<typeof senhaRedefinidaSchema>;

/** O que a tela de cadastro precisa para oferecer escolhas. */
export const apoioEquipeSchema = z.object({
  perfis: z.array(perfilSchema),
  lojas: z.array(z.object({ id: z.string(), nome: z.string() })),
  permissoes: z.array(permissaoSchema),
});
export type ApoioEquipe = z.infer<typeof apoioEquipeSchema>;
