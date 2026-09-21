import { z } from 'zod';

/**
 * Relatorios.
 *
 * Dois construidos, de 36 no catalogo: posicao de estoque e vendas no
 * periodo. Custo e margem so viajam para quem tem `relatorio.ver_custo` — e
 * quando nao viajam, a tela nao mostra coluna vazia: ela nao mostra a coluna.
 */

// ---------------------------------------------------------------------------
// Posicao de estoque
// ---------------------------------------------------------------------------

export const filtroPosicaoSchema = z.object({
  lojaId: z.string().uuid().optional(),
  localId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  /** So o que esta negativo, ou so o que esta abaixo do minimo. */
  recorte: z.enum(['todos', 'negativos', 'abaixoDoMinimo']).default('todos'),
  limite: z.coerce.number().int().min(1).max(200).default(60),
});
export type FiltroPosicao = z.infer<typeof filtroPosicaoSchema>;

/**
 * Uma linha da posicao: a variacao NUM LOCAL.
 *
 * Dez pecas com quatro numa loja e seis em outra nao e o mesmo que dez num
 * lugar so — e quem vai transferir precisa ver por local.
 */
export const linhaPosicaoSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  categoria: z.string().nullable(),
  loja: z.string(),
  local: z.string(),
  saldo: z.string(),
  estoqueMinimo: z.string(),
  abaixoDoMinimo: z.boolean(),
  custoMedio: z.string().optional(),
  /** `saldo × custoMedio`. Negativo quando o saldo e negativo. */
  valor: z.string().optional(),
  /** A, B ou C pela participacao acumulada no valor. Nulo sem custo a vista. */
  abc: z.enum(['A', 'B', 'C']).nullable(),
});
export type LinhaPosicao = z.infer<typeof linhaPosicaoSchema>;

export const posicaoEstoqueSchema = z.object({
  /** Quando a foto foi tirada. Posicao e sempre de um instante. */
  em: z.string(),
  variacoes: z.number().int(),
  produtos: z.number().int(),
  unidades: z.string(),
  abaixoDoMinimo: z.number().int(),
  comSaldoNegativo: z.number().int(),

  /**
   * O valor do estoque, em tres numeros.
   *
   * Somar so os positivos da um patrimonio maior do que existe: o saldo
   * negativo e mercadoria que ja saiu e nao foi baixada. Ele entra com sinal.
   */
  valorPositivos: z.string().optional(),
  efeitoNegativos: z.string().optional(),
  valorLiquido: z.string().optional(),
  custoMedioDaCarteira: z.string().optional(),

  itens: z.array(linhaPosicaoSchema),
  /** Totais da PAGINA exibida, nao do relatorio inteiro. */
  totalExibido: z.object({ unidades: z.string(), valor: z.string().optional() }),
});
export type PosicaoEstoque = z.infer<typeof posicaoEstoqueSchema>;

// ---------------------------------------------------------------------------
// Vendas no periodo
// ---------------------------------------------------------------------------

export const dimensaoVendasSchema = z.enum([
  'vendedor',
  'produto',
  'cliente',
  'tabela',
  'categoria',
]);
export type DimensaoVendas = z.infer<typeof dimensaoVendasSchema>;

export const filtroVendasRelatorioSchema = z.object({
  /** Dias para tras a partir de hoje. */
  dias: z.coerce.number().int().min(1).max(365).default(14),
  lojaId: z.string().uuid().optional(),
  dimensao: dimensaoVendasSchema.default('vendedor'),
});
export type FiltroVendasRelatorio = z.infer<typeof filtroVendasRelatorioSchema>;

export const linhaRankingSchema = z.object({
  nome: z.string(),
  valor: z.string(),
  /** Participacao no total do periodo, em pontos percentuais. */
  participacao: z.string(),
  quantidade: z.string(),
  /** Margem bruta em pontos percentuais. Ausente sem `relatorio.ver_custo`. */
  margem: z.string().nullable().optional(),
});
export type LinhaRanking = z.infer<typeof linhaRankingSchema>;

