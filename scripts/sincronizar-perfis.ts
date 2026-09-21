/**
 * Ressincroniza perfis e permissoes a partir de `permissoes.ts`.
 *
 *   npm run db:sync-perfis
 *
 * Existe porque perfil muda com o tempo — e a unica forma de aplicar a mudanca
 * era rodar o seed inteiro, que APAGA os dados da empresa. Ninguem faz isso num
 * banco com movimento, entao na pratica a correcao de permissao nunca chegava.
 *
 * O que este script toca:
 *   - cria permissoes novas que passaram a existir;
 *   - cria perfis novos;
 *   - acerta o vinculo perfil→permissao para bater com o codigo.
 *
 * O que ele NAO toca, nunca:
 *   - dados de negocio (produtos, vendas, estoque, carteira);
 *   - o vinculo usuario→perfil (quem tem qual perfil continua igual);
 *   - perfis que existem no banco e nao existem mais no codigo — eles ficam,
 *     porque podem ter usuarios ligados. Apagar seria tirar o acesso de alguem
 *     sem aviso.
 */

import { criarPrisma } from '../packages/db/src/client';
import { comEscopo } from '../packages/db/src/escopo';
import { contextoDeSistema } from '../packages/db/src/contexto';
import { PERMISSOES, PERFIS } from '../packages/db/src/permissoes';

async function main(): Promise<void> {
  const url = process.env['DIRECT_URL'];
  if (!url) {
    throw new Error('DIRECT_URL nao definida.');
  }

  const prisma = criarPrisma({ url, permitirPapelPrivilegiado: true });

  try {
    const cliente = await prisma;
    const tenants = await cliente.tenant.findMany({ select: { id: true, nome: true } });

    for (const tenant of tenants) {
      console.log(`\n  ${tenant.nome}`);

      await comEscopo(cliente, contextoDeSistema(tenant.id), async (tx) => {
        // 1. Permissoes que passaram a existir.
        //
        // `permissao` e catalogo GLOBAL: a chave e a PK e nao ha `tenant_id`.
        // A lista de permissoes e do sistema, nao da empresa — o que varia por
        // empresa e quem tem cada uma.
        let novas = 0;
        for (const p of PERMISSOES) {
          const existe = await tx.permissao.findUnique({ where: { chave: p.chave } });
          if (!existe) {
            await tx.permissao.create({
              data: { chave: p.chave, grupo: p.grupo, descricao: p.descricao },
            });
            novas += 1;
          }
        }
        if (novas > 0) {
          console.log(`    + ${novas} permissao(oes) nova(s)`);
        }

        // 2. Perfis.
        for (const def of PERFIS) {
          let perfil = await tx.perfil.findFirst({ where: { chave: def.chave } });

          if (!perfil) {
            perfil = await tx.perfil.create({
              data: {
                tenantId: tenant.id,
                chave: def.chave,
                nome: def.nome,
                descricao: def.descricao,
              },
            });
            console.log(`    + perfil ${def.chave}`);
          }

          const atuais = await tx.perfilPermissao.findMany({
            where: { perfilId: perfil.id },
            select: { permissaoChave: true },
          });

          const temAgora = new Set(atuais.map((a) => a.permissaoChave));
          const deveTer = new Set(def.permissoes);

          const aAdicionar = [...deveTer].filter((c) => !temAgora.has(c));
          const aRemover = atuais.map((a) => a.permissaoChave).filter((c) => !deveTer.has(c));

          for (const permissaoChave of aAdicionar) {
            await tx.perfilPermissao.create({
              data: { tenantId: tenant.id, perfilId: perfil.id, permissaoChave },
            });
          }

          for (const permissaoChave of aRemover) {
            await tx.perfilPermissao.delete({
              where: { perfilId_permissaoChave: { perfilId: perfil.id, permissaoChave } },
            });
          }

          if (aAdicionar.length > 0 || aRemover.length > 0) {
            console.log(
              `    ${def.chave}: +${aAdicionar.length} -${aRemover.length}` +
                (aRemover.length > 0 ? `  (retiradas: ${aRemover.join(', ')})` : ''),
            );
          }
        }
      });
    }

    console.log('\n  Pronto. Nenhum dado de negocio foi tocado.\n');
  } finally {
    const cliente = await prisma;
    await cliente.$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
