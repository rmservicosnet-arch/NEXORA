import {
  type CaixaAtual,
  type Cliente,
  type ContextoPdv,
  type FormaPagamento,
  type ItemParaVenda,
  type PaginaClientes,
  type ResultadoVenda,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando } from '../ui/Estados';
import { Foto } from '../ui/Foto';
import { juntar } from '../ui/juntar';

interface LinhaCarrinho {
  readonly variacaoId: string;
  readonly sku: string;
  readonly produto: string;
  readonly descricaoVariacao: string;
  readonly imagemPrincipalId: string | null;
  /** `null` quando o item nao tem preco na tabela escolhida. */
  precoTabela: string | null;
  quantidade: number;
  /** Preenchido só quando o operador digita outro preço. */
  precoManual: string | null;
  readonly saldo: number;
}

interface LinhaPagamento {
  readonly chave: number;
  forma: FormaPagamento;
  valor: string;
  /** Só o crédito parcela. A API aceita de 1 a 36. */
  parcelas: number;
}

const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'DEBITO', rotulo: 'Débito' },
  { valor: 'CREDITO', rotulo: 'Crédito' },
  { valor: 'TRANSFERENCIA', rotulo: 'Transferência' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'PRAZO', rotulo: 'A prazo' },
  { valor: 'CARTEIRA', rotulo: 'Carteira' },
];

/** Quantos achados a busca mostra de uma vez. */
const NA_BUSCA = 15;

/** Parcelas possíveis no crédito. A API aceita 36; o balcão não passa de 12. */
const PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Reparte o valor em parcelas iguais, com a sobra na primeira.
 *
 * Dividir 489,90 por 10 dá 48,99 redondo; 100,00 por 3 não dá. Jogar a
 * diferença fora faria a soma das parcelas não bater com o total — e é a
 * soma que o cliente confere no extrato.
 */
function parcelaDe(total: number, parcelas: number): { primeira: number; demais: number } {
  const centavos = Math.trunc(total * 100 + 0.5);
  const base = Math.trunc(centavos / parcelas);
  const sobra = centavos - base * parcelas;
  return { primeira: (base + sobra) / 100, demais: base / 100 };
}