export const relatorioVendasSchema = z.object({
  de: z.string(),
  ate: z.string(),
  total: z.string(),
  vendas: z.number().int(),
  ticketMedio: z.string(),
  itens: z.string(),
  mediaDiaria: z.string(),
  /** Margem bruta do periodo inteiro. Ausente sem permissao de custo. */
  margem: z.string().nullable().optional(),

  porDia: z.array(z.object({ dia: z.string(), total: z.string(), vendas: z.number().int() })),
  formasPagamento: z.array(
    z.object({ forma: z.string(), total: z.string(), participacao: z.string() }),
  ),
  porLoja: z.array(z.object({ loja: z.string(), total: z.string(), participacao: z.string() })),

  dimensao: dimensaoVendasSchema,
  ranking: z.array(linhaRankingSchema),
});
export type RelatorioVendas = z.infer<typeof relatorioVendasSchema>;

// ---------------------------------------------------------------------------
// Giro, cobertura e encalhe
// ---------------------------------------------------------------------------

export const filtroGiroSchema = z.object({
  dias: z.coerce.number().int().min(7).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  /** `parado` inverte a ordem: do que menos girou para o que mais girou. */
  ordem: z.enum(['giro', 'parado']).default('giro'),
  limite: z.coerce.number().int().min(1).max(200).default(60),
});
export type FiltroGiro = z.infer<typeof filtroGiroSchema>;

export const linhaGiroSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  categoria: z.string().nullable(),
  /** Saldo somado dos locais visiveis pelo filtro. */
  saldo: z.string(),
  /** Unidades que SAIRAM por venda no periodo. */
  vendidas: z.string(),
  /** `vendidas / saldo`. Nulo quando nao ha saldo para girar. */
  giro: z.string().nullable(),
  /** Dias que o saldo cobre no ritmo do periodo. Nulo sem venda. */
  cobertura: z.string().nullable(),
  /** Dias desde o ultimo movimento. Nulo quando nunca se moveu. */
  diasParado: z.number().int().nullable(),
  /**
   * `saldo x custo medio`. NAO e "valor parado": o item pode ter girado bem.
   * O que esta parado de fato e o `valorEncalhado` do resumo.
   */
  valorEmEstoque: z.string().optional(),
});
export type LinhaGiro = z.infer<typeof linhaGiroSchema>;

export const relatorioGiroSchema = z.object({
  dias: z.number().int(),
  /** Quantas variacoes nao tiveram NENHUMA saida por venda no periodo. */
  semVenda: z.number().int(),
  /** Quantas nao tiveram movimento nenhum — encalhe de verdade. */
  semMovimento: z.number().int(),
  valorEncalhado: z.string().optional(),
  itens: z.array(linhaGiroSchema),
});
export type RelatorioGiro = z.infer<typeof relatorioGiroSchema>;

// ---------------------------------------------------------------------------
// Transferencias e inventario
// ---------------------------------------------------------------------------

export const filtroMovimentoRelatorioSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroMovimentoRelatorio = z.infer<typeof filtroMovimentoRelatorioSchema>;

export const linhaTransferenciaSchema = z.object({
  id: z.string(),
  em: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  quantidade: z.string(),
  /** A saida SEMPRE tem local. O destino e que pode nao existir ainda. */
  origem: z.string(),
  destino: z.string().nullable(),
  /** `true` quando a saida existe e a entrada ainda nao. */
  emTransito: z.boolean(),
  ator: z.string().nullable(),
});
export type LinhaTransferencia = z.infer<typeof linhaTransferenciaSchema>;

export const relatorioTransferenciasSchema = z.object({
  dias: z.number().int(),
  enviadas: z.number().int(),
  recebidas: z.number().int(),
  emTransito: z.number().int(),
  itens: z.array(linhaTransferenciaSchema),
});
export type RelatorioTransferencias = z.infer<typeof relatorioTransferenciasSchema>;

export const linhaInventarioSchema = z.object({
  id: z.string(),
  em: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  local: z.string(),
  loja: z.string(),
  /** Positiva quando o contado era MAIOR que o sistema. */
  diferenca: z.string(),
  saldoAntes: z.string(),
  saldoDepois: z.string(),
  /** Efeito no patrimonio: `diferenca × custo`. */
  valor: z.string().optional(),
  justificativa: z.string().nullable(),
  ator: z.string().nullable(),
});
export type LinhaInventario = z.infer<typeof linhaInventarioSchema>;

