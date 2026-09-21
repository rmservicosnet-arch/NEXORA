import { z } from 'zod';

/**
 * A PLATAFORMA: o que está acima das empresas.
 *
 * `docs/TENANCY.md` §3 sempre desenhou a hierarquia assim —
 * `Plataforma → Tenant → Loja → Local` — e o topo era o único nível sem
 * nenhuma entidade correspondente. Uma empresa só nascia pelo seed, que
 * APAGA a anterior, ou por SQL cru com o papel migrator.
 *
 * Tudo aqui cruza empresas, e por isso nada aqui devolve dado de negócio:
 * nome, contagem e situação. Quem precisa ver a venda de uma empresa entra
 * pelo suporte — e essa entrada vira linha na auditoria DELA.
 */

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD');

export const statusEmpresaSchema = z.enum(['ATIVO', 'INATIVO']);
export type StatusEmpresa = z.infer<typeof statusEmpresaSchema>;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export const entrarPlataformaSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido').max(180),
  senha: z.string().min(1, 'Informe a senha'),
});
export type EntrarPlataforma = z.infer<typeof entrarPlataformaSchema>;

export const adminPlataformaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string(),
});
export type AdminPlataforma = z.infer<typeof adminPlataformaSchema>;

export const sessaoPlataformaSchema = z.object({
  tokenAcesso: z.string(),
  admin: adminPlataformaSchema,
});
export type SessaoPlataformaResposta = z.infer<typeof sessaoPlataformaSchema>;

// ---------------------------------------------------------------------------
// Empresas
// ---------------------------------------------------------------------------

export const empresaResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  slug: z.string(),
  documento: z.string().nullable(),
  status: statusEmpresaSchema,
  criadoEm: z.string(),
  /** Só lojas ATIVAS. Zero é aviso: a empresa entra e as telas vêm vazias. */
  lojas: z.number().int(),
  usuarios: z.number().int(),
});
export type EmpresaResumo = z.infer<typeof empresaResumoSchema>;

/**
 * Os indicadores contam o CONJUNTO que a lista mostra, não uma página dela.
 *
 * `usuariosAtivos` e `lojasAtivas` contam apenas as empresas ativas, e o
 * rótulo da tela diz isso: somar usuário de empresa suspensa daria um total
 * que não corresponde a nenhuma linha ao lado.
 */
export const resumoPlataformaSchema = z.object({
  empresas: z.number().int(),
  ativas: z.number().int(),
  suspensas: z.number().int(),
  usuariosAtivos: z.number().int(),
  lojasAtivas: z.number().int(),
  /** `total − devolvido`, sobre o que não é rascunho nem cancelada. */
  vendido30d: z.string(),
});
export type ResumoPlataforma = z.infer<typeof resumoPlataformaSchema>;

export const paginaEmpresasSchema = z.object({
  itens: z.array(empresaResumoSchema),
  resumo: resumoPlataformaSchema,
});
export type PaginaEmpresas = z.infer<typeof paginaEmpresasSchema>;

export const registroPlataformaSchema = z.object({
  id: z.string(),
  acao: z.string(),
  entidade: z.string(),
  atorNome: z.string().nullable(),
  motivo: z.string().nullable(),
  criadoEm: z.string(),
});
export type RegistroPlataforma = z.infer<typeof registroPlataformaSchema>;

export const empresaDetalheSchema = empresaResumoSchema.extend({
  fusoHorario: z.string().nullable(),
  moeda: z.string().nullable(),
  produtos: z.number().int(),
  ultimaVenda: z.string().nullable(),
  administradores: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
      email: z.string(),
      ultimoLoginEm: z.string().nullable(),
    }),
  ),
  /** Só o que a PLATAFORMA fez. A trilha interna da empresa é dela. */
  auditoria: z.array(registroPlataformaSchema),
});
export type EmpresaDetalhe = z.infer<typeof empresaDetalheSchema>;

/**
 * O slug entra na URL e **não muda depois**.
 *
 * Trocar quebraria endereço guardado por quem usa. Por isso ele é sugerido
 * na tela, editável antes de criar, e imutável a partir daí.
 */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'O slug precisa de ao menos 2 caracteres')
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífen');

