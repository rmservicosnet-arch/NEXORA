/**
 * Seed de desenvolvimento.
 *
 *   npm run db:seed
 *
 * Cria o catálogo global de permissões e uma empresa de demonstração com
 * dados coerentes — os mesmos que aparecem nas telas do canvas.
 *
 * Roda com o `estoque_migrator`, que tem BYPASSRLS. É a única identidade que
 * consegue escrever em várias empresas, e existe justamente para isto.
 *
 * O razão de estoque é calculado com `@estoque/core`, não escrito à mão.
 * Assim os dados de demonstração obedecem à mesma política de custo médio que
 * a aplicação — se a política mudar, o seed muda junto.
 */

import {
  aplicarEntrada,
  aplicarSaida,
  dec,
  posicaoVazia,
  proximaPosicao,
  type Posicao,
  type ResultadoMovimento,
} from '@estoque/core';

import { criarPrisma, type PrismaClient } from '../src/client';
import { gerarHashSenha } from '../src/senha';
import { PERFIS, PERMISSOES } from './permissoes';

const SLUG_DEMO = 'loja-centro';
const SENHA_DEMO = 'Estoque@2026';
const SENHA_CLIENTE = 'Cliente@2026';

function passo(texto: string): void {
  console.log(`  · ${texto}`);
}

// ---------------------------------------------------------------------------
// Razão de estoque calculado pela política real
// ---------------------------------------------------------------------------

type Lancamento =
  | {
      readonly sentido: 'ENTRADA';
      readonly tipo: TipoEntrada;
      readonly quantidade: number;
      readonly custo: string;
      readonly quando: string;
      readonly documento?: string;
    }
  | {
      readonly sentido: 'SAIDA';
      readonly tipo: TipoSaida;
      readonly quantidade: number;
      readonly quando: string;
      readonly documento?: string;
    };

type TipoEntrada = 'ENTRADA_COMPRA' | 'ENTRADA_AJUSTE' | 'ENTRADA_TRANSFERENCIA';
type TipoSaida = 'SAIDA_VENDA' | 'SAIDA_AJUSTE' | 'SAIDA_TRANSFERENCIA' | 'SAIDA_AVARIA';

async function criarRazao(
  prisma: PrismaClient,
  entrada: {
    tenantId: string;
    variacaoId: string;
    localId: string;
    atorId: string;
    lancamentos: readonly Lancamento[];
  },
): Promise<Posicao> {
  let posicao = posicaoVazia();

  for (const l of entrada.lancamentos) {
    const resultado: ResultadoMovimento =
      l.sentido === 'ENTRADA'
        ? aplicarEntrada(posicao, { quantidade: l.quantidade, custoUnitario: l.custo })
        : aplicarSaida(posicao, { quantidade: l.quantidade });

    await prisma.movimentoEstoque.create({
      data: {
        tenantId: entrada.tenantId,
        variacaoId: entrada.variacaoId,
        localId: entrada.localId,
        sentido: l.sentido,
        tipo: l.tipo,
        quantidade: dec(l.quantidade).toFixed(6),
        saldoAnterior: resultado.saldoAnterior.toFixed(6),
        saldoPosterior: resultado.saldoPosterior.toFixed(6),
        custoUnitario: resultado.custoUnitario.toFixed(6),
        custoMedioAntes: resultado.custoMedioAntes.toFixed(6),
        custoMedioDepois: resultado.custoMedioDepois.toFixed(6),
        politicaCusto: resultado.politica,
        saldoNegativo: resultado.saldoNegativo,
        documentoNumero: l.documento ?? null,
        atorTipo: 'FUNCIONARIO',
        atorId: entrada.atorId,
        criadoEm: new Date(l.quando),
      },
    });

    posicao = proximaPosicao(resultado);
  }

  await prisma.saldoEstoque.create({
    data: {
      tenantId: entrada.tenantId,
      variacaoId: entrada.variacaoId,
      localId: entrada.localId,
      quantidade: posicao.saldo.toFixed(6),
      custoMedio: posicao.custoMedio.toFixed(6),
    },
  });

  return posicao;
}

// ---------------------------------------------------------------------------
// Limpeza da empresa de demonstração
// ---------------------------------------------------------------------------

/**
 * Remove uma empresa inteira, na ordem das dependências.
 *
 * Não dá para simplesmente apagar o `tenant` e deixar o cascata resolver: o
 * razão de estoque referencia local e variação com `onDelete: Restrict`, de
 * propósito. Histórico contábil não some porque alguém apagou um cadastro.
 *
 * O banco recusar essa exclusão é o comportamento desejado — o seed é que
 * precisa ser explícito. A ordem abaixo vai das folhas para a raiz.
 */