export const relatorioInventarioSchema = z.object({
  dias: z.number().int(),
  contagens: z.number().int(),
  sobras: z.number().int(),
  faltas: z.number().int(),
  efeitoLiquido: z.string().optional(),
  itens: z.array(linhaInventarioSchema),
});
export type RelatorioInventario = z.infer<typeof relatorioInventarioSchema>;

// ---------------------------------------------------------------------------
// Formas de pagamento
// ---------------------------------------------------------------------------

export const filtroFormasSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
});
export type FiltroFormas = z.infer<typeof filtroFormasSchema>;

export const linhaFormaSchema = z.object({
  forma: z.string(),
  total: z.string(),
  /** Participacao no total recebido, em pontos percentuais. */
  participacao: z.string(),
  pagamentos: z.number().int(),
  /** Valor medio de cada pagamento nesta forma. */
  medio: z.string(),
  /** Media ponderada de parcelas. `1.0` em quem nao parcela. */
  parcelasMedias: z.string(),
  /** `true` quando o dinheiro so entra depois da venda. */
  futuro: z.boolean(),
});
export type LinhaForma = z.infer<typeof linhaFormaSchema>;

export const linhaParcelamentoSchema = z.object({
  parcelas: z.number().int(),
  pagamentos: z.number().int(),
  total: z.string(),
  participacao: z.string(),
});
export type LinhaParcelamento = z.infer<typeof linhaParcelamentoSchema>;

export const relatorioFormasSchema = z.object({
  dias: z.number().int(),
  total: z.string(),
  /**
   * O dinheiro que ja esta na mao: dinheiro, PIX, debito, transferencia.
   *
   * Credito fica de FORA, mesmo em uma parcela: o prazo e da adquirente, e
   * este sistema ainda nao registra a data de liquidacao dela.
   */
  imediato: z.string(),
  /** Credito, boleto, prazo e carteira: entra depois da venda. */
  futuro: z.string(),
  formas: z.array(linhaFormaSchema),
  /** So do credito: em quantas vezes a loja vendeu. */
  parcelamento: z.array(linhaParcelamentoSchema),
});
export type RelatorioFormas = z.infer<typeof relatorioFormasSchema>;

// ---------------------------------------------------------------------------
// Descontos concedidos
// ---------------------------------------------------------------------------

export const filtroDescontosSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
});
export type FiltroDescontos = z.infer<typeof filtroDescontosSchema>;

export const linhaDescontoSchema = z.object({
  vendedorId: z.string(),
  vendedor: z.string(),
  vendas: z.number().int(),
  /** Quantas dessas vendas sairam com algum desconto. */
  comDesconto: z.number().int(),
  /** `preco x quantidade`, antes de qualquer desconto. */
  bruto: z.string(),
  /** Desconto de item MAIS desconto do fechamento. */
  desconto: z.string(),
  /** Acrescimo. Sem ele, dar 10% e somar 15% pareceria generosidade. */
  acrescimo: z.string(),
  liquido: z.string(),
  /** `desconto / bruto`, em pontos percentuais. */
  taxa: z.string(),
  /** A venda com o maior desconto proporcional, em pontos percentuais. */
  maiorTaxa: z.string(),
});
export type LinhaDesconto = z.infer<typeof linhaDescontoSchema>;

export const relatorioDescontosSchema = z.object({
  dias: z.number().int(),
  bruto: z.string(),
  desconto: z.string(),
  acrescimo: z.string(),
  liquido: z.string(),
  taxa: z.string(),
  vendas: z.number().int(),
  comDesconto: z.number().int(),
  vendedores: z.array(linhaDescontoSchema),
});
export type RelatorioDescontos = z.infer<typeof relatorioDescontosSchema>;

// ---------------------------------------------------------------------------
// Cancelamentos e devolucoes
// ---------------------------------------------------------------------------

export const filtroCancelamentosSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroCancelamentos = z.infer<typeof filtroCancelamentosSchema>;

