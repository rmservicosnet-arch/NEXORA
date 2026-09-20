import {
  PERM,
  type ItemCatalogo,
  type Pedido,
  type PedidoItem,
  type StatusPedido,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import { SeloStatus } from './Pedidos';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

/** O que a equipe decidiu para um item, antes de mandar ao servidor. */
interface Decisao {
  readonly acao: 'CONFIRMAR' | 'DEVOLVER';
  readonly quantidade: number;
}

const EDITAVEL: readonly StatusPedido[] = ['AGUARDANDO_CONFIRMACAO'];

function vivo(item: PedidoItem): boolean {
  return item.status !== 'REMOVIDO' && item.status !== 'CANCELADO';
}

/** O que o cliente pediu — ou, num item incluído pela equipe, o que ela pôs. */
function pedida(item: PedidoItem): number {
  return Number(item.quantidadeSolicitada) || Number(item.quantidadeConfirmada);
}

function disponivelDe(item: PedidoItem): number {
  return Number(item.disponivelAgora ?? pedida(item));
}

export function PedidoDetalhe() {
  const { pedidoId } = useParams<{ pedidoId: string }>();
  const { pode } = useSessao();
  const fila = useQueryClient();

  /**
   * As decisões guardam a QUAL pedido pertencem.
   *
   * Ir de um pedido para outro não remonta o componente — a rota é a mesma,
   * só o parâmetro muda. Sem o dono registrado, as decisões do pedido
   * anterior continuavam na tela: quantidade zerada em item que o cliente
   * pediu, e "Confirmados 0" num pedido inteiro disponível.
   */
  const [decisoes, setDecisoes] = useState<{
    dono: string | null;
    porItem: Record<string, Decisao>;
  }>({ dono: null, porItem: {} });
  const [justificativa, setJustificativa] = useState('');
  const [acao, setAcao] = useState<'devolver' | 'recusar' | 'cancelar' | 'faturar' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [buscaItem, setBuscaItem] = useState('');
  const [motivoInclusao, setMotivoInclusao] = useState('');
  /** Quantas unidades incluir. A API sempre aceitou; a tela mandava 1 fixo. */
  const [qtdInclusao, setQtdInclusao] = useState('1');
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [motivoRemocao, setMotivoRemocao] = useState('');

  const consulta = useQuery({
    queryKey: ['pedidos', pedidoId],
    queryFn: () => pedir<Pedido>(`/pedidos/${pedidoId ?? ''}`),
    enabled: Boolean(pedidoId),
  });

  const pedido = consulta.data;

  /**
   * A decisão nasce com o que o CLIENTE pediu — inclusive quando falta saldo.
   *
   * Disponível aqui é aviso, não teto: a API deixa confirmar acima dele com
   * `pedido.confirmar_sem_saldo` e justificativa. Se a tela cortasse pelo
   * disponível, a falta de estoque devolveria o item sozinha, no meio de um
   * pedido que o operador confirmaria sem olhar a linha.
   */
  useEffect(() => {
    if (!pedido) return;
    setDecisoes((atual) => {
      // Já é deste pedido e a pessoa mexeu: não desfazer o trabalho dela.
      if (atual.dono === pedido.id && Object.keys(atual.porItem).length > 0) return atual;

      const inicial: Record<string, Decisao> = {};
      for (const i of pedido.itens) {
        if (!vivo(i)) continue;
        inicial[i.id] = { acao: 'CONFIRMAR', quantidade: pedida(i) };
      }
      return { dono: pedido.id, porItem: inicial };
    });
  }, [pedido]);

  function aoFalhar(e: unknown) {
    setSucesso(null);
    setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
  }

  async function recarregar() {
    setErro(null);
    setAcao(null);
    setMotivo('');
    await fila.invalidateQueries({ queryKey: ['pedidos'] });
    await fila.invalidateQueries({ queryKey: ['estoque'] });
  }

  const confirmar = useMutation({
    mutationFn: () =>
      pedir<Pedido>(`/pedidos/${pedidoId ?? ''}/confirmar`, {
        method: 'POST',
        body: {
          itens: Object.entries(decisoes.porItem).map(([itemId, d]) => ({
            itemId,
            quantidadeConfirmada: String(d.acao === 'DEVOLVER' ? 0 : d.quantidade),
          })),
          ...(justificativa.trim() ? { justificativaSemSaldo: justificativa.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      setSucesso('Pedido confirmado. O estoque está reservado.');
      setJustificativa('');
      await recarregar();
    },
    onError: aoFalhar,
  });

  const encerrar = useMutation({
    mutationFn: (qual: 'devolver' | 'recusar' | 'cancelar') =>
      pedir<Pedido>(`/pedidos/${pedidoId ?? ''}/${qual}`, { method: 'POST', body: { motivo } }),
    onSuccess: async () => {
      setSucesso('Pedido encerrado. A reserva foi liberada.');
      await recarregar();
    },
    onError: aoFalhar,
  });

  const faturar = useMutation({
    mutationFn: () =>
      pedir<{ vendaNumero: number }>(`/pedidos/${pedidoId ?? ''}/faturar`, {
        method: 'POST',
        body: { pagamentos: [{ forma: 'CARTEIRA', valor: pedido?.valorConfirmado ?? '0' }] },
      }),
    onSuccess: async (r) => {
      setSucesso(`Faturado. Virou a venda #${String(r.vendaNumero)}.`);
      await recarregar();
    },
    onError: aoFalhar,
  });

  const remover = useMutation({
    mutationFn: (p: { itemId: string; motivo: string }) =>
      pedir<Pedido>(`/pedidos/${pedidoId ?? ''}/itens/${p.itemId}/remover`, {
        method: 'POST',
        body: { motivo: p.motivo },
      }),
    onSuccess: async () => {
      setSucesso('Item removido por acordo. Não entra no relatório de ruptura.');
      setRemovendo(null);
      setMotivoRemocao('');
      await recarregar();
    },
    onError: aoFalhar,
  });

  const catalogo = useQuery({
    queryKey: ['pedidos', 'catalogo-equipe', pedido?.tabelaPrecoId ?? 'padrao', buscaItem],
    queryFn: () =>
      pedir<ItemCatalogo[]>(
        `/vendas/itens?termo=${encodeURIComponent(buscaItem)}&lojaId=${pedido?.lojaId ?? ''}` +
          (pedido?.tabelaPrecoId ? `&tabelaPrecoId=${pedido.tabelaPrecoId}` : ''),
      ),
    enabled: buscaItem.trim().length >= 2 && Boolean(pedido),
  });

  const incluir = useMutation({
    mutationFn: (variacaoId: string) =>
      pedir<Pedido>(`/pedidos/${pedidoId ?? ''}/itens`, {
        method: 'POST',
        body: {
          variacaoId,
          quantidade: String(Math.max(1, Number(qtdInclusao) || 1)),
          motivo: motivoInclusao.trim(),
        },
      }),
    onSuccess: async (p) => {
      setSucesso(
        p.status === 'AGUARDANDO_ACEITE_CLIENTE'
          ? 'Item incluído. O total subiu, então o pedido está esperando o aceite do cliente.'
          : 'Item incluído.',
      );
      setBuscaItem('');
      setMotivoInclusao('');
      setQtdInclusao('1');
      await recarregar();
    },
    onError: aoFalhar,
  });

  // ---------------------------------------------------------------------
  // O resultado da conferência, calculado do que está na tela
  // ---------------------------------------------------------------------
  const resumo = useMemo(() => {
    const itens = pedido?.itens ?? [];
    let confirmados = 0;
    let devolvidos = 0;
    let semSaldo = 0;
    let total = 0;

    for (const i of itens) {
      if (!vivo(i)) continue;
      const d = decisoes.porItem[i.id];
      if (!d) continue;

      if (d.acao === 'DEVOLVER' || d.quantidade === 0) {
        devolvidos += 1;
        continue;
      }
      confirmados += 1;
      if (d.quantidade > disponivelDe(i)) semSaldo += 1;
      total += d.quantidade * Number(i.precoUnitario);
    }

    return {
      confirmados,
      devolvidos,
      semSaldo,
      removidos: itens.filter((i) => i.status === 'REMOVIDO').length,
      incluidos: itens.filter((i) => i.origem === 'ADICIONADO_EQUIPE' && vivo(i)).length,
      total,
    };
  }, [pedido, decisoes]);

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando pedido…" />;
  }

  if (consulta.isError || !pedido) {
    return (
      <EstadoErro
        titulo="Não foi possível abrir o pedido"
        descricao={
          consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente novamente em instantes.'
        }
      />
    );
  }

  const itensDoPedido = pedido.itens;
  const idDoPedido = pedido.id;
  const editavel = EDITAVEL.includes(pedido.status);
  const confirmavel = editavel && pode(PERM.pedido.confirmar);
  const faturavel =
    (pedido.status === 'CONFIRMADO' || pedido.status === 'CONFIRMADO_PARCIALMENTE') &&
    pode(PERM.pedido.faturar);

  const enviado = Number(pedido.valorSolicitado);
  const diferenca = resumo.total - enviado;
  const precisaAceite = editavel && diferenca > 0.004;

  function decidir(itemId: string, mudanca: Partial<Decisao>) {
    setSucesso(null);
    setDecisoes((a) => {
      const atual = a.porItem[itemId] ?? { acao: 'CONFIRMAR' as const, quantidade: 0 };
      return { ...a, porItem: { ...a.porItem, [itemId]: { ...atual, ...mudanca } } };
    });
  }

  /** Confirma o que dá: cada item pelo menor entre o pedido e o disponível. */
  function confirmarDisponiveis() {
    setSucesso(null);
    const novo: Record<string, Decisao> = {};
    for (const i of itensDoPedido) {
      if (!vivo(i)) continue;
      const cabe = Math.max(0, Math.min(pedida(i), disponivelDe(i)));
      novo[i.id] =
        cabe === 0 ? { acao: 'DEVOLVER', quantidade: 0 } : { acao: 'CONFIRMAR', quantidade: cabe };
    }
    setDecisoes({ dono: idDoPedido, porItem: novo });
  }

  /** Volta ao que o cliente pediu. */
  function recomecar() {
    setSucesso(null);
    const novo: Record<string, Decisao> = {};
    for (const i of itensDoPedido) {
      if (!vivo(i)) continue;
      novo[i.id] = { acao: 'CONFIRMAR', quantidade: pedida(i) };
    }
    setDecisoes({ dono: idDoPedido, porItem: novo });
    setJustificativa('');
  }

  const telefone = (pedido.clienteTelefone ?? '').replace(/\D/g, '');

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <Link to="/pedidos" className="text-[13px] text-neutral-500 no-underline hover:underline">
          Fila de pedidos
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-mono text-[13.5px] font-medium text-neutral-900">
          #{pedido.numero}
        </span>
        <SeloStatus status={pedido.status} />

        <div className="hidden flex-1 sm:block" />

        {telefone ? (
          <a
            href={`https://wa.me/${telefone}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12.5px] text-neutral-600 no-underline hover:bg-neutral-50"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.7-5.5A8.4 8.4 0 1 1 21 11.5z" />
            </svg>
            Falar com o cliente
          </a>
        ) : null}

        {pedido.validoAte ? (
          <span className="text-[12px] text-neutral-500">
            válido até{' '}
            <strong className="font-medium text-neutral-700">
              {new Date(pedido.validoAte).toLocaleDateString('pt-BR')} às{' '}
              {new Date(pedido.validoAte).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </strong>
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 xl:flex-row xl:overflow-hidden">
        {/* ---------------- Itens ---------------- */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}
          {sucesso ? <Aviso tom="sucesso">{sucesso}</Aviso> : null}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[20px] font-bold text-neutral-900">
                {confirmavel ? 'Conferir e ajustar o pedido' : 'Pedido'}
              </h1>
              <p className="text-[12.5px] text-neutral-500">
                {pedido.itens.filter((i) => i.origem === 'SOLICITADO_CLIENTE').length}{' '}
                {pedido.itens.filter((i) => i.origem === 'SOLICITADO_CLIENTE').length === 1
                  ? 'item do cliente'
                  : 'itens do cliente'}{' '}
                · {resumo.incluidos} {resumo.incluidos === 1 ? 'incluído' : 'incluídos'} pela equipe
                {pedido.tabelaPreco ? ` · tabela ${pedido.tabelaPreco}` : ''}
              </p>
            </div>

            {confirmavel ? (
              <div className="flex flex-wrap gap-2">
                {/* Atalho para o caso comum: confirmar o que cabe no saldo. */}
                <Botao variante="secundario" tamanho="compacto" onClick={confirmarDisponiveis}>
                  Confirmar o disponível
                </Botao>
                <Botao variante="fantasma" tamanho="compacto" onClick={recomecar}>
                  Recomeçar
                </Botao>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-x-auto rounded-md border border-neutral-100 bg-white shadow-sm">
            <div className="hidden shrink-0 grid-cols-[minmax(180px,1fr)_60px_110px_150px_120px_104px_44px] items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 lg:grid lg:min-w-[830px]">
              {['Item', 'Ped.', 'Disponível', 'Decisão', 'Quantidade', 'Valor', ''].map((t, i) => (
                <span
                  key={t || `c${String(i)}`}
                  className={juntar(
                    'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500',
                    (i === 1 || i === 5) && 'text-right',
                    i === 4 && 'text-center',
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto lg:min-w-[830px]">
              {pedido.itens.map((item) => (
                <LinhaItem
                  key={item.id}
                  item={item}
                  decisao={decisoes.porItem[item.id]}
                  editavel={confirmavel}
                  podeRemover={editavel && pode(PERM.pedido.editarItens)}
                  removendo={removendo === item.id}
                  motivo={motivoRemocao}
                  aoDecidir={(m) => decidir(item.id, m)}
                  aoAbrirRemocao={() => {
                    setRemovendo(removendo === item.id ? null : item.id);
                    setMotivoRemocao('');
                  }}
                  aoMudarMotivo={setMotivoRemocao}
                  aoRemover={() => remover.mutate({ itemId: item.id, motivo: motivoRemocao })}
                />
              ))}
            </div>

            {/* Incluir item acordado — o rodapé da tabela, como na proposta. */}
            {editavel && pode(PERM.pedido.editarItens) ? (
              <div className="flex shrink-0 flex-col gap-2 border-t border-neutral-100 bg-neutral-25 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-neutral-600">
                    Incluir item acordado:
                  </span>
                  <input
                    value={motivoInclusao}
                    onChange={(e) => setMotivoInclusao(e.target.value)}
                    placeholder="O que foi combinado com o cliente"
                    className="h-8 min-w-[220px] flex-1 rounded-md border border-neutral-200 px-2.5 text-[12.5px]"
                  />
                  <input
                    value={buscaItem}
                    onChange={(e) => setBuscaItem(e.target.value)}
                    placeholder="Buscar no catálogo"
                    className="h-8 w-[180px] rounded-md border border-neutral-200 px-2.5 text-[12.5px]"
                  />
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11.5px] text-neutral-500">qtd.</span>
                    <input
                      value={qtdInclusao}
                      onChange={(e) => setQtdInclusao(e.target.value.replace(/\D/g, ''))}
                      aria-label="Quantidade a incluir"
                      className="h-8 w-[56px] rounded-md border border-neutral-200 px-2 text-right font-mono text-[12.5px]"
                    />
                  </span>
                </div>

                {catalogo.data && catalogo.data.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {catalogo.data.slice(0, 6).map((i) => (
                      <button
                        key={i.variacaoId}
                        type="button"
                        disabled={motivoInclusao.trim().length < 5 || incluir.isPending}
                        onClick={() => incluir.mutate(i.variacaoId)}
                        className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-left text-[12px] text-neutral-700 disabled:opacity-50"
                      >
                        <span className="max-w-[160px] truncate">{i.produto}</span>
                        <span className="font-mono text-[11px] text-neutral-400">
                          R$ {brl(i.preco)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {motivoInclusao.trim().length < 5 && buscaItem.trim().length >= 2 ? (
                  <p className="text-[11.5px] text-[var(--color-atencao)]">
                    Descreva o que foi combinado antes de escolher o item — o motivo vai para a
                    linha do tempo que o cliente vê.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* A linha do tempo é a prova da conversa. Fica abaixo dos itens. */}
          <section className="shrink-0 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-display text-[14px] font-semibold text-neutral-900">
              Linha do tempo
            </h2>
            <div className="flex max-h-[168px] flex-col gap-1.5 overflow-y-auto">
              {pedido.eventos.map((e) => (
                <div key={e.id} className="flex flex-wrap gap-x-3 text-[12px]">
                  <span className="w-[104px] shrink-0 font-mono text-neutral-400">
                    {new Date(e.criadoEm).toLocaleDateString('pt-BR')}{' '}
                    {new Date(e.criadoEm).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-neutral-700">
                      {e.ator ?? 'Sistema'} · {e.paraStatus.toLowerCase().replaceAll('_', ' ')}
                    </span>
                    {e.motivo ? <span className="block text-neutral-500">{e.motivo}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </section>

        {/* ---------------- Resumo e ações ---------------- */}
        <aside className="flex w-full shrink-0 flex-col gap-3 xl:w-[320px] xl:overflow-y-auto">
          <section className="flex items-center gap-2.5 rounded-md border border-neutral-100 bg-white p-3.5 shadow-sm">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-600 text-[12px] font-semibold text-white">
              {pedido.cliente
                .split(' ')
                .filter((p) => p.length > 2)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? '')
                .join('')}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-neutral-900">
                {pedido.cliente}
              </p>
              <p className="truncate text-[11.5px] text-neutral-500">
                {pedido.solicitante ?? '—'}
                {pedido.tabelaPreco ? ` · tabela ${pedido.tabelaPreco}` : ''}
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <h2 className="font-display text-[14px] font-semibold text-neutral-900">
              Resultado da conferência
            </h2>

            <Contador cor="--color-sucesso" rotulo="Confirmados" valor={resumo.confirmados} />
            <Contador
              cor="--color-perigo"
              rotulo="Devolvidos por falta"
              valor={resumo.devolvidos}
            />
            <Contador
              cor="--color-neutral-400"
              rotulo="Removidos por acordo"
              valor={resumo.removidos}
            />
            <Contador
              cor="--color-primary-600"
              rotulo="Incluídos pela equipe"
              valor={resumo.incluidos}
            />

            <div className="mt-1 border-t border-neutral-100 pt-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-neutral-500">O cliente enviou</span>
                <span className="font-mono text-[13px] text-neutral-600">R$ {brl(enviado)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-neutral-900">
                  {confirmavel ? 'A confirmar' : 'Valor'}
                </span>
                <span className="font-mono text-[19px] font-bold text-neutral-900">
                  R$ {brl(confirmavel ? resumo.total : pedido.valorConfirmado)}
                </span>
              </div>

              {confirmavel && Math.abs(diferenca) > 0.004 ? (
                <p
                  className={juntar(
                    'mt-1 text-[12px] font-medium',
                    diferenca > 0 ? 'text-[var(--color-perigo)]' : 'text-[var(--color-sucesso)]',
                  )}
                >
                  {diferenca > 0 ? 'Acima' : 'Abaixo'} do enviado em R$ {brl(Math.abs(diferenca))}
                </p>
              ) : null}
            </div>
          </section>

          {precisaAceite ? (
            <Aviso tom="atencao" titulo="O total ficou acima do que o cliente enviou">
              O pedido vai para o aceite dele antes de ser confirmado. Ele recebe o comparativo e
              aprova — cobrar acima do enviado sem isso seria cobrar o que ninguém pediu.
            </Aviso>
          ) : null}

          {resumo.semSaldo > 0 ? (
            <Aviso
              tom="perigo"
              titulo={`${String(resumo.semSaldo)} ${resumo.semSaldo === 1 ? 'item acima' : 'itens acima'} do disponível`}
            >
              Exige <span className="font-mono">pedido.confirmar_sem_saldo</span> e justificativa. O
              saldo fica negativo — permitido, nunca silencioso.
            </Aviso>
          ) : null}

          {confirmavel && resumo.semSaldo > 0 ? (
            <textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={2}
              maxLength={400}
              placeholder="Por que confirmar acima do disponível"
              className="rounded-md border border-[var(--color-atencao)] bg-white px-3 py-2 text-[13px]"
            />
          ) : null}

          {confirmavel ? (
            <p className="text-[11.5px] leading-[16px] text-neutral-500">
              Confirmar <strong className="font-medium">reserva</strong> o estoque; a baixa é no
              faturamento. Toda inclusão e remoção fica na linha do tempo, com o seu nome.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            {confirmavel ? (
              <>
                <Botao
                  variante="primario"
                  tamanho="pdv"
                  carregando={confirmar.isPending}
                  disabled={resumo.confirmados === 0}
                  onClick={() => {
                    setErro(null);
                    confirmar.mutate();
                  }}
                >
                  {resumo.confirmados === 0
                    ? 'Nenhum item confirmado'
                    : `Confirmar ${String(resumo.confirmados)} ${resumo.confirmados === 1 ? 'item' : 'itens'}`}
                </Botao>

                {pode(PERM.pedido.recusar) ? (
                  <Botao variante="perigo" onClick={() => setAcao('recusar')}>
                    Recusar pedido inteiro
                  </Botao>
                ) : null}
                {pode(PERM.pedido.devolver) ? (
                  <Botao variante="secundario" onClick={() => setAcao('devolver')}>
                    Devolver para o cliente
                  </Botao>
                ) : null}
              </>
            ) : null}

            {faturavel ? (
              <>
                <Botao
                  variante="primario"
                  tamanho="pdv"
                  carregando={faturar.isPending}
                  onClick={() => setAcao('faturar')}
                >
                  Faturar
                </Botao>
                <Botao variante="secundario" onClick={() => setAcao('cancelar')}>
                  Cancelar pedido
                </Botao>
              </>
            ) : null}
          </div>

          {acao && acao !== 'faturar' ? (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3">
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                autoFocus
                placeholder="O motivo vai para a linha do tempo do cliente"
                className="rounded-md border border-neutral-200 px-2.5 py-2 text-[13px]"
              />
              <div className="flex flex-wrap gap-2">
                <Botao
                  variante="perigo"
                  tamanho="compacto"
                  disabled={motivo.trim().length < 5}
                  carregando={encerrar.isPending}
                  onClick={() => encerrar.mutate(acao)}
                >
                  Confirmar {acao}
                </Botao>
                <Botao variante="secundario" tamanho="compacto" onClick={() => setAcao(null)}>
                  Voltar
                </Botao>
              </div>
            </div>
          ) : null}

          {acao === 'faturar' ? (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3">
              <p className="text-[12.5px] text-neutral-600">
                Faturar dá baixa no estoque e debita R$ {brl(pedido.valorConfirmado)} na carteira do
                cliente. A reserva vira saída de verdade.
              </p>
              <div className="flex flex-wrap gap-2">
                <Botao
                  variante="primario"
                  tamanho="compacto"
                  carregando={faturar.isPending}
                  onClick={() => faturar.mutate()}
                >
                  Faturar agora
                </Botao>
                <Botao variante="secundario" tamanho="compacto" onClick={() => setAcao(null)}>
                  Voltar
                </Botao>
              </div>
            </div>
          ) : null}
        </aside>
      </main>
    </>
  );
}

function Contador({
  cor,
  rotulo,
  valor,
}: {
  readonly cor: string;
  readonly rotulo: string;
  readonly valor: number;
}) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="flex items-center gap-2 text-neutral-600">
        <span
          className="size-2 rounded-full"
          style={{ background: `var(${cor})` }}
          aria-hidden="true"
        />
        {rotulo}
      </span>
      <span className="font-mono font-medium text-neutral-900">{valor}</span>
    </div>
  );
}

function LinhaItem({
  item,
  decisao,
  editavel,
  podeRemover,
  removendo,
  motivo,
  aoDecidir,
  aoAbrirRemocao,
  aoMudarMotivo,
  aoRemover,
}: {
  readonly item: PedidoItem;
  readonly decisao: Decisao | undefined;
  readonly editavel: boolean;
  readonly podeRemover: boolean;
  readonly removendo: boolean;
  readonly motivo: string;
  readonly aoDecidir: (m: Partial<Decisao>) => void;
  readonly aoAbrirRemocao: () => void;
  readonly aoMudarMotivo: (v: string) => void;
  readonly aoRemover: () => void;
}) {
  const removido = item.status === 'REMOVIDO';
  const devolvido = item.status === 'DEVOLVIDO';
  const disponivel = disponivelDe(item);
  const quer = pedida(item);

  const confirmando = decisao?.acao === 'CONFIRMAR' ? decisao.quantidade : 0;
  const passaDoDisponivel = editavel && confirmando > disponivel;
  const valorLinha = editavel ? confirmando * Number(item.precoUnitario) : Number(item.totalItem);

  return (
    <div className={juntar('border-b border-neutral-50 last:border-0', removido && 'opacity-55')}>
      <div
        className={juntar(
          'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5',
          'lg:grid lg:grid-cols-[minmax(180px,1fr)_60px_110px_150px_120px_104px_44px]',
          passaDoDisponivel && 'bg-[#fdfaf5]',
        )}
      >
        {/* Item */}
        <div className="order-1 w-full min-w-0 lg:order-none lg:w-auto">
          <p
            className={juntar('truncate text-[13px] text-neutral-900', removido && 'line-through')}
          >
            {item.produto}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
            <span className="font-mono">R$ {brl(item.precoUnitario)}/un</span>
            {item.origem === 'ADICIONADO_EQUIPE' ? (
              <span className="rounded bg-primary-50 px-1.5 py-0.5 font-semibold text-primary-700">
                incluído pela equipe
              </span>
            ) : null}
            {removido ? (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-600">
                removido por acordo
              </span>
            ) : null}
            {devolvido ? (
              <span className="rounded bg-[var(--color-perigo-fundo)] px-1.5 py-0.5 font-semibold text-[var(--color-perigo)]">
                devolvido — faltou saldo
              </span>
            ) : null}
            {item.confirmadoSemSaldo ? (
              <span className="rounded bg-[var(--color-atencao-fundo)] px-1.5 py-0.5 font-semibold text-[var(--color-atencao)]">
                sem saldo
              </span>
            ) : null}
          </p>
        </div>

        {/* Pedido */}
        <span className="order-2 text-right font-mono text-[12.5px] text-neutral-600 lg:order-none">
          <span className="mr-1 font-sans text-[10px] uppercase text-neutral-400 lg:hidden">
            ped.
          </span>
          {quer}
        </span>

        {/* Disponível */}
        <span className="order-3 lg:order-none">
          {item.disponivelAgora === undefined ? (
            <span className="text-[12px] text-neutral-400">—</span>
          ) : (
            <span
              className={juntar(
                'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold',
                disponivel <= 0
                  ? 'bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]'
                  : disponivel < quer
                    ? 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]'
                    : 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
              )}
            >
              {disponivel <= 0 ? 'Sem saldo' : `${disponivel} un`}
            </span>
          )}
        </span>

        {/* Decisão */}
        <span className="order-5 w-full lg:order-none lg:w-auto">
          {editavel && !removido ? (
            <span className="inline-flex overflow-hidden rounded-md border border-neutral-200">
              {(['CONFIRMAR', 'DEVOLVER'] as const).map((qual) => {
                const ativo = (decisao?.acao ?? 'CONFIRMAR') === qual;
                return (
                  <button
                    key={qual}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() =>
                      aoDecidir(
                        qual === 'DEVOLVER'
                          ? { acao: 'DEVOLVER', quantidade: 0 }
                          : { acao: 'CONFIRMAR', quantidade: decisao?.quantidade || quer },
                      )
                    }
                    className={juntar(
                      'h-8 px-2.5 text-[12px] font-medium',
                      ativo
                        ? qual === 'CONFIRMAR'
                          ? 'bg-[var(--color-sucesso)] text-white'
                          : 'bg-[var(--color-perigo)] text-white'
                        : 'bg-white text-neutral-500 hover:bg-neutral-50',
                    )}
                  >
                    {qual === 'CONFIRMAR' ? 'Confirmar' : 'Devolver'}
                  </button>
                );
              })}
            </span>
          ) : (
            <span className="text-[12px] text-neutral-500">
              {removido ? 'removido' : devolvido ? 'devolvido' : 'confirmado'}
            </span>
          )}
        </span>

        {/* Quantidade */}
        <span className="order-6 lg:order-none">
          {editavel && !removido && decisao?.acao === 'CONFIRMAR' ? (
            <span className="inline-flex items-center rounded-md border border-neutral-200">
              <button
                type="button"
                aria-label={`Diminuir ${item.sku}`}
                onClick={() => aoDecidir({ quantidade: Math.max(0, confirmando - 1) })}
                className="flex size-8 items-center justify-center text-neutral-600 hover:bg-neutral-50"
              >
                −
              </button>
              <span
                className={juntar(
                  'w-10 text-center font-mono text-[13px]',
                  passaDoDisponivel && 'font-semibold text-[var(--color-atencao)]',
                )}
              >
                {confirmando}
              </span>
              <button
                type="button"
                aria-label={`Aumentar ${item.sku}`}
                onClick={() => aoDecidir({ quantidade: Math.min(quer, confirmando + 1) })}
                className="flex size-8 items-center justify-center text-neutral-600 hover:bg-neutral-50"
              >
                +
              </button>
            </span>
          ) : (
            <span className="text-[12px] text-neutral-500">
              {item.motivoDevolucao ?? item.motivoRemocao ?? item.quantidadeConfirmada}
            </span>
          )}
        </span>

        {/* Valor */}
        <span className="order-7 ml-auto text-right font-mono text-[13px] font-medium tabular-nums text-neutral-900 lg:order-none lg:ml-0">
          R$ {brl(valorLinha)}
        </span>

        {/* Remover */}
        <span className="order-8 lg:order-none">
          {podeRemover && !removido ? (
            <button
              type="button"
              aria-label={`Remover ${item.sku} por acordo`}
              title="Remover por acordo com o cliente"
              onClick={aoAbrirRemocao}
              className="flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-50 hover:text-[var(--color-perigo)]"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16" />
                <path d="M9 7V5h6v2" />
                <path d="M6 7l1 13h10l1-13" />
              </svg>
            </button>
          ) : null}
        </span>
      </div>

      {removendo ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <input
            value={motivo}
            onChange={(e) => aoMudarMotivo(e.target.value)}
            placeholder="O que foi combinado com o cliente"
            autoFocus
            className="h-8 min-w-[220px] flex-1 rounded-md border border-neutral-200 px-2.5 text-[12.5px]"
          />
          <Botao
            variante="perigo"
            tamanho="compacto"
            disabled={motivo.trim().length < 5}
            onClick={aoRemover}
          >
            Remover
          </Botao>
        </div>
      ) : null}
    </div>
  );
}