async function limparEmpresa(prisma: PrismaClient, tenantId: string): Promise<void> {
  const onde = { where: { tenantId } };

  // O diretório de login não tem tenant_id (de propósito — ver o schema),
  // então precisa ser limpo pela empresa.
  await prisma.credencialLogin.deleteMany({ where: { empresaId: tenantId } });

  await prisma.carteiraMovimento.deleteMany(onde);
  await prisma.carteira.deleteMany(onde);

  await prisma.estoqueReserva.deleteMany(onde);
  await prisma.movimentoEstoque.deleteMany(onde);
  await prisma.saldoEstoque.deleteMany(onde);

  await prisma.pedidoEvento.deleteMany(onde);
  await prisma.pedidoItem.deleteMany(onde);
  await prisma.pedido.deleteMany(onde);

  await prisma.vendaPagamento.deleteMany(onde);
  await prisma.vendaItem.deleteMany(onde);
  await prisma.venda.deleteMany(onde);

  /*
    O caixa vem DEPOIS da venda e ANTES do usuário.

    `venda.caixa_id` aponta para cá, e `caixa.operador_id` aponta para
    `usuario` — sem esta ordem, `usuario.deleteMany` viola
    `caixa_operador_id_fkey` e o seed morre no MEIO da limpeza, com metade das
    tabelas já apagadas e nada recriado. Faltava, e quebrava toda vez que
    alguém tivesse aberto um caixa.
  */
  await prisma.movimentoCaixa.deleteMany(onde);
  await prisma.caixa.deleteMany(onde);

  await prisma.compraItem.deleteMany(onde);
  await prisma.compra.deleteMany(onde);

  await prisma.precoHistorico.deleteMany(onde);
  await prisma.precoItem.deleteMany(onde);
  await prisma.produtoImagem.deleteMany(onde);
  await prisma.variacao.deleteMany(onde);
  await prisma.produto.deleteMany(onde);
  await prisma.tabelaPreco.deleteMany(onde);
  await prisma.categoria.deleteMany(onde);
  await prisma.marca.deleteMany(onde);
  await prisma.fornecedor.deleteMany(onde);

  await prisma.clienteAcesso.deleteMany(onde);
  await prisma.cliente.deleteMany(onde);

  await prisma.sessaoRefresh.deleteMany(onde);
  await prisma.usuarioLojaAcesso.deleteMany(onde);
  await prisma.usuarioPerfil.deleteMany(onde);
  await prisma.usuario.deleteMany(onde);
  await prisma.perfilPermissao.deleteMany(onde);
  await prisma.perfil.deleteMany(onde);

  await prisma.localEstoque.deleteMany(onde);
  await prisma.loja.deleteMany(onde);

  await prisma.notificacaoPreferencia.deleteMany(onde);
  await prisma.notificacaoSaida.deleteMany(onde);
  await prisma.dispositivoPush.deleteMany(onde);
  await prisma.chaveIdempotencia.deleteMany(onde);
  await prisma.auditLog.deleteMany(onde);

  await prisma.tenantConfiguracao.deleteMany(onde);
  await prisma.tenant.delete({ where: { id: tenantId } });
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n  Seed de desenvolvimento\n');

  const url = process.env['DIRECT_URL'];
  if (!url) {
    console.error('  ✗ DIRECT_URL não definida no .env\n');
    process.exit(1);
  }

  // O seed é uma das duas coisas que rodam com o papel privilegiado.
  const prisma = await criarPrisma({ url, permitirPapelPrivilegiado: true });

  // --- Catálogo global de permissões --------------------------------------

  for (const p of PERMISSOES) {
    await prisma.permissao.upsert({
      where: { chave: p.chave },
      create: p,
      update: { grupo: p.grupo, descricao: p.descricao },
    });
  }
  passo(`${PERMISSOES.length} permissões no catálogo global`);

  // --- Empresa de demonstração --------------------------------------------

  const existente = await prisma.tenant.findUnique({ where: { slug: SLUG_DEMO } });
  if (existente) {
    await limparEmpresa(prisma, existente.id);
    passo('Empresa de demonstração anterior removida');
  }

  const tenant = await prisma.tenant.create({
    data: {
      nome: 'Loja Centro Artigos Esportivos Ltda.',
      slug: SLUG_DEMO,
      documento: '12345678000190',
      configuracao: {
        create: {
          permitirSaldoNegativo: true,
          modoCheckout: 'PEDIDO_COM_CONFIRMACAO',
          momentoCobranca: 'NO_FATURAMENTO',
          modoCaixa: 'POR_OPERADOR',
        },
      },
    },
  });
  const tenantId = tenant.id;
  passo(`Empresa criada: ${tenant.nome}`);

  // --- Perfis --------------------------------------------------------------

  const perfilPorChave = new Map<string, string>();
  for (const def of PERFIS) {
    const perfil = await prisma.perfil.create({
      data: {
        tenantId,
        chave: def.chave,
        nome: def.nome,
        descricao: def.descricao,
        sistema: true,
        permissoes: {
          create: def.permissoes.map((chave) => ({ tenantId, permissaoChave: chave })),
        },
      },
    });
    perfilPorChave.set(def.chave, perfil.id);
  }
  passo(`${PERFIS.length} perfis de sistema, com suas permissões`);

  // --- Lojas e locais ------------------------------------------------------

  const lojas = [
    { nome: 'Loja Centro', codigo: 'CENTRO' },
    { nome: 'Loja Shopping', codigo: 'SHOPPING' },
    { nome: 'Loja Norte', codigo: 'NORTE' },
  ];

  const lojaIds: string[] = [];
  const localBalcao = new Map<string, string>();
  const localDeposito = new Map<string, string>();

  for (const l of lojas) {
    const loja = await prisma.loja.create({
      data: {
        tenantId,
        nome: l.nome,
        codigo: l.codigo,
        locais: {
          create: [
            { tenantId, nome: 'Balcão', codigo: 'BALCAO', padraoVenda: true },
            { tenantId, nome: 'Depósito', codigo: 'DEPOSITO' },
          ],
        },
      },
      include: { locais: true },
    });
    lojaIds.push(loja.id);
    const balcao = loja.locais.find((x) => x.codigo === 'BALCAO');
    const deposito = loja.locais.find((x) => x.codigo === 'DEPOSITO');
    if (balcao) localBalcao.set(l.codigo, balcao.id);
    if (deposito) localDeposito.set(l.codigo, deposito.id);
  }
  passo(`${lojas.length} lojas, cada uma com Balcão e Depósito`);

  // --- Usuários ------------------------------------------------------------

  const hashPadrao = await gerarHashSenha(SENHA_DEMO);

  // `lojas` vazio significa todas. Sérgio é estoquista de uma loja só — é o
  // caso realista, e é o que dá o que testar no guard de escopo de loja.
  const usuarios: Array<{
    nome: string;
    email: string;
    perfil: string;
    lojas?: readonly string[];
  }> = [
    { nome: 'Rodrigo Bandeira', email: 'rodrigo@lojacentro.com.br', perfil: 'ADMIN_EMPRESA' },
    { nome: 'Marina Alves', email: 'marina@lojacentro.com.br', perfil: 'VENDEDOR' },
    { nome: 'Luan Pereira', email: 'luan@lojacentro.com.br', perfil: 'VENDEDOR' },
    { nome: 'Beatriz Nunes', email: 'beatriz@lojacentro.com.br', perfil: 'FINANCEIRO' },
    {
      nome: 'Sérgio Matos',
      email: 'sergio@lojacentro.com.br',
      perfil: 'ESTOQUISTA',
      lojas: ['CENTRO'],
    },
  ];

  const lojaIdPorCodigo = new Map<string, string>();
  lojas.forEach((l, i) => {
    const id = lojaIds[i];
    if (id) lojaIdPorCodigo.set(l.codigo, id);
  });

  let adminId = '';
  for (const u of usuarios) {
    const perfilId = perfilPorChave.get(u.perfil);
    const usuario = await prisma.usuario.create({
      data: {
        tenantId,
        nome: u.nome,
        email: u.email,
        senhaHash: hashPadrao,
        perfis: perfilId ? { create: [{ tenantId, perfilId }] } : undefined,
        acessosLoja: {
          create: (u.lojas
            ? u.lojas.map((c) => lojaIdPorCodigo.get(c)).filter((id): id is string => Boolean(id))
            : lojaIds
          ).map((lojaId) => ({ tenantId, lojaId })),
        },
      },
    });
    // Diretório de login: é o que permite a tela pedir só e-mail e senha.
    // Ver o comentário do model CredencialLogin no schema.
    await prisma.credencialLogin.create({
      data: {
        dominio: 'FUNCIONARIO',
        email: u.email,
        empresaId: tenantId,
        principalId: usuario.id,
      },
    });

    if (u.perfil === 'ADMIN_EMPRESA') {
      adminId = usuario.id;
    }
  }
  const restritos = usuarios.filter((u) => u.lojas).length;
  passo(
    `${usuarios.length} usuários — ${usuarios.length - restritos} com acesso a todas as lojas, ` +
      `${restritos} restrito a uma`,
  );

  // --- Tabelas de preço ----------------------------------------------------

  const tabelas = [
    { chave: 'PADRAO', nome: 'Padrão', fator: '1', padrao: true },
    { chave: 'PROFESSOR', nome: 'Professor', fator: '0.85', padrao: false },
    { chave: 'ALUNO', nome: 'Aluno', fator: '0.90', padrao: false },
    { chave: 'REVENDEDOR', nome: 'Revendedor', fator: '0.72', padrao: false },
  ];

  const tabelaIds = new Map<string, string>();
  for (const t of tabelas) {
    const criada = await prisma.tabelaPreco.create({
      data: { tenantId, chave: t.chave, nome: t.nome, padrao: t.padrao },
    });
    tabelaIds.set(t.chave, criada.id);
  }
  passo(`${tabelas.length} tabelas de preço`);

  // --- Categorias e marcas -------------------------------------------------

  const categorias = ['Kimonos', 'Faixas', 'Vestuário', 'Equipamentos', 'Acessórios'];
  const categoriaIds = new Map<string, string>();
  for (const nome of categorias) {
    const c = await prisma.categoria.create({ data: { tenantId, nome } });
    categoriaIds.set(nome, c.id);
  }

  const marcas = ['Shiai', 'Dan', 'Kiai', 'Rikan', 'Dojo Pro'];
  const marcaIds = new Map<string, string>();
  for (const nome of marcas) {
    const m = await prisma.marca.create({ data: { tenantId, nome } });
    marcaIds.set(nome, m.id);
  }
  passo(`${categorias.length} categorias e ${marcas.length} marcas`);

  // --- Produtos, variações e preços ---------------------------------------

  const produtos = [
    {
      skuBase: 'KIM-TRC',
      nome: 'Kimono Trançado Judô',
      categoria: 'Kimonos',
      marca: 'Shiai',
      variacoes: [
        {
          sku: 'KIM-TRC-A2-BR',
          descricao: 'A2 · Branco',
          preco: '489.90',
          barras: '7891000000011',
        },
        { sku: 'KIM-TRC-A3-AZ', descricao: 'A3 · Azul', preco: '529.90', barras: '7891000000028' },
      ],
    },
    {
      skuBase: 'FXA-PRT',
      nome: 'Faixa Preta Bordada',
      categoria: 'Faixas',
      marca: 'Dan',
      variacoes: [
        { sku: 'FXA-PRT-280', descricao: '280 cm', preco: '129.90', barras: '7891000000035' },
      ],
    },
    {
      skuBase: 'FXA-CLR',
      nome: 'Faixa Colorida Graduação',
      categoria: 'Faixas',
      marca: 'Dan',
      variacoes: [
        {
          sku: 'FXA-CLR-260-AZ',
          descricao: '260 cm · Azul',
          preco: '64.90',
          barras: '7891000000042',
        },
      ],
    },
    {
      skuBase: 'CAM-TRN',
      nome: 'Camiseta Treino Dry',
      categoria: 'Vestuário',
      marca: 'Kiai',
      variacoes: [
        { sku: 'CAM-TRN-M-PT', descricao: 'M · Preto', preco: '89.90', barras: '7891000000059' },
      ],
    },
    {
      skuBase: 'TAT-EVA',
      nome: 'Tatame EVA 20mm 1m²',
      categoria: 'Equipamentos',
      marca: 'Dojo Pro',
      variacoes: [
        {
          sku: 'TAT-EVA-20-AZ',
          descricao: '20 mm · Azul',
          preco: '89.90',
          barras: '7891000000066',
        },
      ],
    },
    {
      skuBase: 'PRT-BCL',
      nome: 'Protetor Bucal Moldável',
      categoria: 'Acessórios',
      marca: 'Rikan',
      variacoes: [
        { sku: 'PRT-BCL-AD', descricao: 'Adulto', preco: '39.90', barras: '7891000000073' },
      ],
    },
  ];

  const variacaoIds = new Map<string, string>();
  let totalVariacoes = 0;

  for (const p of produtos) {
    const criado = await prisma.produto.create({
      data: {
        tenantId,
        skuBase: p.skuBase,
        nome: p.nome,
        status: 'ATIVO',
        categoriaId: categoriaIds.get(p.categoria) ?? null,
        marcaId: marcaIds.get(p.marca) ?? null,
        variacoes: {
          create: p.variacoes.map((v) => ({
            tenantId,
            sku: v.sku,
            descricao: v.descricao,
            codigoBarras: v.barras,
            estoqueMinimo: '10',
          })),
        },
      },
      include: { variacoes: true },
    });

    for (const v of criado.variacoes) {
      variacaoIds.set(v.sku, v.id);
      totalVariacoes += 1;

      const base = p.variacoes.find((x) => x.sku === v.sku)?.preco ?? '0';
      for (const t of tabelas) {
        const tabelaPrecoId = tabelaIds.get(t.chave);
        if (!tabelaPrecoId) continue;
        const preco = dec(base).times(dec(t.fator)).toDecimalPlaces(2);
        await prisma.precoItem.create({
          data: { tenantId, tabelaPrecoId, variacaoId: v.id, preco: preco.toFixed(2) },
        });
      }
    }
  }
  passo(`${produtos.length} produtos, ${totalVariacoes} variações, ${totalVariacoes * 4} preços`);

  // --- Estoque, calculado pela política real -------------------------------

  const depositoCentro = localDeposito.get('CENTRO') ?? '';
  const balcaoCentro = localBalcao.get('CENTRO') ?? '';

  // O razão do tatame é o mesmo que aparece na tela "Estoque · Razão de
  // movimentações": termina em −12 com custo médio 38,40.
  const tatame = await criarRazao(prisma, {
    tenantId,
    variacaoId: variacaoIds.get('TAT-EVA-20-AZ') ?? '',
    localId: depositoCentro,
    atorId: adminId,
    lancamentos: [
      {
        sentido: 'ENTRADA',
        tipo: 'ENTRADA_COMPRA',
        quantidade: 30,
        custo: '36.00',
        quando: '2026-09-02T14:05:00Z',
        documento: 'CP-0201',
      },
      {
        sentido: 'ENTRADA',
        tipo: 'ENTRADA_COMPRA',
        quantidade: 20,
        custo: '42.00',
        quando: '2026-09-08T09:40:00Z',
        documento: 'CP-0208',
      },
      {
        sentido: 'SAIDA',
        tipo: 'SAIDA_AVARIA',
        quantidade: 3,
        quando: '2026-09-11T17:30:00Z',
        documento: 'AJ-0107',
      },
      {
        sentido: 'SAIDA',
        tipo: 'SAIDA_TRANSFERENCIA',
        quantidade: 25,
        quando: '2026-09-13T08:55:00Z',
        documento: 'TR-0044',
      },
      {
        sentido: 'SAIDA',
        tipo: 'SAIDA_VENDA',
        quantidade: 16,
        quando: '2026-09-15T10:18:00Z',
        documento: '001251',
      },
      {
        sentido: 'SAIDA',
        tipo: 'SAIDA_VENDA',
        quantidade: 4,
        quando: '2026-09-18T16:40:00Z',
        documento: '001268',
      },
      {
        sentido: 'SAIDA',
        tipo: 'SAIDA_VENDA',
        quantidade: 8,
        quando: '2026-09-19T11:05:00Z',
        documento: '001279',
      },
      {
        sentido: 'SAIDA',
        tipo: 'SAIDA_VENDA',
        quantidade: 6,
        quando: '2026-09-19T14:22:00Z',
        documento: '001284',
      },
    ],
  });

  const estoqueSimples: Array<{ sku: string; local: string; quantidade: number; custo: string }> = [
    { sku: 'KIM-TRC-A2-BR', local: depositoCentro, quantidade: 142, custo: '214.60' },
    { sku: 'KIM-TRC-A3-AZ', local: depositoCentro, quantidade: 8, custo: '231.40' },
    { sku: 'FXA-PRT-280', local: depositoCentro, quantidade: 4, custo: '58.90' },
    { sku: 'FXA-CLR-260-AZ', local: balcaoCentro, quantidade: 213, custo: '22.15' },
    { sku: 'CAM-TRN-M-PT', local: balcaoCentro, quantidade: 0, custo: '31.80' },
    { sku: 'PRT-BCL-AD', local: balcaoCentro, quantidade: 66, custo: '14.20' },
  ];

  for (const e of estoqueSimples) {
    const variacaoId = variacaoIds.get(e.sku);
    if (!variacaoId || e.quantidade === 0) {
      // Saldo zero ainda precisa de linha, para o relatório enxergar o item.
      if (variacaoId) {
        await prisma.saldoEstoque.create({
          data: { tenantId, variacaoId, localId: e.local, quantidade: '0', custoMedio: e.custo },
        });
      }
      continue;
    }
    await criarRazao(prisma, {
      tenantId,
      variacaoId,
      localId: e.local,
      atorId: adminId,
      lancamentos: [
        {
          sentido: 'ENTRADA',
          tipo: 'ENTRADA_COMPRA',
          quantidade: e.quantidade,
          custo: e.custo,
          quando: '2026-09-01T10:00:00Z',
          documento: 'CP-0190',
        },
      ],
    });
  }
  passo(
    `Estoque inicial lançado — tatame terminou em ${tatame.saldo.toString()} un a ${tatame.custoMedio.toFixed(2)}`,
  );

  // --- Fornecedores e compras ----------------------------------------------

  /*
    Compras sao a porta por onde a mercadoria entra COM CUSTO.

    Duas RECEBIDAS (o custo ja esta no razao, lancado acima) e duas em
    RASCUNHO — a fila de trabalho de verdade: mercadoria que chegou e ainda
    nao entrou no estoque. O rascunho e o unico estado editavel; depois de
    recebida, a nota mexeu no custo medio e corrigir e estornar.
  */
  const fornecedores = [
    {
      nome: 'Kimonos BR Indústria',
      documento: '12345678000190',
      email: 'comercial@kimonosbr.com.br',
      telefone: '+551133330001',
    },
    {
      nome: 'Faixas Kodokan Ltda',
      documento: '23456789000181',
      email: 'vendas@kodokan.com.br',
      telefone: '+551133330002',
    },
    {
      nome: 'Tatames Dojo Sul',
      documento: '34567890000172',
      email: 'contato@dojosul.com.br',
      telefone: '+555133330003',
    },
    {
      nome: 'Protetores Ippon Equip.',
      documento: '45678901000163',
      email: 'pedidos@ipponequip.com.br',
      telefone: '+551133330004',
    },
  ];

  const fornecedorIds = new Map<string, string>();
  for (const f of fornecedores) {
    const criado = await prisma.fornecedor.create({ data: { tenantId, ...f } });
    fornecedorIds.set(f.nome, criado.id);
  }

  const compras: {
    fornecedor: string;
    nota: string;
    emitida: string;
    status: 'RASCUNHO' | 'RECEBIDA';
    recebidaEm?: string;
    itens: { sku: string; quantidade: string; custo: string }[];
  }[] = [
    {
      fornecedor: 'Kimonos BR Indústria',
      nota: '18442',
      emitida: '2026-09-18T09:00:00Z',
      status: 'RASCUNHO',
      itens: [
        { sku: 'KIM-TRC-A2-BR', quantidade: '40', custo: '208.00' },
        { sku: 'KIM-TRC-A3-AZ', quantidade: '25', custo: '225.00' },
        { sku: 'CAM-TRN-M-PT', quantidade: '50', custo: '42.00' },
        // Saldo NEGATIVO (-12): a entrada cobre o descoberto e o custo medio
        // fica preservado ate o saldo voltar a zero. E o caso que a tela
        // precisa mostrar por escrito. docs/COST_POLICY.md
        { sku: 'TAT-EVA-20-AZ', quantidade: '30', custo: '39.90' },
      ],
    },
    {
      fornecedor: 'Faixas Kodokan Ltda',
      nota: '18440',
      emitida: '2026-09-17T14:30:00Z',
      status: 'RASCUNHO',
      itens: [
        { sku: 'FXA-PRT-280', quantidade: '12', custo: '88.00' },
        { sku: 'FXA-CLR-260-AZ', quantidade: '20', custo: '46.00' },
      ],
    },
    {
      fornecedor: 'Tatames Dojo Sul',
      nota: '18431',
      emitida: '2026-09-15T08:10:00Z',
      status: 'RECEBIDA',
      recebidaEm: '2026-09-15T15:40:00Z',
      itens: [{ sku: 'TAT-EVA-20-AZ', quantidade: '80', custo: '38.40' }],
    },
    {
      fornecedor: 'Protetores Ippon Equip.',
      nota: '18376',
      emitida: '2026-09-02T11:00:00Z',
      status: 'RECEBIDA',
      recebidaEm: '2026-09-02T17:20:00Z',
      itens: [{ sku: 'PRT-BCL-AD', quantidade: '66', custo: '14.20' }],
    },
  ];

  let comprasCriadas = 0;
  for (const c of compras) {
    const fornecedorId = fornecedorIds.get(c.fornecedor);
    if (!fornecedorId) continue;

    const itens = c.itens
      .map((i) => ({ ...i, variacaoId: variacaoIds.get(i.sku) }))
      .filter((i): i is typeof i & { variacaoId: string } => Boolean(i.variacaoId));

    if (itens.length === 0) continue;

    const total = itens.reduce(
      (soma, i) => soma.plus(dec(i.quantidade).times(dec(i.custo))),
      dec(0),
    );

    await prisma.compra.create({
      data: {
        tenantId,
        lojaId: lojaIds[0] ?? '',
        localId: depositoCentro,
        fornecedorId,
        numeroNota: c.nota,
        emitidaEm: new Date(c.emitida),
        status: c.status,
        valorTotal: total.toFixed(2),
        ...(c.recebidaEm ? { recebidaEm: new Date(c.recebidaEm), recebidaPorId: adminId } : {}),
        itens: {
          create: itens.map((i) => ({
            tenantId,
            variacaoId: i.variacaoId,
            quantidade: i.quantidade,
            custoUnitario: i.custo,
            total: dec(i.quantidade).times(dec(i.custo)).toFixed(2),
            /*
              As recebidas j\u00e1 t\u00eam o custo m\u00e9dio congelado: o raz\u00e3o delas foi
              lancado acima, com a mesma quantidade e o mesmo custo. Deixar
              nulo faria a tela dizer que a nota entrou sem mexer em nada.
            */
            ...(c.status === 'RECEBIDA'
              ? { custoMedioAntes: '0.000000', custoMedioDepois: i.custo }
              : {}),
          })),
        },
      },
    });
    comprasCriadas += 1;
  }

  passo(`${fornecedores.length} fornecedores e ${comprasCriadas} compras (2 a receber)`);

  // --- Clientes, acesso ao portal e carteira -------------------------------

  const hashCliente = await gerarHashSenha(SENHA_CLIENTE);

  const academia = await prisma.cliente.create({
    data: {
      tenantId,
      nome: 'Academia Ippon — Judô',
      documento: '98765432000155',
      email: 'contato@academiaippon.com.br',
      telefone: '+5511999990001',
      tabelaPrecoId: tabelaIds.get('PROFESSOR') ?? null,
      modoCheckout: 'PEDIDO_COM_CONFIRMACAO',
      usaCarteira: true,
      acessos: {
        create: [
          {
            tenantId,
            nome: 'Prof. Carlos Tanaka',
            email: 'carlos@academiaippon.com.br',
            senhaHash: hashCliente,
          },
        ],
      },
      carteira: {
        create: { tenantId, saldo: '0', limiteCredito: '5000.00' },
      },
    },
    include: { carteira: true, acessos: true },
  });

  for (const acesso of academia.acessos) {
    await prisma.credencialLogin.create({
      data: {
        dominio: 'CLIENTE',
        email: acesso.email,
        empresaId: tenantId,
        principalId: acesso.id,
      },
    });
  }

  await prisma.cliente.create({
    data: {
      tenantId,
      nome: 'Beatriz Nogueira',
      email: 'beatriz.nogueira@exemplo.com.br',
      tabelaPrecoId: tabelaIds.get('ALUNO') ?? null,
    },
  });

  // Extrato da carteira, com os mesmos números da tela.
  const carteiraId = academia.carteira?.id;
  if (carteiraId) {
    const LIMITE_CREDITO = dec('5000.00');

    const lancamentos = [
      {
        tipo: 'DEPOSITO',
        sentido: 'CREDITO',
        valor: '2000.00',
        doc: 'Transferência bancária',
        quando: '2026-09-02T10:12:00Z',
        justificativa: null,
      },
      {
        tipo: 'VENDA_A_PRAZO',
        sentido: 'DEBITO',
        valor: '3480.00',
        doc: 'Venda #001196',
        quando: '2026-09-05T15:48:00Z',
        justificativa: null,
      },
      {
        tipo: 'QUITACAO',
        sentido: 'CREDITO',
        valor: '1480.00',
        doc: 'Pix · E31a9f42',
        quando: '2026-09-09T09:30:00Z',
        justificativa: null,
      },
      // Este ja passa do limite: saldo vai a −5.240,00 com limite de 5.000,00.
      {
        tipo: 'VENDA_A_PRAZO',
        sentido: 'DEBITO',
        valor: '5240.00',
        doc: 'Venda #001228',
        quando: '2026-09-11T16:05:00Z',
        justificativa: 'Excedeu o limite — autorizado pelo gestor',
      },
      {
        tipo: 'DEVOLUCAO_VENDA',
        sentido: 'CREDITO',
        valor: '620.00',
        doc: 'Devolução #001228',
        quando: '2026-09-13T11:20:00Z',
        justificativa: null,
      },
      {
        tipo: 'QUITACAO',
        sentido: 'CREDITO',
        valor: '2000.00',
        doc: 'Pix · 7c04bb19',
        quando: '2026-09-15T14:02:00Z',
        justificativa: null,
      },
      {
        tipo: 'VENDA_A_PRAZO',
        sentido: 'DEBITO',
        valor: '2180.00',
        doc: 'Venda #001268',
        quando: '2026-09-17T10:44:00Z',
        justificativa: null,
      },
      // Ajuste manual: dos tipos que criam dinheiro sem contrapartida.
      // Justificativa é obrigatória — ver docs/WALLET.md §7.
      {
        tipo: 'AJUSTE_CREDITO',
        sentido: 'CREDITO',
        valor: '180.00',
        doc: 'Ajuste manual',
        quando: '2026-09-18T17:25:00Z',
        justificativa: 'Frete cobrado a mais na venda #001268',
      },
      // Idem: saldo fica em −6.560,00. Permitido com autorização, nunca silencioso.
      {
        tipo: 'VENDA_A_PRAZO',
        sentido: 'DEBITO',
        valor: '1940.00',
        doc: 'Venda #001279',
        quando: '2026-09-19T11:05:00Z',
        justificativa: 'Excedeu o limite — autorizado pelo gestor',
      },
    ] as const;

    let saldo = dec(0);
    for (const l of lancamentos) {
      const anterior = saldo;
      const valor = dec(l.valor);
      saldo = l.sentido === 'CREDITO' ? saldo.plus(valor) : saldo.minus(valor);

      // saldo + limite < 0 significa que o débito passou do que foi liberado.
      const excedeu = saldo.plus(LIMITE_CREDITO).lessThan(0);

      /*
        O seed obedece a mesma regra do serviço.

        Quem excede precisa de justificativa — e quem escreve o seed decide os
        valores um a um, sem refazer a conta de saldo de cabeça. Já passou: um
        lançamento no meio da lista excedia o limite e ninguém percebeu, porque
        o comentário dizia que só o último excedia. Mexer num valor acima
        empurra o saldo e transforma outro lançamento em excedente.
      */
      if (excedeu && !l.justificativa) {
        throw new Error(
          `Lançamento de ${l.valor} em ${l.quando} passa do limite sem justificativa.`,
        );
      }

      await prisma.carteiraMovimento.create({
        data: {
          tenantId,
          carteiraId,
          sentido: l.sentido,
          tipo: l.tipo,
          valor: valor.toFixed(2),
          saldoAnterior: anterior.toFixed(2),
          saldoPosterior: saldo.toFixed(2),
          excedeuLimite: excedeu,
          justificativa: l.justificativa,
          documento: l.doc,
          atorTipo: 'FUNCIONARIO',
          atorId: adminId,
          atorNome: 'Rodrigo Bandeira',
          criadoEm: new Date(l.quando),
        },
      });
    }

    await prisma.carteira.update({
      where: { id: carteiraId },
      data: { saldo: saldo.toFixed(2) },
    });
    passo(`Carteira da Academia Ippon — saldo ${saldo.toFixed(2)} (limite 5.000,00)`);
  }

  await prisma.$disconnect();

  console.log('\n  Pronto.\n');
  console.log('  Acesso de desenvolvimento:');
  console.log(`    funcionário   rodrigo@lojacentro.com.br   ${SENHA_DEMO}`);
  console.log(`    cliente       carlos@academiaippon.com.br ${SENHA_CLIENTE}`);
  console.log('\n  Senhas de seed. Não use nada disso fora da sua máquina.\n');
}

main().catch(async (erro: unknown) => {
  console.error('\n  ✗ Seed falhou:', erro instanceof Error ? erro.message : erro, '\n');
  process.exit(1);
});