export const linhaCancelamentoSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  em: z.string(),
  loja: z.string(),
  vendedor: z.string(),
  cliente: z.string().nullable(),
  total: z.string(),
  motivo: z.string().nullable(),
  /**
   * Minutos entre a venda e o cancelamento.
   *
   * Cancelar em dois minutos e cancelar tres dias depois sao problemas
   * diferentes: o primeiro e digitacao, o segundo e mercadoria que voltou.
   */
  minutosAte: z.number().int(),
});
export type LinhaCancelamento = z.infer<typeof linhaCancelamentoSchema>;

export const relatorioCancelamentosSchema = z.object({
  dias: z.number().int(),
  canceladas: z.number().int(),
  concluidas: z.number().int(),
  /** Participacao das canceladas no total de vendas fechadas. */
  taxa: z.string(),
  valorCancelado: z.string(),
  /** Quantas foram canceladas em menos de 10 minutos: erro de digitacao. */
  naHora: z.number().int(),
  porMotivo: z.array(
    z.object({ motivo: z.string(), quantidade: z.number().int(), valor: z.string() }),
  ),
  /**
   * Devolucao PARCIAL de venda ainda nao existe no sistema.
   *
   * A coluna `venda_item.quantidade_devolvida` esta no banco e nenhuma tela a
   * grava. Zero aqui e ausencia de recurso, nao ausencia de devolucao — e a
   * tela diz isso em vez de mostrar um zero tranquilizador.
   */
  devolucoesRegistradas: z.number().int(),
  itens: z.array(linhaCancelamentoSchema),
});
export type RelatorioCancelamentos = z.infer<typeof relatorioCancelamentosSchema>;

// ---------------------------------------------------------------------------
// Comparativo entre lojas
// ---------------------------------------------------------------------------

export const filtroComparativoSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
});
export type FiltroComparativo = z.infer<typeof filtroComparativoSchema>;

export const linhaLojaComparadaSchema = z.object({
  lojaId: z.string(),
  loja: z.string(),
  vendas: z.number().int(),
  faturamento: z.string(),
  /** Participacao no faturamento do grupo, em pontos percentuais. */
  participacao: z.string(),
  ticketMedio: z.string(),
  itens: z.string(),
  /** Unidades por venda. Distingue ticket alto de carrinho cheio. */
  itensPorVenda: z.string(),
  /** Clientes DISTINTOS atendidos. Venda sem cliente nao conta ninguem. */
  clientes: z.number().int(),
  taxaDesconto: z.string(),
  canceladas: z.number().int(),
  taxaCancelamento: z.string(),
  /** Ausente sem `relatorio.ver_custo`. Nula quando nao ha custo a vista. */
  margem: z.string().nullable().optional(),
});
export type LinhaLojaComparada = z.infer<typeof linhaLojaComparadaSchema>;

export const relatorioComparativoSchema = z.object({
  dias: z.number().int(),
  faturamento: z.string(),
  vendas: z.number().int(),
  lojas: z.array(linhaLojaComparadaSchema),
});
export type RelatorioComparativo = z.infer<typeof relatorioComparativoSchema>;

// ---------------------------------------------------------------------------
// Pedidos: fila e tempo de confirmacao
// ---------------------------------------------------------------------------

/** A fila e AGORA. Periodo vale para o tempo de confirmacao ja medido. */
export const filtroFilaSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroFila = z.infer<typeof filtroFilaSchema>;

export const linhaFilaSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  cliente: z.string(),
  loja: z.string(),
  enviadoEm: z.string(),
  horasNaFila: z.number().int(),
  valorSolicitado: z.string(),
  itens: z.number().int(),
  /** Preco congelado no envio vence aqui. Vencido exige aceite do cliente. */
  validoAte: z.string().nullable(),
  precoVencido: z.boolean(),
  /** `true` quando o pedido espera o CLIENTE, nao a equipe. */
  esperaCliente: z.boolean(),
});
export type LinhaFila = z.infer<typeof linhaFilaSchema>;