function brl(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function iniciais(nome: string): string {
  const partes = nome.split(' ').filter((p) => p.length > 1);
  return `${partes[0]?.[0] ?? '?'}${partes[1]?.[0] ?? ''}`.toUpperCase();
}

export function Pdv() {
  const fila = useQueryClient();
  const { usuario } = useSessao();
  const campoBusca = useRef<HTMLInputElement>(null);
  const campoDesconto = useRef<HTMLInputElement>(null);
  const campoCliente = useRef<HTMLInputElement>(null);

  const [lojaId, setLojaId] = useState('');
  const [tabelaPrecoId, setTabelaPrecoId] = useState('');
  const [termo, setTermo] = useState('');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [desconto, setDesconto] = useState('');
  const [pagamentos, setPagamentos] = useState<LinhaPagamento[]>([
    { chave: 1, forma: 'DINHEIRO', valor: '', parcelas: 1 },
  ]);
  const [erro, setErro] = useState<string | null>(null);
  const [concluida, setConcluida] = useState<ResultadoVenda | null>(null);

  /**
   * O cliente da venda.
   *
   * A API sempre aceitou `clienteId` e nenhuma tela mandava — o que deixava
   * a forma CARTEIRA inalcançável e a tabela do cliente sem efeito no balcão.
   */
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [painelCliente, setPainelCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState('');

  const [agora, setAgora] = useState(() => new Date());
  const [reprecando, setReprecando] = useState(false);
  const [maisFormas, setMaisFormas] = useState(false);

  const contexto = useQuery({
    queryKey: ['pdv', 'contexto'],
    queryFn: () => pedir<ContextoPdv>('/vendas/contexto'),
    staleTime: 5 * 60_000,
  });

  // Uma loja só: não faz o operador escolher o óbvio toda vez que abre o caixa.
  useEffect(() => {
    const lojas = contexto.data?.lojas ?? [];
    if (!lojaId && lojas.length > 0) {
      setLojaId(lojas[0]!.id);
    }
  }, [contexto.data, lojaId]);

  useEffect(() => {
    campoBusca.current?.focus();
  }, [concluida]);

  // O relógio do cabeçalho. Meio minuto basta: ninguém lê segundos no balcão.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // O caixa é perguntado na abertura da tela, não no fechamento da venda.
  // Descobrir que o caixa está fechado depois de montar o carrinho inteiro é
  // fazer o cliente esperar por uma informação que já existia.
  const caixa = useQuery({
    queryKey: ['caixa', 'meu', lojaId],
    queryFn: () => pedir<CaixaAtual>(`/caixa/meu?lojaId=${lojaId}`),
    enabled: Boolean(lojaId),
  });

  const caixaAberto = caixa.data?.caixa ?? null;

  const busca = useQuery({
    queryKey: ['pdv', 'itens', termo, lojaId, tabelaPrecoId],
    queryFn: () => {
      const p = new URLSearchParams({ termo, lojaId, limite: String(NA_BUSCA) });
      if (tabelaPrecoId) p.set('tabelaPrecoId', tabelaPrecoId);
      return pedir<ItemParaVenda[]>(`/vendas/itens?${p.toString()}`);
    },
    enabled: Boolean(lojaId) && termo.trim().length >= 2,
  });

  const clientes = useQuery({
    queryKey: ['pdv', 'clientes', buscaCliente],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '10', status: 'ATIVO' });
      if (buscaCliente.trim()) p.set('busca', buscaCliente.trim());
      return pedir<PaginaClientes>(`/clientes?${p.toString()}`);
    },
    enabled: painelCliente,
  });

  // Código de barras lido: entra no carrinho e o campo se limpa sozinho, pronto
  // para a próxima leitura. É o ritmo do balcão — uma peça por bipe.
  useEffect(() => {
    const achados = busca.data;
    if (achados?.length === 1 && achados[0]?.casouCodigoBarras) {
      adicionar(achados[0]);
      setTermo('');
    }
    // Depende só do resultado da busca: `adicionar` lê o carrinho pelo
    // atualizador do `setState`, então não precisa entrar aqui.
  }, [busca.data]);

  /**
   * Trocar a tabela reprecifica o que ja esta no carrinho.
   *
   * O preco da linha e capturado no momento em que o item entra. Sem isto, a
   * tela mostraria o preco da tabela ANTIGA e o servidor gravaria o da nova —
   * a mesma armadilha do pedido, onde a tela dizia R$ 129,90 e o banco
   * recebia R$ 110,42.
   */
  const carrinhoRef = useRef(carrinho);
  carrinhoRef.current = carrinho;

  useEffect(() => {
    const linhas = carrinhoRef.current;
    if (linhas.length === 0 || !lojaId) return;

    let cancelado = false;
    setReprecando(true);

    void Promise.all(
      linhas.map(async (l) => {
        const p = new URLSearchParams({ termo: l.sku, lojaId, limite: '1' });
        if (tabelaPrecoId) p.set('tabelaPrecoId', tabelaPrecoId);
        const achados = await pedir<ItemParaVenda[]>(`/vendas/itens?${p.toString()}`);
        return { ...l, precoTabela: achados[0]?.preco ?? null };
      }),
    )
      .then((atualizadas) => {
        if (!cancelado) setCarrinho(atualizadas);
      })
      .finally(() => {
        if (!cancelado) setReprecando(false);
      });

    return () => {
      cancelado = true;
    };
    // O carrinho entra pela ref de proposito: inclui-lo aqui faria o efeito
    // se disparar a cada item adicionado, reprecificando sem motivo.
  }, [tabelaPrecoId, lojaId]);

  function adicionar(item: ItemParaVenda) {
    setErro(null);

    if (item.preco === null) {
      setErro(`${item.sku} não tem preço na tabela escolhida.`);
      return;
    }

    setCarrinho((atual) => {
      const existente = atual.find((l) => l.variacaoId === item.variacaoId);

      // Bipar a mesma peça duas vezes soma, não duplica a linha.
      if (existente) {
        return atual.map((l) =>
          l.variacaoId === item.variacaoId ? { ...l, quantidade: l.quantidade + 1 } : l,
        );
      }

      return [
        ...atual,
        {
          variacaoId: item.variacaoId,
          sku: item.sku,
          produto: item.produto,
          descricaoVariacao: item.descricaoVariacao,
          imagemPrincipalId: item.imagemPrincipalId,
          precoTabela: item.preco ?? '0',
          quantidade: 1,
          precoManual: null,
          saldo: Number(item.saldo),
        },
      ];
    });
  }

  function alterar(variacaoId: string, mudanca: Partial<LinhaCarrinho>) {
    setCarrinho((atual) =>
      atual.map((l) => (l.variacaoId === variacaoId ? { ...l, ...mudanca } : l)),
    );
  }

  function limparVenda() {
    setCarrinho([]);
    setDesconto('');
    setErro(null);
  }

  const totais = useMemo(() => {
    let subtotal = 0;
    for (const l of carrinho) {
      subtotal += l.quantidade * Number(l.precoManual ?? l.precoTabela ?? 0);
    }
    const abatimento = Number(desconto || 0);
    const total = Math.max(0, subtotal - abatimento);

    let recebido = 0;
    let emDinheiro = 0;
    for (const p of pagamentos) {
      const v = Number(p.valor || 0);
      recebido += v;
      if (p.forma === 'DINHEIRO') emDinheiro += v;
    }

    return {
      subtotal,
      total,
      recebido,
      emDinheiro,
      falta: Math.max(0, total - recebido),
      troco: Math.max(0, recebido - total),
    };
  }, [carrinho, desconto, pagamentos]);

  const finalizar = useMutation({
    mutationFn: () =>
      pedir<ResultadoVenda>('/vendas', {
        method: 'POST',
        body: {
          lojaId,
          ...(cliente ? { clienteId: cliente.id } : {}),
          ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
          itens: carrinho.map((l) => ({
            variacaoId: l.variacaoId,
            quantidade: String(l.quantidade),
            ...(l.precoManual ? { precoUnitario: l.precoManual } : {}),
          })),
          ...(Number(desconto || 0) > 0 ? { desconto: Number(desconto).toFixed(2) } : {}),
          pagamentos: pagamentos
            .filter((p) => Number(p.valor || 0) > 0)
            .map((p) => ({
              forma: p.forma,
              valor: Number(p.valor).toFixed(2),
              // Parcela só existe no crédito; nas outras formas mandar outro
              // número seria gravar uma condição que não foi combinada.
              parcelas: p.forma === 'CREDITO' ? p.parcelas : 1,
            })),
        },
      }),
    onSuccess: async (resultado) => {
      setConcluida(resultado);
      setCarrinho([]);
      setDesconto('');
      setPagamentos([{ chave: 1, forma: 'DINHEIRO', valor: '', parcelas: 1 }]);
      setMaisFormas(false);
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['estoque'] });
      await fila.invalidateQueries({ queryKey: ['produtos'] });
      // Venda em dinheiro muda o esperado na gaveta. Sem isto, o selo do
      // cabeçalho continuaria mostrando o valor de antes da venda.
      await fila.invalidateQueries({ queryKey: ['caixa'] });
      // A venda a prazo ou em carteira mexe na conta do cliente.
      await fila.invalidateQueries({ queryKey: ['carteiras'] });
    },
    onError: (e) => {
      setConcluida(null);
      setErro(
        e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir a venda.',
      );
    },
  });

  /** Item sem preco na tabela escolhida: o servidor recusaria com ITEM_SEM_PRECO. */
  const semPreco = carrinho.some((l) => l.precoManual === null && l.precoTabela === null);

  const podeFinalizar =
    carrinho.length > 0 &&
    totais.falta === 0 &&
    totais.total > 0 &&
    !semPreco &&
    !reprecando &&
    !finalizar.isPending;

  const tabelas = contexto.data?.tabelas ?? [];
  const podeDarDesconto = contexto.data?.podeDarDesconto ?? false;

  /**
   * As teclas que o desenho anuncia.
   *
   * Desenhar F2 no campo e não ligar a tecla é pior do que não desenhar: quem
   * confia no atalho aperta e não acontece nada.
   */
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault();
        campoBusca.current?.focus();
        campoBusca.current?.select();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setPainelCliente(true);
        setTimeout(() => campoCliente.current?.focus(), 0);
      }
      if (e.key === 'F6' && tabelas.length > 0) {
        e.preventDefault();
        const ordem = ['', ...tabelas.filter((t) => !t.padrao).map((t) => t.id)];
        const atual = ordem.indexOf(tabelaPrecoId);
        setTabelaPrecoId(ordem[(atual + 1) % ordem.length] ?? '');
      }
      if (e.key === 'F8' && podeDarDesconto) {
        e.preventDefault();
        campoDesconto.current?.focus();
        campoDesconto.current?.select();
      }
      if (e.key === 'F9' && podeFinalizar) {
        e.preventDefault();
        finalizar.mutate();
      }
    }

    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [tabelas, tabelaPrecoId, podeDarDesconto, podeFinalizar, finalizar]);

  if (contexto.isPending) {
    return <EstadoCarregando titulo="Abrindo o PDV…" />;
  }

  const lojas = contexto.data?.lojas ?? [];
  const lojaAtual = lojas.find((l) => l.id === lojaId);
  const itens = busca.data ?? [];

  /** Escolher a forma preenche o que falta — é o gesto do balcão. */
  function escolherForma(forma: FormaPagamento) {
    setPagamentos((atuais) => {
      const primeira = atuais[0];
      if (!primeira) return atuais;
      const outras = atuais.slice(1).reduce((s, p) => s + Number(p.valor || 0), 0);
      const restante = Math.max(0, totais.total - outras);
      return [
        {
          ...primeira,
          forma,
          valor: restante > 0 ? restante.toFixed(2) : '',
          parcelas: forma === 'CREDITO' ? primeira.parcelas : 1,
        },
        ...atuais.slice(1),
      ];
    });
  }

  return (
    <div className="flex h-dvh flex-col bg-neutral-25">
      {/*
        O PDV ocupa a tela inteira, sem o menu lateral. É o desenho, e é o
        certo: quem está no balcão não navega o sistema — vende, e sai daqui
        por uma porta só.
      */}
      <header className="flex min-h-[54px] shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 bg-primary-800 px-4 py-2">
        <Link
          to="/"
          className="flex h-[34px] items-center gap-2 rounded-md bg-primary-700 px-3 text-[13px] font-medium text-primary-100 no-underline hover:text-white"
        >
          <SetaEsquerda />
          Sair do PDV
        </Link>

        <span className="hidden h-6 w-px bg-primary-500 sm:block" />

        <span className="flex items-center gap-2">
          <span className="text-primary-300">
            <Casa />
          </span>
          {lojas.length > 1 ? (
            <select
              value={lojaId}
              onChange={(e) => setLojaId(e.target.value)}
              aria-label="Loja"
              className="h-[30px] rounded-md border border-primary-500 bg-primary-700 px-2 text-[13.5px] font-medium text-white"
            >
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[13.5px] font-medium text-white">{lojaAtual?.nome ?? '—'}</span>
          )}
          {lojaAtual?.localPadrao ? (
            <span className="text-[13px] text-primary-300">/ {lojaAtual.localPadrao}</span>
          ) : null}
        </span>

        <span className="hidden h-6 w-px bg-primary-500 sm:block" />

        <span className="flex items-center gap-2">
          <span className="flex size-[25px] items-center justify-center rounded bg-primary-500 text-[10.5px] font-semibold text-white">
            {iniciais(usuario?.nome ?? '')}
          </span>
          <span className="text-[13.5px] text-white">{usuario?.nome}</span>
        </span>

        <span className="flex-1" />

        {lojaId ? (
          caixaAberto ? (
            <Link
              to="/caixa"
              className="flex h-7 items-center gap-2 rounded-full bg-[var(--color-sucesso)] px-3 text-[12.5px] font-medium text-white no-underline"
              title={`Esperado na gaveta: R$ ${caixaAberto.resumo.esperadoEmCaixa}`}
            >
              <span className="size-1.5 rounded-full bg-white/70" />
              Caixa {caixaAberto.numero} aberto
            </Link>
          ) : (
            <Link
              to="/caixa"
              className="flex h-7 items-center gap-2 rounded-full bg-[var(--color-atencao)] px-3 text-[12.5px] font-medium text-white no-underline"
              title="Sem caixa aberto, o PDV não recebe em dinheiro"
            >
              <span className="size-1.5 rounded-full bg-white/70" />
              Caixa fechado
            </Link>
          )
        ) : null}

        <span className="font-mono text-[13px] text-primary-200">
          {agora.toLocaleDateString('pt-BR')} ·{' '}
          {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </header>

      {/* No balcão são duas colunas; no celular viram uma pilha que rola.
          Só o layout muda — nenhum passo da venda foi mexido. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-y-hidden">
        <section
          aria-label="Catálogo"
          className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:px-[18px]"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setPainelCliente((v) => !v);
                  setTimeout(() => campoCliente.current?.focus(), 0);
                }}
                className="flex h-11 items-center gap-2.5 rounded-md border border-neutral-200 bg-white px-3 text-left"
              >
                {cliente ? (
                  <>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded bg-primary-50 text-[10.5px] font-semibold text-primary-700">
                      {iniciais(cliente.nome)}
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[190px] truncate text-[13.5px] font-medium leading-4 text-neutral-900">
                        {cliente.nome}
                      </span>
                      <span className="block text-[11.5px] leading-[14px] text-neutral-500">
                        {cliente.documento ?? 'sem documento'}
                        {cliente.tabelaPreco ? ` · ${cliente.tabelaPreco}` : ''}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="text-[13.5px] text-neutral-600">Consumidor — identificar</span>
                )}
                <kbd className="ml-1 inline-flex h-5 min-w-[26px] items-center justify-center rounded border border-neutral-200 bg-neutral-50 px-1.5 font-mono text-[11px] text-neutral-600">
                  F4
                </kbd>
              </button>

              {painelCliente ? (
                <div className="absolute left-0 top-[46px] z-20 w-[320px] rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
                  <input
                    ref={campoCliente}
                    value={buscaCliente}
                    onChange={(e) => setBuscaCliente(e.target.value)}
                    placeholder="Nome, documento ou e-mail"
                    aria-label="Buscar cliente"
                    className="h-9 w-full rounded-md border border-neutral-200 px-2.5 text-[13px]"
                  />

                  <div className="mt-2 max-h-[240px] overflow-auto">
                    {(clientes.data?.itens ?? []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCliente(c);
                          setPainelCliente(false);
                          // A tabela do cliente passa a valer, como no
                          // servidor — sem isso a grade mostraria um preço e
                          // a venda gravaria outro.
                          if (!tabelaPrecoId && c.tabelaPrecoId) setTabelaPrecoId(c.tabelaPrecoId);
                        }}
                        className="flex w-full flex-col border-b border-neutral-50 px-1 py-2 text-left last:border-0 hover:bg-neutral-25"
                      >
                        <span className="truncate text-[13px] text-neutral-900">{c.nome}</span>
                        <span className="truncate text-[11.5px] text-neutral-500">
                          {c.documento ?? 'sem documento'}
                          {c.tabelaPreco ? ` · ${c.tabelaPreco}` : ' · sem tabela'}
                        </span>
                      </button>
                    ))}

                    {clientes.isSuccess && clientes.data.itens.length === 0 ? (
                      <p className="px-1 py-3 text-[12.5px] text-neutral-500">
                        Nenhum cliente com esse nome.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCliente(null);
                        setPainelCliente(false);
                      }}
                      className="text-[12.5px] font-medium text-neutral-600 underline"
                    >
                      Venda ao consumidor
                    </button>
                    <button
                      type="button"
                      onClick={() => setPainelCliente(false)}
                      className="text-[12.5px] font-medium text-primary-600 underline"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <span className="hidden h-7 w-px bg-neutral-100 sm:block" />

            <div
              role="group"
              aria-label="Tabela de preços"
              className="flex flex-wrap items-center gap-1.5"
            >
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                Tabela
              </span>
              <PastilhaTabela
                ativa={tabelaPrecoId === ''}
                rotulo={tabelas.find((t) => t.padrao)?.nome ?? 'Padrão'}
                aoEscolher={() => setTabelaPrecoId('')}
              />
              {tabelas
                .filter((t) => !t.padrao)
                .map((t) => (
                  <PastilhaTabela
                    key={t.id}
                    ativa={tabelaPrecoId === t.id}
                    rotulo={t.nome}
                    aoEscolher={() => setTabelaPrecoId(t.id)}
                  />
                ))}
              <kbd className="inline-flex h-5 min-w-[26px] items-center justify-center rounded border border-neutral-200 bg-neutral-50 px-1.5 font-mono text-[11px] text-neutral-600">
                F6
              </kbd>
            </div>
          </div>

          <div className="relative shrink-0">
            <span className="pointer-events-none absolute left-4 top-[15px] text-primary-600">
              <CodigoBarras />
            </span>
            <input
              ref={campoBusca}
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Escaneie o código de barras ou digite o nome do produto…"
              aria-label="Código de barras ou nome do produto"
              className="h-[52px] w-full rounded-lg border-2 border-primary-600 bg-white pl-[46px] pr-[74px] text-[16px] shadow-sm placeholder:text-neutral-400"
            />
            <kbd className="absolute right-3.5 top-[15px] inline-flex h-[22px] min-w-[26px] items-center justify-center rounded border border-b-2 border-neutral-200 bg-neutral-50 px-1.5 font-mono text-[11.5px] font-medium text-neutral-600">
              F2
            </kbd>
          </div>

          {/*
            Achados da busca em lista, não em grade: a grade de vitrine saiu
            porque quem opera o balcão procura pelo código, e o espaço vale
            mais para o carrinho.
          */}
          {termo.trim().length >= 2 && itens.length > 0 ? (
            <div className="max-h-[260px] shrink-0 overflow-auto rounded-md border border-neutral-100 bg-white shadow-sm">
              {itens.map((i) => (
                <button
                  key={i.variacaoId}
                  type="button"
                  onClick={() => {
                    adicionar(i);
                    setTermo('');
                    campoBusca.current?.focus();
                  }}
                  className="flex w-full items-center gap-3 border-b border-neutral-50 px-3 py-2 text-left last:border-0 hover:bg-neutral-25"
                >
                  <span className="size-9 shrink-0 overflow-hidden rounded bg-primary-50">
                    {i.imagemPrincipalId ? (
                      <Foto imagemId={i.imagemPrincipalId} alt={i.produto} className="size-full" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-neutral-900">
                      {i.produto}
                    </span>
                    <span className="block truncate font-mono text-[11.5px] text-neutral-500">
                      {i.sku} · {i.descricaoVariacao}
                    </span>
                  </span>
                  <span
                    className={juntar(
                      'shrink-0 font-mono text-[12px]',
                      Number(i.saldo) <= 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-500',
                    )}
                  >
                    {i.saldo} un
                  </span>
                  <span className="shrink-0 font-mono text-[13.5px] font-medium text-neutral-900">
                    {i.preco ? `R$ ${i.preco}` : 'sem preço'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {termo.trim().length >= 2 && busca.isSuccess && itens.length === 0 ? (
            <p className="shrink-0 text-[13px] text-neutral-500">
              Nada encontrado para &quot;{termo.trim()}&quot;.
            </p>
          ) : null}

          {concluida ? (
            <Aviso tom="sucesso" titulo={`Venda ${concluida.venda.numero} concluída`}>
              Total de R$ {concluida.venda.total}
              {Number(concluida.venda.troco) > 0 ? ` · troco de R$ ${concluida.venda.troco}` : ''}
              {concluida.avisos.length > 0 ? (
                <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4">
                  {concluida.avisos.map((a) => (
                    <li key={a.codigo + a.mensagem}>{a.mensagem}</li>
                  ))}
                </ul>
              ) : null}
            </Aviso>
          ) : null}

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
            <div className="flex shrink-0 items-center gap-2.5 border-b border-neutral-100 px-4 py-3">
              <h2 className="font-display text-[18px] font-bold text-neutral-900">Carrinho</h2>
              <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary-50 px-1.5 font-mono text-[12px] font-medium text-primary-700">
                {carrinho.reduce((s, l) => s + l.quantidade, 0)}
              </span>
              <span className="flex-1" />
              {carrinho.length > 0 ? (
                <button
                  type="button"
                  onClick={limparVenda}
                  className="flex h-[30px] items-center gap-1.5 rounded px-2 text-[13px] font-medium text-[var(--color-perigo)]"
                >
                  <Lixeira />
                  Limpar
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {carrinho.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                  <p className="font-display text-[16px] font-semibold text-neutral-700">
                    Carrinho vazio
                  </p>
                  <p className="max-w-[300px] text-[13.5px] leading-5 text-neutral-500">
                    Escaneie um código de barras ou procure o produto pelo nome para começar a
                    venda.
                  </p>
                </div>
              ) : (
                carrinho.map((l) => (
                  <LinhaItem
                    key={l.variacaoId}
                    linha={l}
                    podeDarDesconto={podeDarDesconto}
                    aoAlterar={(m) => alterar(l.variacaoId, m)}
                    aoRemover={() =>
                      setCarrinho((a) => a.filter((x) => x.variacaoId !== l.variacaoId))
                    }
                  />
                ))
              )}
            </div>
          </section>
        </section>

        <aside
          aria-label="Pagamento"
          className="flex w-full shrink-0 flex-col border-t border-neutral-100 bg-white lg:w-[424px] lg:border-l lg:border-t-0"
        >
          {/* O bloco encosta no cabeçalho; a folga que sobra fica logo acima
              do botão de finalizar, que continua no canto de sempre. */}
          <div className="hidden shrink-0 items-center border-b border-neutral-100 px-[18px] py-3.5 lg:flex">
            <h2 className="font-display text-[18px] font-bold text-neutral-900">Pagamento</h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-25">
            <div className="flex flex-col gap-2 px-[18px] pb-3 pt-3.5">
              <Linha
                rotulo="Subtotal"
                complemento={tabelas.find((t) => t.id === tabelaPrecoId)?.nome ?? 'tabela padrão'}
                valor={totais.subtotal}
              />

              {podeDarDesconto ? (
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[13.5px] text-neutral-600">Desconto</span>
                  <input
                    ref={campoDesconto}
                    value={desconto}
                    onChange={(e) => setDesconto(e.target.value)}
                    placeholder="0,00"
                    aria-label="Desconto na venda"
                    className="h-9 w-[110px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[14px]"
                  />
                </label>
              ) : null}

              <div className="h-px bg-neutral-100" />

              <div className="flex items-center justify-between">
                <span className="font-display text-[15px] font-semibold text-neutral-900">
                  Total
                </span>
                <span className="font-display text-[34px] font-bold leading-[38px] text-neutral-900">
                  R$ {brl(totais.total)}
                </span>
              </div>
            </div>

            <div className="px-[18px] pb-3">
              <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                Forma de pagamento
              </p>
              <div
                role="group"
                aria-label="Forma de pagamento"
                className="grid grid-cols-3 gap-1.5"
              >
                {FORMAS.map((f) => {
                  // CARTEIRA debita a conta corrente: sem cliente o servidor
                  // recusa com CARTEIRA_EXIGE_CLIENTE. Melhor dizer antes.
                  const exigeCliente = f.valor === 'CARTEIRA' && !cliente;
                  const ativa = pagamentos[0]?.forma === f.valor;
                  return (
                    <button
                      key={f.valor}
                      type="button"
                      aria-pressed={ativa}
                      disabled={exigeCliente}
                      title={
                        exigeCliente ? 'Identifique o cliente para usar a carteira' : undefined
                      }
                      onClick={() => escolherForma(f.valor)}
                      className={juntar(
                        'flex h-11 items-center justify-center rounded-md border text-[13px] font-medium',
                        ativa
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25',
                        exigeCliente && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      {f.rotulo}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {pagamentos.map((p, indice) => (
                  <div key={p.chave} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-500">
                      {FORMAS.find((f) => f.valor === p.forma)?.rotulo ?? p.forma}
                    </span>
                    <input
                      value={p.valor}
                      onChange={(e) =>
                        setPagamentos((a) =>
                          a.map((x) => (x.chave === p.chave ? { ...x, valor: e.target.value } : x)),
                        )
                      }
                      placeholder="0,00"
                      aria-label={`Valor em ${p.forma}`}
                      className="h-9 w-[120px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[14px]"
                    />
                    {/*
                      Parcelas só no crédito, e ao lado do valor: é ali que a
                      pergunta aparece no balcão — "em quantas vezes?".
                    */}
                    {p.forma === 'CREDITO' ? (
                      <label className="flex shrink-0 items-center gap-1">
                        <span className="sr-only">Parcelas</span>
                        <select
                          value={p.parcelas}
                          onChange={(e) =>
                            setPagamentos((a) =>
                              a.map((x) =>
                                x.chave === p.chave
                                  ? { ...x, parcelas: Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                          className="h-9 rounded-md border border-neutral-200 bg-white px-1.5 text-[13px]"
                        >
                          {PARCELAS.map((n) => (
                            <option key={n} value={n}>
                              {n}x
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {indice > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPagamentos((a) => a.filter((x) => x.chave !== p.chave))}
                        aria-label="Remover forma de pagamento"
                        className="size-8 shrink-0 rounded-md text-neutral-400 hover:bg-neutral-50"
                      >
                        ✕
                      </button>
                    ) : null}

                    {/*
                      "10x" sozinho não diz nada ao cliente que pergunta "de
                      quanto fica?". A conta aparece escrita, e a sobra dos
                      centavos vai na primeira parcela — que é como a máquina
                      de cartão faz.
                    */}
                    {p.forma === 'CREDITO' && p.parcelas > 1 && Number(p.valor || 0) > 0 ? (
                      <p className="w-full text-[12px] text-neutral-500">
                        {p.parcelas}× de{' '}
                        <span className="font-mono font-medium text-neutral-700">
                          R$ {brl(parcelaDe(Number(p.valor), p.parcelas).demais)}
                        </span>
                        {parcelaDe(Number(p.valor), p.parcelas).primeira !==
                        parcelaDe(Number(p.valor), p.parcelas).demais ? (
                          <>
                            {' '}
                            (a primeira de{' '}
                            <span className="font-mono font-medium text-neutral-700">
                              R$ {brl(parcelaDe(Number(p.valor), p.parcelas).primeira)}
                            </span>
                            )
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                ))}

                {maisFormas || pagamentos.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Adicionar forma de pagamento"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setPagamentos((a) => [
                          ...a,
                          {
                            chave: Math.max(...a.map((x) => x.chave)) + 1,
                            forma: e.target.value as FormaPagamento,
                            valor: totais.falta > 0 ? totais.falta.toFixed(2) : '',
                            parcelas: 1,
                          },
                        ]);
                        setMaisFormas(false);
                      }}
                      className="h-9 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
                    >
                      <option value="">+ outra forma…</option>
                      {FORMAS.filter((f) => f.valor !== 'CARTEIRA' || cliente).map((f) => (
                        <option key={f.valor} value={f.valor}>
                          {f.rotulo}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMaisFormas(true)}
                    className="w-fit text-[12.5px] font-medium text-primary-600 underline"
                  >
                    dividir em mais de uma forma
                  </button>
                )}

                <div className="flex flex-col gap-1 rounded-md bg-white p-3">
                  <Linha rotulo="Recebido" valor={totais.recebido} />
                  {totais.falta > 0 ? (
                    <Linha rotulo="Falta" valor={totais.falta} tom="perigo" />
                  ) : (
                    <Linha
                      rotulo="Troco"
                      valor={totais.troco}
                      tom={totais.troco > 0 ? 'sucesso' : undefined}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-[18px] pb-4 lg:mt-auto lg:pt-2">
              {podeDarDesconto ? (
                <button
                  type="button"
                  onClick={() => {
                    campoDesconto.current?.focus();
                    campoDesconto.current?.select();
                  }}
                  className="flex h-[52px] w-[116px] shrink-0 flex-col items-center justify-center rounded-md border border-neutral-200 bg-white"
                >
                  <span className="text-[13px] font-medium text-neutral-700">Desconto</span>
                  <span className="font-mono text-[10.5px] text-neutral-400">F8</span>
                </button>
              ) : null}

              <Botao
                variante="primario"
                tamanho="pdv"
                className="h-[52px] flex-1 text-[16px]"
                disabled={!podeFinalizar}
                carregando={finalizar.isPending}
                onClick={() => finalizar.mutate()}
              >
                Finalizar venda
                <kbd className="inline-flex h-[21px] min-w-[26px] items-center justify-center rounded bg-white/20 px-1.5 font-mono text-[11.5px] font-medium text-white">
                  F9
                </kbd>
              </Botao>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PastilhaTabela({
  ativa,
  rotulo,
  aoEscolher,
}: {
  readonly ativa: boolean;
  readonly rotulo: string;
  readonly aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoEscolher}
      className={juntar(
        'h-[34px] rounded-full border px-3.5 text-[13px] font-medium',
        ativa
          ? 'border-primary-600 bg-primary-50 text-primary-700'
          : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-25',
      )}
    >
      {rotulo}
    </button>
  );
}

function Linha({
  rotulo,
  complemento,
  valor,
  tom,
}: {
  readonly rotulo: string;
  readonly complemento?: string;
  readonly valor: number;
  readonly tom?: 'perigo' | 'sucesso';
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[13.5px] text-neutral-600">
        {rotulo}
        {complemento ? <span className="text-neutral-400"> ({complemento})</span> : null}
      </span>
      <span
        className={juntar(
          'font-mono text-[14px]',
          tom === 'perigo'
            ? 'font-semibold text-[var(--color-perigo)]'
            : tom === 'sucesso'
              ? 'font-semibold text-[var(--color-sucesso)]'
              : 'text-neutral-700',
        )}
      >
        R$ {brl(valor)}
      </span>
    </div>
  );
}

function LinhaItem({
  linha,
  podeDarDesconto,
  aoAlterar,
  aoRemover,
}: {
  readonly linha: LinhaCarrinho;
  readonly podeDarDesconto: boolean;
  readonly aoAlterar: (mudanca: Partial<LinhaCarrinho>) => void;
  readonly aoRemover: () => void;
}) {
  const unitario = Number(linha.precoManual ?? linha.precoTabela ?? 0);
  const semPreco = linha.precoManual === null && linha.precoTabela === null;
  const negativo = linha.saldo - linha.quantidade < 0;

  return (
    <div className="flex gap-3 border-b border-neutral-50 px-[18px] py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium leading-[18px] text-neutral-900">
          {linha.produto}
          <span className="text-neutral-500"> · {linha.descricaoVariacao}</span>
        </p>
        <p className="font-mono text-[11px] text-neutral-400">{linha.sku}</p>

        {podeDarDesconto ? (
          <label className="mt-1 flex items-center gap-1.5">
            <span className="sr-only">Preço unitário de {linha.produto}</span>
            <input
              value={linha.precoManual ?? linha.precoTabela ?? ''}
              onChange={(e) => aoAlterar({ precoManual: e.target.value })}
              className="h-7 w-[92px] rounded border border-neutral-200 px-1.5 text-right font-mono text-[12.5px]"
            />
            <span className="text-[12.5px] text-neutral-400">/ un</span>
          </label>
        ) : (
          <p className="mt-1 text-[12.5px] text-neutral-600">
            R$ {brl(unitario)} <span className="text-neutral-400">/ un</span>
          </p>
        )}

        {semPreco ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded bg-[var(--color-atencao-fundo)] px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--color-atencao)]">
            <Alerta />
            Sem preço nesta tabela
          </p>
        ) : null}

        {/* Vender abaixo de zero é permitido por configuração; o servidor
            decide. Aqui só se avisa — e visível, não em `title`. */}
        {negativo ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded bg-[var(--color-perigo-fundo)] px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--color-perigo)]">
            <Alerta />
            Venda com saldo negativo
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <span className="font-mono text-[15px] font-medium text-neutral-900">
          R$ {brl(unitario * linha.quantidade)}
        </span>

        <div className="flex items-center">
          <button
            type="button"
            aria-label={`Menos um ${linha.produto}`}
            onClick={() =>
              linha.quantidade <= 1 ? aoRemover() : aoAlterar({ quantidade: linha.quantidade - 1 })
            }
            className="flex size-9 items-center justify-center rounded-l-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25"
          >
            {linha.quantidade <= 1 ? <Lixeira /> : <Menos />}
          </button>
          <span
            aria-live="polite"
            className="flex h-9 w-[42px] items-center justify-center border-y border-neutral-200 font-mono text-[14px] font-medium text-neutral-900"
          >
            {linha.quantidade}
          </span>
          <button
            type="button"
            aria-label={`Mais um ${linha.produto}`}
            onClick={() => aoAlterar({ quantidade: linha.quantidade + 1 })}
            className="flex size-9 items-center justify-center rounded-r-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25"
          >
            <Mais />
          </button>
        </div>
      </div>
    </div>
  );
}

function SetaEsquerda() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H6" />
      <path d="m12 6-6 6 6 6" />
    </svg>
  );
}

function Casa() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function CodigoBarras() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6v12M6.5 6v12M10 6v12M13.5 6v12M17 6v12M20.5 6v12" />
    </svg>
  );
}

function Mais() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function Menos() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function Lixeira() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

function Alerta() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}
