import { PERM, type ItemCatalogo, type Pedido, type PedidoItem } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';
import { Foto } from '../ui/Foto';
import { juntar } from '../ui/juntar';
import { ROTULO_STATUS, SeloStatus } from './Pedidos';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Acao = 'devolver' | 'recusar' | 'cancelar' | 'faturar' | 'incluir' | null;

export function PedidoDetalhe() {
  const { pedidoId = '' } = useParams();
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [acao, setAcao] = useState<Acao>(null);
  const [motivo, setMotivo] = useState('');
  const [justificativaSemSaldo, setJustificativaSemSaldo] = useState('');

  /** O que a equipe vai confirmar de cada item. Começa no que foi pedido. */
  const [confirmacao, setConfirmacao] = useState<Record<string, string>>({});

  const consulta = useQuery({
    queryKey: ['pedidos', pedidoId],
    queryFn: () => pedir<Pedido>(`/pedidos/${pedidoId}`),
  });

  const pedido = consulta.data;

  // A confirmação nasce preenchida com o que o cliente pediu. Fazer o operador
  // digitar tudo de novo para o caso comum — está tudo disponível — seria
  // trabalho inventado.
  useEffect(() => {
    if (!pedido) return;

    setConfirmacao((atual) => {
      if (Object.keys(atual).length > 0) return atual;

      const inicial: Record<string, string> = {};
      for (const i of pedido.itens) {
        if (i.status === 'REMOVIDO' || i.status === 'CANCELADO') continue;
        // Sugere o que o cliente pediu — inclusive quando falta saldo.
        //
        // Disponível aqui é aviso, não teto: a API deixa confirmar acima dele
        // com permissão e justificativa, e marca o item como
        // `confirmadoSemSaldo`. Se a tela cortasse pelo disponível, faltar
        // estoque devolveria o item ao cliente sozinho, no meio de um pedido
        // que o operador confirmaria sem nem olhar a linha — a falta
        // decidindo a venda em silêncio. Devolver é ato: digita-se zero.
        inicial[i.id] = String(Number(i.quantidadeSolicitada) || Number(i.quantidadeConfirmada));
      }
      return inicial;
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
      pedir<Pedido>(`/pedidos/${pedidoId}/confirmar`, {
        method: 'POST',
        body: {
          itens: Object.entries(confirmacao).map(([itemId, quantidadeConfirmada]) => ({
            itemId,
            quantidadeConfirmada: quantidadeConfirmada || '0',
          })),
          ...(justificativaSemSaldo ? { justificativaSemSaldo } : {}),
        },
      }),
    onSuccess: async (p) => {
      setSucesso(
        p.status === 'CONFIRMADO_PARCIALMENTE'
          ? 'Confirmado em parte. Os itens devolvidos aparecem para o cliente com o motivo.'
          : 'Pedido confirmado. O estoque está reservado.',
      );
      await recarregar();
    },
    onError: aoFalhar,
  });

  const encerrar = useMutation({
    mutationFn: (qual: 'devolver' | 'recusar' | 'cancelar') =>
      pedir<Pedido>(`/pedidos/${pedidoId}/${qual}`, { method: 'POST', body: { motivo } }),
    onSuccess: async () => {
      setSucesso('Pedido encerrado. O cliente vê o motivo na linha do tempo.');
      await recarregar();
    },
    onError: aoFalhar,
  });

  const faturar = useMutation({
    mutationFn: () =>
      pedir<{ vendaNumero: number }>(`/pedidos/${pedidoId}/faturar`, {
        method: 'POST',
        body: {
          pagamentos: [
            { forma: motivo || 'PIX', valor: pedido?.valorConfirmado ?? '0', parcelas: 1 },
          ],
        },
      }),
    onSuccess: async (r) => {
      setSucesso(`Faturado. Venda ${r.vendaNumero} gerada e estoque baixado.`);
      await recarregar();
    },
    onError: aoFalhar,
  });

  const remover = useMutation({
    mutationFn: (p: { itemId: string; motivo: string }) =>
      pedir<Pedido>(`/pedidos/${pedidoId}/itens/${p.itemId}/remover`, {
        method: 'POST',
        body: { motivo: p.motivo },
      }),
    onSuccess: async () => {
      setSucesso('Item removido por acordo. Não entra no relatório de ruptura.');
      await recarregar();
    },
    onError: aoFalhar,
  });

  const [buscaItem, setBuscaItem] = useState('');
  const [quantidadeNova, setQuantidadeNova] = useState('1');

  const catalogo = useQuery({
    // A tabela entra na chave: o mesmo termo em dois pedidos de tabelas
    // diferentes tem preços diferentes, e uma chave comum serviria o do outro.
    queryKey: ['pedidos', 'catalogo-equipe', pedido?.tabelaPrecoId ?? 'padrao', buscaItem],
    queryFn: () =>
      pedir<ItemCatalogo[]>(
        // A tabela do PEDIDO, não a padrão. Sem ela o operador lê um preço
        // na busca e o item entra no pedido por outro — foi o que aconteceu
        // com uma faixa: R$ 129,90 na tela, R$ 110,42 gravados.
        `/vendas/itens?termo=${encodeURIComponent(buscaItem)}&lojaId=${pedido?.lojaId ?? ''}` +
          (pedido?.tabelaPrecoId ? `&tabelaPrecoId=${pedido.tabelaPrecoId}` : ''),
      ),
    enabled: acao === 'incluir' && buscaItem.trim().length >= 2 && Boolean(pedido),
  });

  const incluir = useMutation({
    mutationFn: (variacaoId: string) =>
      pedir<Pedido>(`/pedidos/${pedidoId}/itens`, {
        method: 'POST',
        body: { variacaoId, quantidade: quantidadeNova, motivo },
      }),
    onSuccess: async (p) => {
      setSucesso(
        p.status === 'AGUARDANDO_ACEITE_CLIENTE'
          ? 'Item incluído. O total subiu, então o pedido está esperando o aceite do cliente.'
          : 'Item incluído.',
      );
      setBuscaItem('');
      await recarregar();
    },
    onError: aoFalhar,
  });

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando pedido…" />;
  }

  if (consulta.isError || !pedido) {
    return (
      <EstadoErro
        titulo="Pedido não encontrado"
        descricao="O pedido não existe ou pertence a outra empresa."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    );
  }

  const editavel = pedido.status === 'AGUARDANDO_CONFIRMACAO';
  const confirmavel = editavel && pode(PERM.pedido.confirmar);
  const faturavel =
    (pedido.status === 'CONFIRMADO' || pedido.status === 'CONFIRMADO_PARCIALMENTE') &&
    pode(PERM.pedido.faturar);

  const diferenca = Number(pedido.diferenca);
  const ocupado = confirmar.isPending || encerrar.isPending || faturar.isPending;

  // O que a confirmação atual vai cobrar. Calculado na tela para o operador
  // ver o número mudar enquanto ajusta — não é a conta que vale, que é a do
  // servidor, mas é a que ele precisa enxergar antes de apertar o botão.
  const totalConfirmando = pedido.itens.reduce((soma, i) => {
    if (i.status === 'REMOVIDO' || i.status === 'CANCELADO') return soma;
    return soma + Number(confirmacao[i.id] ?? 0) * Number(i.precoUnitario);
  }, 0);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <Link to="/pedidos" className="text-[13.5px] text-neutral-500 no-underline hover:underline">
          Pedidos
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-mono text-[13.5px] font-medium text-neutral-900">
          #{pedido.numero}
        </span>
        <SeloStatus status={pedido.status} />
        <div className="hidden flex-1 sm:block" />

        {editavel && pode(PERM.pedido.editarItens) ? (
          <Botao
            variante="secundario"
            onClick={() => {
              setAcao(acao === 'incluir' ? null : 'incluir');
              setMotivo('');
            }}
          >
            Incluir item
          </Botao>
        ) : null}

        {editavel && pode(PERM.pedido.devolver) ? (
          <Botao variante="secundario" onClick={() => setAcao('devolver')}>
            Devolver
          </Botao>
        ) : null}

        {editavel && pode(PERM.pedido.recusar) ? (
          <Botao variante="perigo" onClick={() => setAcao('recusar')}>
            Recusar
          </Botao>
        ) : null}

        {faturavel ? (
          <>
            <Botao variante="secundario" onClick={() => setAcao('cancelar')}>
              Cancelar
            </Botao>
            <Botao variante="primario" onClick={() => setAcao('faturar')}>
              Faturar
            </Botao>
          </>
        ) : null}

        {confirmavel ? (
          <Botao
            variante="primario"
            carregando={confirmar.isPending}
            onClick={() => confirmar.mutate()}
          >
            Confirmar pedido
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
                {pedido.cliente}
              </h1>
              <p className="mt-1 text-[13px] text-neutral-500">
                {pedido.solicitante ? `Enviado por ${pedido.solicitante} · ` : ''}
                {pedido.loja}
                {pedido.tabelaPreco ? ` · tabela ${pedido.tabelaPreco}` : ''}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                {pedido.status === 'AGUARDANDO_CONFIRMACAO' ? 'Confirmando' : 'Valor'}
              </p>
              <p className="font-mono text-[26px] font-bold leading-8 text-neutral-900">
                R$ {brl(confirmavel ? totalConfirmando : pedido.valorConfirmado)}
              </p>
              <p className="text-[12px] text-neutral-400">
                cliente enviou R$ {brl(pedido.valorSolicitado)}
              </p>
            </div>
          </div>

          {sucesso ? <Aviso tom="sucesso">{sucesso}</Aviso> : null}
          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {pedido.status === 'AGUARDANDO_ACEITE_CLIENTE' ? (
            <Aviso tom="info" titulo="Esperando o cliente">
              A edição fez o total subir R$ {brl(Math.abs(diferenca))}. O pedido só volta para
              confirmação depois que o cliente aceitar no aplicativo — é o registro de que ele
              concordou com o valor maior.
            </Aviso>
          ) : null}

          {pedido.resumoAlteracao ? (
            <Aviso tom="atencao" titulo="A equipe alterou este pedido">
              {pedido.resumoAlteracao}
            </Aviso>
          ) : null}

          {acao === 'incluir' ? (
            <section className="flex flex-col gap-3 rounded-md border border-primary-100 bg-primary-50 p-4">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                Incluir item combinado
              </h2>
              <p className="-mt-2 text-[12.5px] text-neutral-600">
                Entra com quantidade solicitada zero — o cliente não pediu isto. Se o total subir, o
                pedido vai esperar o aceite dele.
              </p>

              <div className="flex flex-wrap items-end gap-2.5">
                <label className="flex min-w-[240px] flex-1 flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Produto
                  </span>
                  <input
                    value={buscaItem}
                    onChange={(e) => setBuscaItem(e.target.value)}
                    placeholder="SKU ou nome"
                    className="h-10 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Qtd.
                  </span>
                  <input
                    value={quantidadeNova}
                    onChange={(e) => setQuantidadeNova(e.target.value)}
                    className="h-10 w-[70px] rounded-md border border-neutral-200 px-2.5 text-center font-mono text-[13.5px]"
                  />
                </label>

                <label className="flex min-w-[260px] flex-1 flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    O que foi combinado
                  </span>
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Vai para a linha do tempo que o cliente vê"
                    className="h-10 rounded-md border border-neutral-200 px-2.5 text-[13.5px]"
                  />
                </label>
              </div>

              {catalogo.data && catalogo.data.length > 0 ? (
                <div className="max-h-[180px] overflow-auto rounded-md border border-neutral-100 bg-white">
                  {catalogo.data.map((i) => (
                    <button
                      key={i.variacaoId}
                      type="button"
                      disabled={motivo.trim().length < 5 || incluir.isPending}
                      onClick={() => incluir.mutate(i.variacaoId)}
                      className="flex w-full items-center gap-2.5 border-b border-neutral-50 px-3 py-2 text-left last:border-0 hover:bg-neutral-25 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-neutral-900">
                          {i.produto}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-neutral-500">
                          {i.sku}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[13px] text-neutral-700">
                        R$ {brl(i.preco)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {motivo.trim().length < 5 && buscaItem.trim().length >= 2 ? (
                <p className="text-[12px] text-[--color-atencao]">
                  Descreva o que foi combinado antes de escolher o item.
                </p>
              ) : null}
            </section>
          ) : null}

          {acao !== null && acao !== 'incluir' ? (
            <section className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-neutral-25 p-4">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                {acao === 'faturar' ? 'Faturar pedido' : `Confirmar: ${acao}`}
              </h2>

              {acao === 'faturar' ? (
                <>
                  <p className="-mt-2 text-[12.5px] text-neutral-600">
                    Gera a venda, baixa o estoque e consome a reserva. Total: R${' '}
                    {brl(pedido.valorConfirmado)}.
                  </p>
                  <select
                    value={motivo || 'PIX'}
                    onChange={(e) => setMotivo(e.target.value)}
                    aria-label="Forma de pagamento"
                    className="h-10 w-[220px] rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                  >
                    {['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO', 'PRAZO', 'CARTEIRA'].map(
                      (f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ),
                    )}
                  </select>
                </>
              ) : (
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo — o cliente vê este texto"
                  autoFocus
                  className="h-10 rounded-md border border-neutral-200 bg-white px-2.5 text-[13.5px]"
                />
              )}

              <div className="flex gap-2">
                <Botao
                  variante="primario"
                  carregando={ocupado}
                  disabled={acao !== 'faturar' && motivo.trim().length < 5}
                  onClick={() => {
                    if (acao === 'faturar') faturar.mutate();
                    else encerrar.mutate(acao);
                  }}
                >
                  Confirmar
                </Botao>
                <Botao
                  variante="secundario"
                  onClick={() => {
                    setAcao(null);
                    setMotivo('');
                  }}
                >
                  Cancelar
                </Botao>
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-2 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">Itens</h2>
              {confirmavel ? (
                <p className="text-[12px] text-neutral-500">
                  Ajuste a quantidade. Zero devolve o item ao cliente.
                </p>
              ) : null}
            </div>

            <div className="hidden grid-cols-[44px_minmax(0,1fr)_92px_92px_108px_104px_80px] items-center gap-2.5 border-b border-neutral-100 pb-1.5 sm:grid">
              {['', 'Item', 'Pedido', 'Disp.', 'Confirmar', 'Total', ''].map((t, i) => (
                <span
                  key={t || `c${String(i)}`}
                  className={juntar(
                    'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                    i >= 2 && i <= 5 && 'text-right',
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            {pedido.itens.map((item) => (
              <LinhaItem
                key={item.id}
                item={item}
                editavel={confirmavel}
                podeRemover={editavel && pode(PERM.pedido.editarItens)}
                valor={confirmacao[item.id] ?? '0'}
                aoMudar={(v) => setConfirmacao((a) => ({ ...a, [item.id]: v }))}
                aoRemover={(m) => remover.mutate({ itemId: item.id, motivo: m })}
              />
            ))}

            {confirmavel ? (
              <label className="mt-2 flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  Justificativa para confirmar acima do disponível (se for o caso)
                </span>
                <input
                  value={justificativaSemSaldo}
                  onChange={(e) => setJustificativaSemSaldo(e.target.value)}
                  placeholder="Obrigatória se alguma quantidade passar do disponível"
                  className="h-10 rounded-md border border-neutral-200 px-2.5 text-[13.5px]"
                />
              </label>
            ) : null}
          </section>

          <section className="flex flex-col gap-2 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              Linha do tempo
            </h2>
            {/* Quem fez, o que mudou e por quê. É o mesmo texto que o cliente
                vê no aplicativo — sem isso ele abre o app, vê outro valor e
                liga para reclamar. docs/ORDERS.md §6. */}
            {pedido.eventos.map((e) => (
              <div key={e.id} className="flex gap-3 border-b border-neutral-50 py-2 last:border-0">
                <span className="w-[112px] shrink-0 font-mono text-[11.5px] text-neutral-400">
                  {new Date(e.criadoEm).toLocaleDateString('pt-BR')}{' '}
                  {new Date(e.criadoEm).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-neutral-900">
                    {e.ator ?? (e.atorTipo === 'SISTEMA' ? 'Sistema' : '—')}
                    <span className="text-neutral-500"> · {ROTULO_STATUS[e.paraStatus]}</span>
                  </p>
                  {e.motivo ? <p className="text-[12.5px] text-neutral-500">{e.motivo}</p> : null}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}

function LinhaItem({
  item,
  editavel,
  podeRemover,
  valor,
  aoMudar,
  aoRemover,
}: {
  readonly item: PedidoItem;
  readonly editavel: boolean;
  readonly podeRemover: boolean;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly aoRemover: (motivo: string) => void;
}) {
  const [removendo, setRemovendo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const removido = item.status === 'REMOVIDO';
  const devolvido = item.status === 'DEVOLVIDO';
  const disponivel = Number(item.disponivelAgora ?? 0);
  const confirmando = Number(valor || 0);
  const passaDoDisponivel = editavel && confirmando > disponivel;

  return (
    <div
      className={juntar('border-b border-neutral-50 py-2 last:border-0', removido && 'opacity-50')}
    >
      <div
        className={juntar(
          'flex flex-wrap items-center gap-2.5',
          'sm:grid sm:grid-cols-[44px_minmax(0,1fr)_92px_92px_108px_104px_80px]',
        )}
      >
        <div className="size-10 shrink-0 overflow-hidden rounded bg-primary-50">
          {item.imagemPrincipalId ? (
            <Foto imagemId={item.imagemPrincipalId} alt={item.produto} className="size-full" />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={juntar(
              'truncate text-[13.5px] text-neutral-900',
              removido && 'line-through',
            )}
          >
            {item.produto}
          </p>
          <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-neutral-500">
            {item.sku}
            {item.origem === 'ADICIONADO_EQUIPE' ? (
              <span className="rounded bg-primary-50 px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-primary-700">
                incluído pela equipe
              </span>
            ) : null}
            {/* REMOVIDO e DEVOLVIDO são coisas diferentes e a tela não pode
                colapsá-las: um é acordo, o outro é falta. */}
            {removido ? (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-neutral-600">
                removido por acordo
              </span>
            ) : null}
            {devolvido ? (
              <span className="rounded bg-[--color-perigo-fundo] px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-[--color-perigo]">
                devolvido — faltou saldo
              </span>
            ) : null}
            {item.confirmadoSemSaldo ? (
              <span className="rounded bg-[--color-atencao-fundo] px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-[--color-atencao]">
                sem saldo
              </span>
            ) : null}
            {/* O aviso precisa ser visível, não um `title`: no celular não há
                hover, e é no celular que a equipe confirma. */}
            {passaDoDisponivel ? (
              <span className="rounded bg-[--color-atencao-fundo] px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-[--color-atencao]">
                faltam {confirmando - disponivel}
              </span>
            ) : null}
          </p>
          {item.motivoRemocao ? (
            <p className="truncate text-[11.5px] text-neutral-500">{item.motivoRemocao}</p>
          ) : null}
          {item.motivoDevolucao ? (
            <p className="truncate text-[11.5px] text-[--color-perigo]">{item.motivoDevolucao}</p>
          ) : null}
        </div>

        <div className="flex w-full items-center gap-3 pl-[54px] sm:contents">
          <span className="text-right font-mono text-[13px] text-neutral-600">
            <span className="mr-1 font-sans text-[10.5px] uppercase tracking-[0.04em] text-neutral-400 sm:hidden">
              pedido
            </span>
            {item.quantidadeSolicitada}
          </span>

          <span
            className={juntar(
              'text-right font-mono text-[13px]',
              disponivel <= 0 ? 'text-[--color-perigo]' : 'text-neutral-600',
            )}
          >
            <span className="mr-1 font-sans text-[10.5px] uppercase tracking-[0.04em] text-neutral-400 sm:hidden">
              disp.
            </span>
            {item.disponivelAgora ?? '—'}
          </span>

          <span className="ml-auto text-right sm:ml-0">
            {editavel && !removido ? (
              <input
                value={valor}
                onChange={(e) => aoMudar(e.target.value.replace(/\D/g, ''))}
                aria-label={`Confirmar ${item.sku}`}
                className={juntar(
                  'h-9 w-[76px] rounded-md border px-2 text-right font-mono text-[13.5px]',
                  passaDoDisponivel
                    ? 'border-[--color-atencao] bg-[--color-atencao-fundo]'
                    : 'border-neutral-200',
                )}
                title={passaDoDisponivel ? 'Acima do disponível — exige justificativa' : undefined}
              />
            ) : (
              <span className="font-mono text-[13px] text-neutral-900">
                {item.quantidadeConfirmada}
              </span>
            )}
          </span>
        </div>

        <div className="flex w-full items-center gap-3 pl-[54px] sm:contents">
          <span className="text-right font-mono text-[13.5px] font-medium text-neutral-900">
            R${' '}
            {brl(editavel && !removido ? confirmando * Number(item.precoUnitario) : item.totalItem)}
          </span>

          <span className="ml-auto text-right sm:ml-0">
            {podeRemover && !removido ? (
              <button
                type="button"
                onClick={() => setRemovendo((v) => !v)}
                className="text-[11.5px] font-medium text-neutral-500 underline decoration-neutral-300 underline-offset-2"
              >
                remover
              </button>
            ) : null}
          </span>
        </div>
      </div>

      {removendo ? (
        <div className="mt-2 flex items-center gap-2 pl-[54px]">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="O que foi combinado com o cliente"
            autoFocus
            className="h-9 flex-1 rounded-md border border-neutral-200 px-2.5 text-[13px]"
          />
          <Botao
            variante="perigo"
            tamanho="compacto"
            disabled={motivo.trim().length < 5}
            onClick={() => {
              aoRemover(motivo);
              setRemovendo(false);
              setMotivo('');
            }}
          >
            Remover
          </Botao>
        </div>
      ) : null}
    </div>
  );
}