export const relatorioFilaSchema = z.object({
  dias: z.number().int(),
  /** Aguardando a equipe, agora. */
  naFila: z.number().int(),
  valorNaFila: z.string(),
  /** Horas do pedido mais antigo ainda sem resposta. */
  maisAntigoHoras: z.number().int().nullable(),
  /** Na fila com o preco congelado ja vencido. */
  precoVencido: z.number().int(),
  /** Aguardando o CLIENTE aceitar um aumento. Fila dele, nao da equipe. */
  esperandoCliente: z.number().int(),
  /** Confirmados no periodo: e deles que sai o tempo medido. */
  confirmados: z.number().int(),
  horasMedias: z.string().nullable(),
  /** Mediana: uma confirmacao esquecida por uma semana distorce a media. */
  horasMediana: z.string().nullable(),
  faixas: z.array(z.object({ faixa: z.string(), pedidos: z.number().int(), valor: z.string() })),
  itens: z.array(linhaFilaSchema),
});
export type RelatorioFila = z.infer<typeof relatorioFilaSchema>;

// ---------------------------------------------------------------------------
// Pedidos: taxa de confirmacao
// ---------------------------------------------------------------------------

export const filtroConfirmacaoSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
});
export type FiltroConfirmacao = z.infer<typeof filtroConfirmacaoSchema>;

export const relatorioConfirmacaoSchema = z.object({
  dias: z.number().int(),
  /** Pedidos ENVIADOS na janela, qualquer que seja o desfecho. */
  enviados: z.number().int(),
  /** Os que ja tem desfecho. A taxa se mede sobre estes. */
  decididos: z.number().int(),
  /** Ainda na fila: nao sao fracasso, sao pendencia. */
  emAberto: z.number().int(),
  taxaConfirmacao: z.string(),
  valorSolicitado: z.string(),
  valorConfirmado: z.string(),
  /** Quanto do pedido virou nota: `confirmado / solicitado`. */
  aproveitamento: z.string(),
  desfechos: z.array(
    z.object({
      status: z.string(),
      pedidos: z.number().int(),
      valor: z.string(),
      participacao: z.string(),
    }),
  ),
  porLoja: z.array(
    z.object({
      loja: z.string(),
      enviados: z.number().int(),
      decididos: z.number().int(),
      confirmados: z.number().int(),
      taxa: z.string(),
      valorConfirmado: z.string(),
    }),
  ),
});
export type RelatorioConfirmacao = z.infer<typeof relatorioConfirmacaoSchema>;

// ---------------------------------------------------------------------------
// Pedidos: ruptura
// ---------------------------------------------------------------------------

export const filtroRupturaSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(60),
});
export type FiltroRuptura = z.infer<typeof filtroRupturaSchema>;

export const linhaRupturaSchema = z.object({
  variacaoId: z.string(),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  /** Quantos pedidos diferentes bateram na falta deste item. */
  pedidos: z.number().int(),
  solicitada: z.string(),
  atendida: z.string(),
  /** `solicitada - atendida`: o que o cliente pediu e nao levou. */
  naoAtendida: z.string(),
  /** `naoAtendida x preco congelado`. Venda que nao aconteceu. */
  valorPerdido: z.string(),
  /** Saldo de hoje nos locais da loja. Repor ou nao e decisao com este numero. */
  saldoAtual: z.string(),
  /** Vezes em que a equipe confirmou ACIMA do disponivel, com autorizacao. */
  confirmadoSemSaldo: z.number().int(),
});
export type LinhaRuptura = z.infer<typeof linhaRupturaSchema>;

export const relatorioRupturaSchema = z.object({
  dias: z.number().int(),
  /** Itens de pedido que a equipe nao conseguiu atender. */
  itensEmFalta: z.number().int(),
  pedidosAfetados: z.number().int(),
  valorPerdido: z.string(),
  confirmadosSemSaldo: z.number().int(),
  itens: z.array(linhaRupturaSchema),
});
export type RelatorioRuptura = z.infer<typeof relatorioRupturaSchema>;

// ---------------------------------------------------------------------------
// Pedidos: alteracoes pela equipe
// ---------------------------------------------------------------------------

export const filtroAlteracoesSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroAlteracoes = z.infer<typeof filtroAlteracoesSchema>;

