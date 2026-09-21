/**
 * Cria — ou reativa — um administrador da PLATAFORMA.
 *
 * Existe porque há um ovo e uma galinha: a tela de plataforma é quem cria
 * empresas, e para entrar nela alguém precisa existir antes. O seed também
 * cria um, mas o seed **apaga a empresa de demonstração** antes de recriar,
 * e não se roda um comando destrutivo só para admitir um administrador.
 *
 *   npm run plataforma:admin -- "Rodrigo Bandeira" rodrigo@exemplo.com
 *
 * A senha é GERADA aqui e mostrada uma única vez. Quem cadastra não digita
 * senha de terceiro, e poder mostrar de novo significaria ter guardado.
 *
 * Roda com `DIRECT_URL` (o papel migrator) porque `plataforma_admin` é
 * tabela de plataforma: não tem `tenant_id`, não está sob RLS, e não há
 * contexto de empresa nenhum para abrir.
 */

import { randomInt } from 'node:crypto';

import { conferirSenha, criarPrisma, gerarHashSenha } from '../packages/db/src';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function gerarSenha(tamanho = 16): string {
  let senha = '';
  for (let i = 0; i < tamanho; i += 1) {
    senha += ALFABETO[randomInt(ALFABETO.length)];
  }
  return senha;
}

async function principal(): Promise<void> {
  /*
    O `npm run` come as aspas: `-- "Rodrigo Bandeira" x@y` chega como tres
    argumentos. O e-mail e o ULTIMO; o nome e tudo antes dele. Exigir aspas
    que o npm remove seria pedir o impossivel a quem digita.
  */
  const argumentos = process.argv.slice(2);
  const email = argumentos.at(-1);
  const nome = argumentos.slice(0, -1).join(' ').trim();

  if (!nome || !email || !email.includes('@')) {
    console.error('Uso: npm run plataforma:admin -- "Nome Completo" email@dominio.com');
    process.exitCode = 1;
    return;
  }

  const url = process.env['DIRECT_URL'];
  if (!url) {
    console.error('DIRECT_URL é obrigatória.');
    process.exitCode = 1;
    return;
  }

  // `criarPrisma` devolve uma Promise: o cliente so existe depois da
  // conferencia do papel.
  const prisma = await criarPrisma({ url, permitirPapelPrivilegiado: true });

  try {
    const alvo = email.trim().toLowerCase();
    const senha = gerarSenha();
    const senhaHash = await gerarHashSenha(senha);

    const existente = await prisma.plataformaAdmin.findUnique({ where: { email: alvo } });

    if (existente) {
      await prisma.plataformaAdmin.update({
        where: { id: existente.id },
        data: { nome, senhaHash, status: 'ATIVO' },
      });
      // Redefinir senha derruba a sessão: redefine-se porque a senha pode ter
      // vazado, e a sessão aberta sobreviveria à troca.
      const { count } = await prisma.plataformaSessao.updateMany({
        where: { adminId: existente.id, revogadoEm: null },
        data: { revogadoEm: new Date(), motivoRevogacao: 'SENHA_REDEFINIDA' },
      });
      console.log(`\nAdministrador de plataforma ATUALIZADO: ${nome} <${alvo}>`);
      console.log(`Sessões derrubadas: ${String(count)}`);
    } else {
      await prisma.plataformaAdmin.create({ data: { nome, email: alvo, senhaHash } });
      console.log(`\nAdministrador de plataforma CRIADO: ${nome} <${alvo}>`);
    }

    /*
      Relê do banco e CONFERE antes de imprimir.

      Sem isto o comando anunciava uma senha sem nenhuma prova de que ela
      abria a porta — e anunciou uma que não abria. Só se descobriu quando
      alguém tentou entrar. Comando que entrega credencial prova a credencial
      que entrega, pelo mesmo caminho que o login vai percorrer.
    */
    const gravado = await prisma.plataformaAdmin.findUnique({ where: { email: alvo } });
    if (!gravado || !(await conferirSenha(gravado.senhaHash, senha))) {
      console.error('\n  A senha gerada NAO confere com o hash gravado. Nada foi anunciado.');
      console.error('  Rode de novo; se repetir, o defeito esta na gravacao, nao na senha.\n');
      process.exitCode = 1;
      return;
    }

    console.log('\n  Senha (aparece uma vez só, conferida contra o hash gravado):');
    console.log(`  ${senha}\n`);
    console.log('  Entre em /plataforma/login. O domínio é outro: esta senha não');
    console.log('  serve em nenhuma empresa, e a de empresa não serve aqui.\n');
  } finally {
    await prisma.$disconnect();
  }
}

void principal();