export const novaEmpresaSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da empresa').max(160),
  slug,
  documento: z.string().trim().max(20).optional(),
  fusoHorario: z.string().trim().max(60).optional(),
  /*
    O administrador vem junto, e não é opcional. Empresa sem ninguém que
    entre é a mesma coisa que empresa que não existe — e criar primeiro para
    "adicionar o usuário depois" abriria uma janela em que só o migrator
    alcança a empresa nova.
  */
  admin: z.object({
    nome: z.string().trim().min(2, 'Informe o nome do administrador').max(160),
    email: z.string().trim().toLowerCase().email('Informe um e-mail válido').max(180),
  }),
});
export type NovaEmpresa = z.infer<typeof novaEmpresaSchema>;

/**
 * A senha vem UMA VEZ.
 *
 * O servidor gera, devolve aqui e guarda só o hash argon2id. Poder mostrar de
 * novo significaria ter guardado — e quem cadastra não digita senha de
 * terceiro.
 */
export const empresaCriadaSchema = z.object({
  empresa: empresaResumoSchema,
  admin: z.object({ id: z.string(), nome: z.string(), email: z.string() }),
  senhaProvisoria: z.string(),
});
export type EmpresaCriada = z.infer<typeof empresaCriadaSchema>;

// ---------------------------------------------------------------------------
// Ações sobre uma empresa
// ---------------------------------------------------------------------------

/**
 * Motivo obrigatório, e ele é o ponto.
 *
 * Um registro de auditoria que diz "fulano suspendeu a empresa" sem dizer por
 * quê obriga quem lê depois a reconstruir a história. O campo é curto de
 * propósito: cabe uma frase, não um relatório.
 */
const motivo = (minimo: number, mensagem: string) =>
  z.string().trim().min(minimo, mensagem).max(400);

export const suspenderEmpresaSchema = z.object({
  motivo: motivo(5, 'Diga por que a empresa está sendo suspensa'),
});
export type SuspenderEmpresa = z.infer<typeof suspenderEmpresaSchema>;

export const reativarEmpresaSchema = z.object({
  motivo: motivo(5, 'Diga por que a empresa está voltando'),
});
export type ReativarEmpresa = z.infer<typeof reativarEmpresaSchema>;

export const redefinirSenhaAdminSchema = z.object({
  usuarioId: z.string().uuid(),
  motivo: motivo(5, 'Diga por que a senha está sendo redefinida'),
});
export type RedefinirSenhaAdmin = z.infer<typeof redefinirSenhaAdminSchema>;

export const senhaAdminRedefinidaSchema = z.object({
  usuario: z.object({ id: z.string(), nome: z.string(), email: z.string() }),
  senhaProvisoria: z.string(),
  /** Quantas sessões caíram junto. Redefinir sem derrubar não protege nada. */
  sessoesRevogadas: z.number().int(),
});
export type SenhaAdminRedefinida = z.infer<typeof senhaAdminRedefinidaSchema>;

/**
 * Entrar numa empresa para dar suporte.
 *
 * O motivo é mais longo do que o das outras ações porque esta é a única que
 * dá acesso a DADO — as demais mexem em situação e senha. "Investigar" não é
 * motivo; "cliente relatou saldo negativo no Balcão" é.
 */
export const entrarParaSuporteSchema = z.object({
  motivo: motivo(15, 'Descreva o que está indo investigar, com o caso concreto'),
});
export type EntrarParaSuporte = z.infer<typeof entrarParaSuporteSchema>;

export const sessaoSuporteSchema = z.object({
  /** Token de FUNCIONÁRIO daquela empresa. Curto, e marcado como suporte. */
  tokenAcesso: z.string(),
  expiraEm: z.string(),
  empresa: z.object({ id: z.string(), nome: z.string(), slug: z.string() }),
  /** Em nome de quem a sessão foi aberta — o admin da empresa. */
  comoUsuario: z.object({ id: z.string(), nome: z.string() }),
});
export type SessaoSuporte = z.infer<typeof sessaoSuporteSchema>;

export const filtroEmpresasSchema = z.object({
  status: statusEmpresaSchema.optional(),
  busca: z.string().trim().max(120).optional(),
  de: dia.optional(),
  ate: dia.optional(),
});
export type FiltroEmpresas = z.infer<typeof filtroEmpresasSchema>;