export const linhaAlteracaoSchema = z.object({
  id: z.string(),
  pedidoId: z.string(),
  numero: z.number().int(),
  cliente: z.string(),
  em: z.string(),
  acao: z.enum(['INCLUSAO', 'REMOCAO']),
  sku: z.string(),
  produto: z.string(),
  descricaoVariacao: z.string(),
  quantidade: z.string(),
  valor: z.string(),
  motivo: z.string().nullable(),
  autor: z.string().nullable(),
});
export type LinhaAlteracao = z.infer<typeof linhaAlteracaoSchema>;

export const relatorioAlteracoesSchema = z.object({
  dias: z.number().int(),
  inclusoes: z.number().int(),
  remocoes: z.number().int(),
  valorIncluido: z.string(),
  valorRemovido: z.string(),
  /** Pedidos distintos que a equipe tocou. */
  pedidosTocados: z.number().int(),
  porAutor: z.array(
    z.object({
      autor: z.string(),
      inclusoes: z.number().int(),
      remocoes: z.number().int(),
      valorIncluido: z.string(),
      valorRemovido: z.string(),
      /** Remocoes sem motivo escrito. O acordo nao ficou registrado. */
      semMotivo: z.number().int(),
    }),
  ),
  itens: z.array(linhaAlteracaoSchema),
});
export type RelatorioAlteracoes = z.infer<typeof relatorioAlteracoesSchema>;

// ---------------------------------------------------------------------------
// Pedidos: aceites de cliente
// ---------------------------------------------------------------------------

export const filtroAceitesSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroAceites = z.infer<typeof filtroAceitesSchema>;

export const linhaAceiteSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  cliente: z.string(),
  loja: z.string(),
  /** Quando a edicao da equipe pediu o aceite. */
  pedidoEm: z.string(),
  valorSolicitado: z.string(),
  valorConfirmado: z.string(),
  /** Quanto o total subiu. E por isso que o aceite existe. */
  aumento: z.string(),
  resumoAlteracao: z.string().nullable(),
  desfecho: z.enum(['ACEITO', 'RECUSADO', 'PENDENTE']),
  /** Horas entre o pedido de aceite e a resposta. Nulo enquanto pendente. */
  horasAte: z.number().int().nullable(),
});
export type LinhaAceite = z.infer<typeof linhaAceiteSchema>;

export const relatorioAceitesSchema = z.object({
  dias: z.number().int(),
  pedidosDeAceite: z.number().int(),
  aceitos: z.number().int(),
  recusados: z.number().int(),
  pendentes: z.number().int(),
  /** Sobre os respondidos. Pendente nao e recusa. */
  taxaAceite: z.string(),
  aumentoAceito: z.string(),
  aumentoRecusado: z.string(),
  horasMedias: z.string().nullable(),
  itens: z.array(linhaAceiteSchema),
});
export type RelatorioAceites = z.infer<typeof relatorioAceitesSchema>;

// ---------------------------------------------------------------------------
// Carteira: saldos em aberto
// ---------------------------------------------------------------------------

/** Saldo em aberto e AGORA. Nao tem periodo. */
export const filtroAbertosSchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroAbertos = z.infer<typeof filtroAbertosSchema>;

export const linhaAbertoSchema = z.object({
  clienteId: z.string(),
  cliente: z.string(),
  /** Negativo: e divida. O sinal e do razao, nao da tela. */
  saldo: z.string(),
  limiteCredito: z.string(),
  /** `saldo + limite`. Negativo significa que ja passou do limite. */
  disponivel: z.string(),
  /** Dias desde que o saldo ficou negativo e nao voltou a zero. */
  diasNegativo: z.number().int().nullable(),
  ultimoCredito: z.string().nullable(),
  bloqueada: z.boolean(),
});
export type LinhaAberto = z.infer<typeof linhaAbertoSchema>;

export const relatorioAbertosSchema = z.object({
  devedores: z.number().int(),
  totalDevido: z.string(),
  acimaDoLimite: z.number().int(),
  bloqueadas: z.number().int(),
  faixas: z.array(z.object({ faixa: z.string(), clientes: z.number().int(), valor: z.string() })),
  itens: z.array(linhaAbertoSchema),
});
export type RelatorioAbertos = z.infer<typeof relatorioAbertosSchema>;

// ---------------------------------------------------------------------------
// Carteira: acima do limite
// ---------------------------------------------------------------------------

export const filtroLimiteSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(90),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroLimite = z.infer<typeof filtroLimiteSchema>;

export const linhaLimiteSchema = z.object({
  id: z.string(),
  em: z.string(),
  cliente: z.string(),
  tipo: z.string(),
  valor: z.string(),
  saldoPosterior: z.string(),
  limiteCredito: z.string(),
  /** Quanto o debito passou de `saldo + limite`. Sempre positivo. */
  excedeuEm: z.string(),
  justificativa: z.string().nullable(),
  autorizadoPor: z.string().nullable(),
});
export type LinhaLimite = z.infer<typeof linhaLimiteSchema>;

export const relatorioLimiteSchema = z.object({
  dias: z.number().int(),
  autorizacoes: z.number().int(),
  valorAutorizado: z.string(),
  clientesAfetados: z.number().int(),
  /** Carteiras que HOJE estao abaixo de `-limite`. Divida viva, nao historico. */
  acimaAgora: z.number().int(),
  /** Autorizacoes sem justificativa escrita. Deveriam ser zero. */
  semJustificativa: z.number().int(),
  itens: z.array(linhaLimiteSchema),
});
export type RelatorioLimite = z.infer<typeof relatorioLimiteSchema>;

// ---------------------------------------------------------------------------
// Carteira: ajustes e bonificacoes
// ---------------------------------------------------------------------------

export const filtroAjustesSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(90),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroAjustes = z.infer<typeof filtroAjustesSchema>;

export const linhaAjusteSchema = z.object({
  id: z.string(),
  em: z.string(),
  cliente: z.string(),
  tipo: z.string(),
  credito: z.boolean(),
  valor: z.string(),
  saldoPosterior: z.string(),
  justificativa: z.string().nullable(),
  autor: z.string().nullable(),
});
export type LinhaAjuste = z.infer<typeof linhaAjusteSchema>;

export const relatorioAjustesSchema = z.object({
  dias: z.number().int(),
  lancamentos: z.number().int(),
  credito: z.string(),
  debito: z.string(),
  /** `credito - debito`: dinheiro criado no periodo, com sinal. */
  liquido: z.string(),
  /** Deveria ser zero: o banco exige justificativa nestes tipos. */
  semJustificativa: z.number().int(),
  porAutor: z.array(
    z.object({
      autor: z.string(),
      lancamentos: z.number().int(),
      credito: z.string(),
      debito: z.string(),
    }),
  ),
  itens: z.array(linhaAjusteSchema),
});
export type RelatorioAjustes = z.infer<typeof relatorioAjustesSchema>;

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export const filtroTrilhaSchema = z.object({
  entidade: z.string().max(60).optional(),
  entidadeId: z.string().uuid().optional(),
  dias: z.coerce.number().int().min(1).max(365).default(90),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroTrilha = z.infer<typeof filtroTrilhaSchema>;

export const linhaTrilhaSchema = z.object({
  id: z.string(),
  em: z.string(),
  acao: z.string(),
  entidade: z.string(),
  entidadeId: z.string().nullable(),
  ator: z.string().nullable(),
  atorTipo: z.string(),
  motivo: z.string().nullable(),
  ip: z.string().nullable(),
  /** O que mudou, campo a campo. So os campos que de fato mudaram. */
  mudancas: z.array(z.object({ campo: z.string(), antes: z.string(), depois: z.string() })),
});
export type LinhaTrilha = z.infer<typeof linhaTrilhaSchema>;

export const relatorioTrilhaSchema = z.object({
  dias: z.number().int(),
  entidade: z.string().nullable(),
  entidadeId: z.string().nullable(),
  registros: z.number().int(),
  /** As entidades com registro no periodo, para escolher sem decorar nomes. */
  entidades: z.array(z.object({ entidade: z.string(), registros: z.number().int() })),
  itens: z.array(linhaTrilhaSchema),
});
export type RelatorioTrilha = z.infer<typeof relatorioTrilhaSchema>;

export const filtroSensiveisSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  acao: z.string().max(80).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroSensiveis = z.infer<typeof filtroSensiveisSchema>;

export const relatorioSensiveisSchema = z.object({
  dias: z.number().int(),
  registros: z.number().int(),
  atores: z.number().int(),
  /** Acoes sensiveis sem motivo escrito. */
  semMotivo: z.number().int(),
  porAcao: z.array(z.object({ acao: z.string(), registros: z.number().int() })),
  porAtor: z.array(
    z.object({ ator: z.string(), registros: z.number().int(), semMotivo: z.number().int() }),
  ),
  itens: z.array(linhaTrilhaSchema),
});
export type RelatorioSensiveis = z.infer<typeof relatorioSensiveisSchema>;

export const filtroAcessosSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroAcessos = z.infer<typeof filtroAcessosSchema>;

export const linhaAcessoSchema = z.object({
  id: z.string(),
  em: z.string(),
  acao: z.string(),
  ator: z.string().nullable(),
  ip: z.string().nullable(),
  /** Nome do relatorio exportado, quando a acao e exportacao. */
  relatorio: z.string().nullable(),
  linhas: z.number().int().nullable(),
  /** `true` quando as colunas exportadas incluiam custo, valor ou margem. */
  comCusto: z.boolean(),
});
export type LinhaAcesso = z.infer<typeof linhaAcessoSchema>;

export const relatorioAcessosSchema = z.object({
  dias: z.number().int(),
  exportacoes: z.number().int(),
  /** Exportacoes cujas colunas traziam custo, valor ou margem. */
  comCusto: z.number().int(),
  linhasExportadas: z.number().int(),
  /** Tentativas de ler dado de outra empresa. Deveria ser zero. */
  crossTenant: z.number().int(),
  /** Reuso de refresh: sinal de token roubado ou de aba fora de sincronia. */
  reusoDeToken: z.number().int(),
  porAtor: z.array(
    z.object({ ator: z.string(), exportacoes: z.number().int(), comCusto: z.number().int() }),
  ),
  itens: z.array(linhaAcessoSchema),
});
export type RelatorioAcessos = z.infer<typeof relatorioAcessosSchema>;

/** O que a tela manda ao servidor quando alguem baixa um CSV. */
export const registroExportacaoSchema = z.object({
  relatorio: z.string().min(1).max(80),
  colunas: z.array(z.string().max(60)).max(60),
  linhas: z.number().int().min(0).max(1_000_000),
});
export type RegistroExportacao = z.infer<typeof registroExportacaoSchema>;

// ---------------------------------------------------------------------------
// Fechamento de caixa
// ---------------------------------------------------------------------------

export const filtroFechamentosSchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
  lojaId: z.string().uuid().optional(),
  /** So os que fecharam com diferenca. E nesses que alguem precisa olhar. */
  apenasComDiferenca: z.coerce.boolean().default(false),
  limite: z.coerce.number().int().min(1).max(200).default(80),
});
export type FiltroFechamentos = z.infer<typeof filtroFechamentosSchema>;

export const linhaFechamentoSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  loja: z.string(),
  operador: z.string(),
  abertoEm: z.string(),
  fechadoEm: z.string().nullable(),
  status: z.string(),
  valorAbertura: z.string(),
  valorEsperado: z.string().nullable(),
  valorContado: z.string().nullable(),
  /** `contado - esperado`. Negativo e falta, positivo e sobra. */
  diferenca: z.string().nullable(),
  conferidoPor: z.string().nullable(),
  observacao: z.string().nullable(),
});
export type LinhaFechamento = z.infer<typeof linhaFechamentoSchema>;

export const relatorioFechamentosSchema = z.object({
  dias: z.number().int(),
  fechados: z.number().int(),
  conferidos: z.number().int(),
  /** Ainda abertos agora. Nao entram na conta de diferenca. */
  abertos: z.number().int(),
  comDiferenca: z.number().int(),
  /**
   * Faltas e sobras contadas separadamente.
   *
   * Somadas, R$ 200 de falta e R$ 200 de sobra dariam zero numa loja onde
   * dois operadores erram todo dia em direcoes opostas.
   */
  faltas: z.string(),
  sobras: z.string(),
  /** Sem conferencia o fechamento fica sem segunda assinatura. */
  semConferencia: z.number().int(),
  itens: z.array(linhaFechamentoSchema),
});
export type RelatorioFechamentos = z.infer<typeof relatorioFechamentosSchema>;
