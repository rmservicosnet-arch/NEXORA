import {
  PERM,
  type Compra,
  type LojaPainel,
  type Fornecedor,
  type ItemCompraResumo,
  type ItemParaComprar,
  type PaginaCompras,
  type StatusCompra,
} from '@estoque/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v: string | number, casas = 0): string {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
}

const ROTULO: Record<StatusCompra, string> = {
  RASCUNHO: 'A receber',
  RECEBIDA: 'Recebida',
  ESTORNADA: 'Estornada',
};

const TOM: Record<StatusCompra, string> = {
  RASCUNHO: 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
  RECEBIDA: 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]',
  ESTORNADA: 'bg-neutral-100 text-neutral-500',
};

const RECORTES = [
  { chave: 'todas', rotulo: 'Todas', status: undefined, contagem: 'total' },
  { chave: 'rascunho', rotulo: 'A receber', status: 'RASCUNHO', contagem: 'rascunhos' },
  { chave: 'recebida', rotulo: 'Recebidas', status: 'RECEBIDA', contagem: 'recebidas' },
  { chave: 'estornada', rotulo: 'Estornadas', status: 'ESTORNADA', contagem: 'estornadas' },
] as const;

type Chave = (typeof RECORTES)[number]['chave'];

export function Compras() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [recorte, setRecorte] = useState<Chave>('todas');
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const atual = RECORTES.find((r) => r.chave === recorte) ?? RECORTES[0];

  const lista = useQuery({
    queryKey: ['compras', recorte, busca],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '40' });
      if (atual.status) p.set('status', atual.status);
      if (busca) p.set('termo', busca);
      return pedir<PaginaCompras>(`/compras?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  // A primeira da lista abre sozinha: painel vazio ao lado de uma tabela cheia
  // é meia tela desperdiçada, e a nota a receber é o que se veio fazer aqui.
  useEffect(() => {
    if (!selecionada && lista.data && lista.data.itens.length > 0) {
      setSelecionada(lista.data.itens[0]!.id);
    }
  }, [lista.data, selecionada]);

  const podeReceber = pode(PERM.compra.receber);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Compras</span>
        <div className="flex-1" />
        {podeReceber ? (
          <Botao
            variante="primario"
            onClick={() => {
              setErro(null);
              setCriando(true);
            }}
          >
            Nova entrada
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex w-full flex-col gap-4">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Compras
            </h1>
            <p className="mt-1 text-[13.5px] text-neutral-500">
              É por aqui que a mercadoria entra{' '}
              <strong className="font-semibold text-neutral-700">com custo</strong> — e é o custo
              daqui que forma o custo médio de cada item.
            </p>
          </div>

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {criando ? (
            <NovaEntrada
              aoFechar={() => setCriando(false)}
              aoCriar={async (id) => {
                setCriando(false);
                setSelecionada(id);
                await fila.invalidateQueries({ queryKey: ['compras'] });
              }}
              aoFalhar={setErro}
            />
          ) : null}

          {lista.data ? <Indicadores resumo={lista.data.resumo} /> : null}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <section className="w-full min-w-0 flex-1 overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
                {RECORTES.map((r) => (
                  <button
                    key={r.chave}
                    type="button"
                    onClick={() => {
                      setRecorte(r.chave);
                      setSelecionada(null);
                    }}
                    className={juntar(
                      'flex h-[30px] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px]',
                      recorte === r.chave
                        ? 'border-primary-600 bg-primary-600 font-semibold text-white'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300',
                    )}
                  >
                    {r.rotulo}
                    <span className="font-mono text-[11.5px] font-normal">
                      {lista.data ? lista.data.contagens[r.contagem] : '—'}
                    </span>
                  </button>
                ))}

                <div className="flex-1" />

                <input
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Nota ou fornecedor"
                  aria-label="Buscar compra"
                  className="h-8 w-[220px] rounded-md border border-neutral-200 px-2.5 text-[12.5px]"
                />
              </div>

              <div className="hidden grid-cols-[100px_minmax(0,1fr)_96px_52px_112px_104px] items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 sm:grid">
                <Coluna>Nota</Coluna>
                <Coluna>Fornecedor · destino</Coluna>
                <Coluna>Emissão</Coluna>
                <Coluna direita>Itens</Coluna>
                <Coluna direita>Valor</Coluna>
                <Coluna>Situação</Coluna>
              </div>

              {lista.isPending ? <EstadoCarregando titulo="Carregando compras…" /> : null}

              {lista.data?.itens.length === 0 ? (
                <EstadoVazio
                  titulo={busca ? 'Nada encontrado' : 'Nenhuma compra neste recorte'}
                  descricao={
                    busca
                      ? 'Tente outro número de nota ou outro fornecedor.'
                      : 'Lance a nota do fornecedor para a mercadoria entrar com custo.'
                  }
                />
              ) : null}

              {(lista.data?.itens ?? []).map((c) => (
                <LinhaCompra
                  key={c.id}
                  compra={c}
                  ativa={c.id === selecionada}
                  aoAbrir={() => setSelecionada(c.id)}
                />
              ))}
            </section>

            {selecionada ? (
              <PainelCompra
                id={selecionada}
                podeReceber={podeReceber}
                aoMudar={async () => {
                  await fila.invalidateQueries({ queryKey: ['compras'] });
                }}
                aoFalhar={setErro}
              />
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

function Coluna({
  children,
  direita,
}: {
  readonly children: React.ReactNode;
  readonly direita?: boolean;
}) {
  return (
    <span
      className={juntar(
        'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
        direita && 'text-right',
      )}
    >
      {children}
    </span>
  );
}

function Indicadores({ resumo }: { readonly resumo: PaginaCompras['resumo'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Cartao
        rotulo="A receber"
        valor={`${String(resumo.aReceber)}`}
        sufixo={resumo.aReceber === 1 ? 'nota' : 'notas'}
        nota={`R$ ${brl(resumo.valorAReceber)} de mercadoria ainda fora do estoque`}
        tom={resumo.aReceber > 0 ? 'atencao' : undefined}
      />
      <Cartao
        rotulo="Recebido no mês"
        valor={`R$ ${brl(resumo.recebidoNoPeriodo)}`}
        nota={`${String(resumo.notasNoPeriodo)} ${resumo.notasNoPeriodo === 1 ? 'nota' : 'notas'}`}
      />
      {/*
        Custo zero não é margem cheia: é item que nunca teve entrada com custo.
        Dizer isso ao lado do número evita que alguém comemore 100%.
      */}
      <Cartao
        rotulo="Itens sem custo"
        valor={String(resumo.itensSemCusto)}
        nota="com saldo e custo zero — a margem deles é nula, não cheia"
        tom={resumo.itensSemCusto > 0 ? 'perigo' : undefined}
      />
      <Cartao rotulo="Fornecedores ativos" valor={String(resumo.fornecedoresAtivos)} nota="" />
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  sufixo,
  nota,
  tom,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly sufixo?: string;
  readonly nota: string;
  readonly tom?: 'atencao' | 'perigo';
}) {
  return (
    <div
      className={juntar(
        'rounded-md border bg-white px-4 py-3',
        tom === 'perigo'
          ? 'border-[#f0c9cb]'
          : tom === 'atencao'
            ? 'border-[#ebd6a8]'
            : 'border-neutral-100',
      )}
    >
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1 font-display text-[26px] font-bold leading-[30px] tabular-nums',
          tom === 'perigo'
            ? 'text-[var(--color-perigo)]'
            : tom === 'atencao'
              ? 'text-[var(--color-atencao)]'
              : 'text-neutral-900',
        )}
      >
        {valor}
        {sufixo ? (
          <span className="ml-1.5 font-sans text-[14px] font-medium text-neutral-500">
            {sufixo}
          </span>
        ) : null}
      </p>
      {nota ? <p className="mt-0.5 text-[11.5px] leading-4 text-neutral-500">{nota}</p> : null}
    </div>
  );
}

function LinhaCompra({
  compra,
  ativa,
  aoAbrir,
}: {
  readonly compra: Compra;
  readonly ativa: boolean;
  readonly aoAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={juntar(
        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 text-left last:border-0 hover:bg-neutral-25 sm:grid-cols-[100px_minmax(0,1fr)_96px_52px_112px_104px]',
        ativa && 'bg-primary-50 hover:bg-primary-50',
        compra.status === 'RASCUNHO' && !ativa && 'bg-[#fdf6ec]',
      )}
    >
      <span className="col-start-1 row-start-1 font-mono text-[12.5px] font-medium text-neutral-900 sm:col-start-auto sm:row-start-auto">
        {compra.numeroNota ? `NF ${compra.numeroNota}` : 'sem nota'}
      </span>

      <span className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-auto sm:row-start-auto">
        <span className="block truncate text-[13px] text-neutral-900">{compra.fornecedor}</span>
        <span className="block truncate text-[11.5px] text-neutral-500">
          → {compra.local} · {compra.loja}
        </span>
      </span>

      <span className="col-start-2 row-start-3 text-right text-[12.5px] text-neutral-500 sm:col-start-auto sm:row-start-auto sm:text-left">
        {compra.emitidaEm ? new Date(compra.emitidaEm).toLocaleDateString('pt-BR') : '—'}
      </span>

      <span className="hidden text-right font-mono text-[12.5px] text-neutral-700 sm:block">
        {compra.itens.length}
      </span>

      <span className="col-start-2 row-start-1 text-right font-mono text-[13.5px] font-medium tabular-nums text-neutral-900 sm:col-start-auto sm:row-start-auto">
        R$ {brl(compra.valorTotal)}
      </span>

      <span className="col-start-1 row-start-3 sm:col-start-auto sm:row-start-auto">
        <span
          className={juntar(
            'inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold',
            TOM[compra.status],
          )}
        >
          {ROTULO[compra.status]}
        </span>
      </span>
    </button>
  );
}

function PainelCompra({
  id,
  podeReceber,
  aoMudar,
  aoFalhar,
}: {
  readonly id: string;
  readonly podeReceber: boolean;
  readonly aoMudar: () => Promise<void>;
  readonly aoFalhar: (mensagem: string) => void;
}) {
  const fila = useQueryClient();
  const [motivoEstorno, setMotivoEstorno] = useState('');
  const [estornando, setEstornando] = useState(false);

  /*
    Os itens do rascunho vivem em estado LOCAL ate alguem salvar.

    Digitar quantidade e custo item a item com uma escrita por tecla faria a
    nota ser reescrita quarenta vezes, e cada uma recalcularia o total. Quem
    grava e o botao — a armadilha do "cabecalho com Salvar e campo que grava
    no blur" e ter os dois.

    A chave do estado carrega o ID da compra: trocar de nota na lista NAO
    remonta o painel, e sem isso as linhas digitadas da anterior ficariam na
    tela da seguinte.
  */
  const [rascunho, setRascunho] = useState<LinhaRascunho[] | null>(null);
  const [donoDoRascunho, setDonoDoRascunho] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: ['compras', 'detalhe', id],
    queryFn: () => pedir<Compra>(`/compras/${id}`),
  });

  const salvarItens = useMutation({
    mutationFn: (itens: LinhaRascunho[]) =>
      pedir<Compra>(`/compras/${id}`, {
        method: 'PUT',
        body: {
          itens: itens.map((i) => ({
            variacaoId: i.variacaoId,
            quantidade: i.quantidade,
            custoUnitario: i.custoUnitario,
          })),
        },
      }),
    onSuccess: async () => {
      setRascunho(null);
      setDonoDoRascunho(null);
      await fila.invalidateQueries({ queryKey: ['compras', 'detalhe', id] });
      await aoMudar();
    },
    onError: (e) => {
      aoFalhar(
        e instanceof ErroRequisicao ? e.corpo.mensagem : 'Nao foi possivel salvar os itens.',
      );
    },
  });

  const acao = useMutation({
    mutationFn: (o: { tipo: 'receber' | 'estornar'; motivo?: string }) =>
      pedir<Compra>(`/compras/${id}/${o.tipo}`, {
        method: 'POST',
        body: o.tipo === 'estornar' ? { motivo: o.motivo ?? '' } : {},
      }),
    onSuccess: async () => {
      setEstornando(false);
      setMotivoEstorno('');
      await fila.invalidateQueries({ queryKey: ['compras', 'detalhe', id] });
      await aoMudar();
    },
    onError: (e) => {
      aoFalhar(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  const compra = consulta.data;

  if (!compra) {
    return (
      <aside className="w-full shrink-0 rounded-md border border-neutral-100 bg-white p-5 shadow-sm lg:w-[420px]">
        <EstadoCarregando titulo="Carregando nota…" />
      </aside>
    );
  }

  const editavel = compra.status === 'RASCUNHO' && podeReceber;

  // O estado local pertence a ESTA nota. Se o painel trocou de nota sem
  // remontar, o rascunho da anterior nao vale mais.
  const meuRascunho = donoDoRascunho === id ? rascunho : null;

  function editar(proximas: LinhaRascunho[]): void {
    setDonoDoRascunho(id);
    setRascunho(proximas);
  }

  const linhas: LinhaRascunho[] =
    meuRascunho ??
    compra.itens.map((i) => ({
      variacaoId: i.variacaoId,
      sku: i.sku,
      produto: i.produto,
      descricaoVariacao: i.descricaoVariacao,
      quantidade: String(Number(i.quantidade)),
      custoUnitario: String(Number(i.custoUnitario)),
      saldoAtual: i.saldoAtual ?? null,
      custoMedioAtual: i.custoMedioAtual ?? null,
    }));

  const naoSalvo = meuRascunho !== null;
  const totalLocal = linhas.reduce(
    (soma, i) => soma + (Number(i.quantidade) || 0) * (Number(i.custoUnitario) || 0),
    0,
  );
  const unidades = linhas.reduce((soma, i) => soma + (Number(i.quantidade) || 0), 0);

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm lg:w-[420px]">
      <div className="border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[15px] font-bold text-neutral-900">
            {compra.numeroNota ? `NF ${compra.numeroNota}` : 'Sem número de nota'}
          </h2>
          <span
            className={juntar(
              'inline-block rounded-full px-2.5 py-[3px] text-[11px] font-semibold',
              TOM[compra.status],
            )}
          >
            {ROTULO[compra.status]}
          </span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-neutral-500">
          {compra.fornecedor}
          {compra.emitidaEm
            ? ` · emissão ${new Date(compra.emitidaEm).toLocaleDateString('pt-BR')}`
            : ''}{' '}
          · destino {compra.local}
        </p>
        {compra.recebidaEm ? (
          <p className="mt-0.5 text-[11.5px] text-neutral-400">
            recebida em {new Date(compra.recebidaEm).toLocaleDateString('pt-BR')}
            {compra.recebidaPor ? ` por ${compra.recebidaPor}` : ''}
          </p>
        ) : null}
      </div>

      {compra.status === 'ESTORNADA' && compra.motivoEstorno ? (
        <div className="border-b border-neutral-100 px-4 py-2.5">
          <p className="text-[12px] leading-4 text-neutral-600">
            <strong className="font-semibold">Estornada:</strong> “{compra.motivoEstorno}”
            {compra.estornadaPor ? ` — ${compra.estornadaPor}` : ''}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_44px_84px_96px] items-center gap-2.5 border-b border-neutral-100 bg-neutral-25 px-4 py-2">
        <Coluna>Item</Coluna>
        <Coluna direita>Qtd</Coluna>
        <Coluna direita>Custo un.</Coluna>
        <Coluna direita>{compra.status === 'RASCUNHO' ? 'Médio vai a' : 'Médio depois'}</Coluna>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {linhas.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-neutral-500">
            Nenhum item ainda. Busque abaixo para preencher a nota.
          </p>
        ) : null}

        {linhas.map((linha, indice) =>
          editavel ? (
            <LinhaEditavel
              key={linha.variacaoId}
              linha={linha}
              aoMudar={(campo, valor) =>
                editar(linhas.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l)))
              }
              aoRemover={() => editar(linhas.filter((_, i) => i !== indice))}
            />
          ) : (
            <LinhaItem
              key={linha.variacaoId}
              item={compra.itens[indice]!}
              rascunho={compra.status === 'RASCUNHO'}
            />
          ),
        )}
      </div>

      {editavel ? (
        <IncluirItem
          localId={compra.localId}
          jaNaNota={linhas.map((l) => l.variacaoId)}
          aoIncluir={(item) =>
            editar([
              ...linhas,
              {
                variacaoId: item.variacaoId,
                sku: item.sku,
                produto: item.produto,
                descricaoVariacao: item.descricaoVariacao,
                quantidade: '1',
                // O custo da ULTIMA entrada como sugestao: e um numero que
                // existiu de verdade, diferente do custo medio, que e media.
                custoUnitario: item.ultimoCusto ? String(Number(item.ultimoCusto)) : '',
                saldoAtual: item.saldoAtual,
                custoMedioAtual: item.custoMedioAtual,
              },
            ])
          }
        />
      ) : null}

      <div className="border-t border-neutral-100">
        <div className="flex items-baseline justify-between px-4 py-2.5">
          <span className="text-[12.5px] text-neutral-500">
            {compra.itens.length} {compra.itens.length === 1 ? 'item' : 'itens'} · {num(unidades)}{' '}
            unidades
          </span>
          <span className="font-display text-[20px] font-bold tabular-nums text-neutral-900">
            R$ {brl(naoSalvo ? totalLocal : compra.valorTotal)}
          </span>
        </div>

        {naoSalvo ? (
          <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-2.5">
            <span className="flex-1 text-[12px] font-medium text-[var(--color-atencao)]">
              Alteracoes nao salvas
            </span>
            <Botao
              variante="secundario"
              tamanho="compacto"
              onClick={() => {
                setRascunho(null);
                setDonoDoRascunho(null);
              }}
            >
              Descartar
            </Botao>
            <Botao
              variante="primario"
              tamanho="compacto"
              carregando={salvarItens.isPending}
              disabled={linhas.some((l) => !l.quantidade || !l.custoUnitario)}
              onClick={() => salvarItens.mutate(linhas)}
            >
              Salvar itens
            </Botao>
          </div>
        ) : null}

        {compra.status === 'RASCUNHO' && podeReceber ? (
          <>
            {/*
              O que o botão FAZ, antes de ele ser apertado. Receber não é
              salvar: é gravar N movimentos num razão append-only e mexer no
              custo médio de N itens.
            */}
            <div className="mx-4 rounded-md border border-[#ebd6a8] bg-[var(--color-atencao-fundo)] px-3 py-2.5">
              <p className="text-[11.5px] leading-4 text-[#7a5205]">
                Receber grava{' '}
                <strong className="font-semibold">
                  {compra.itens.length}{' '}
                  {compra.itens.length === 1 ? 'movimento de entrada' : 'movimentos de entrada'}
                </strong>{' '}
                no razão e recalcula o custo médio. O razão é imutável: correção é{' '}
                <strong className="font-semibold">estorno</strong>, que gera lançamento contrário —
                não apaga este.
              </p>
            </div>

            <div className="px-4 py-3">
              <Botao
                variante="primario"
                tamanho="pdv"
                carregando={acao.isPending}
                disabled={compra.itens.length === 0 || naoSalvo}
                onClick={() => acao.mutate({ tipo: 'receber' })}
              >
                Receber e lançar no estoque
              </Botao>
              {/*
                O motivo do bloqueio por escrito, nunca so o botao apagado.
                Receber com item digitado e nao salvo lancaria no estoque uma
                nota diferente da que esta na tela.
              */}
              {compra.itens.length === 0 ? (
                <p className="mt-1.5 text-center text-[11.5px] text-neutral-500">
                  Uma nota sem itens não tem o que dar entrada.
                </p>
              ) : naoSalvo ? (
                <p className="mt-1.5 text-center text-[11.5px] text-[var(--color-atencao)]">
                  Salve os itens antes: receber lançaria a nota que está gravada, não a que está na
                  tela.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {compra.status === 'RECEBIDA' && podeReceber ? (
          <div className="px-4 py-3">
            {estornando ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                    Motivo do estorno
                  </span>
                  <input
                    value={motivoEstorno}
                    onChange={(e) => setMotivoEstorno(e.target.value)}
                    autoFocus
                    placeholder="Nota lançada em duplicidade, devolução ao fornecedor…"
                    className="h-10 rounded-md border border-neutral-200 px-3 text-[13px]"
                  />
                </label>
                {/*
                  O motivo é obrigatório e o botão diz por quê enquanto está
                  curto — desabilitar sem explicar é o "avisar só por title".
                */}
                {motivoEstorno.trim().length < 5 ? (
                  <p className="text-[11.5px] text-neutral-500">
                    Escreva o motivo: o custo médio vai se mover de novo, e quem ler o razão daqui a
                    um mês precisa saber por quê.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Botao
                    variante="perigo"
                    carregando={acao.isPending}
                    disabled={motivoEstorno.trim().length < 5}
                    onClick={() => acao.mutate({ tipo: 'estornar', motivo: motivoEstorno.trim() })}
                  >
                    Confirmar estorno
                  </Botao>
                  <Botao variante="secundario" onClick={() => setEstornando(false)}>
                    Cancelar
                  </Botao>
                </div>
              </div>
            ) : (
              <Botao variante="secundario" onClick={() => setEstornando(true)}>
                Estornar entrada
              </Botao>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** Uma linha do rascunho, ainda em edicao. */
interface LinhaRascunho {
  readonly variacaoId: string;
  readonly sku: string;
  readonly produto: string;
  readonly descricaoVariacao: string;
  readonly quantidade: string;
  readonly custoUnitario: string;
  readonly saldoAtual: string | null;
  readonly custoMedioAtual: string | null;
}

/**
 * Linha do rascunho: quantidade e custo se digitam aqui.
 *
 * O saldo do destino aparece ao lado porque e ele que decide o que vai
 * acontecer com a media — e a previsao muda a cada tecla, antes de salvar.
 */
function LinhaEditavel({
  linha,
  aoMudar,
  aoRemover,
}: {
  readonly linha: LinhaRascunho;
  readonly aoMudar: (campo: 'quantidade' | 'custoUnitario', valor: string) => void;
  readonly aoRemover: () => void;
}) {
  const saldo = linha.saldoAtual === null ? null : Number(linha.saldoAtual);
  const medio = linha.custoMedioAtual === null ? null : Number(linha.custoMedioAtual);
  const q = Number(linha.quantidade) || 0;
  const c = Number(linha.custoUnitario) || 0;

  let previsto: number | null = null;
  let explicacao = '';
  let alerta = false;

  if (saldo !== null && medio !== null && q > 0) {
    if (saldo <= 0) {
      previsto = c;
      explicacao =
        saldo === 0 ? 'redefine · saldo era 0' : `saldo ${num(saldo)} · cobre a descoberto`;
      alerta = saldo < 0;
    } else {
      previsto = (saldo * medio + q * c) / (saldo + q);
      explicacao = `era ${brl(medio)}`;
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_56px_76px_88px] items-center gap-2 border-b border-neutral-50 px-4 py-2 last:border-0">
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-neutral-900">
          {linha.produto} <span className="text-neutral-500">· {linha.descricaoVariacao}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-[10.5px] text-neutral-400">{linha.sku}</span>
          <button
            type="button"
            onClick={aoRemover}
            className="text-[10.5px] text-neutral-400 underline underline-offset-2 hover:text-[var(--color-perigo)]"
          >
            remover
          </button>
        </span>
      </span>

      <input
        value={linha.quantidade}
        onChange={(e) => aoMudar('quantidade', e.target.value.replace(/[^\d.]/g, ''))}
        aria-label={`Quantidade de ${linha.sku}`}
        className="h-8 w-full rounded border border-neutral-200 px-1.5 text-right font-mono text-[12.5px]"
      />

      <input
        value={linha.custoUnitario}
        onChange={(e) => aoMudar('custoUnitario', e.target.value.replace(/[^\d.]/g, ''))}
        placeholder="0.00"
        aria-label={`Custo unitario de ${linha.sku}`}
        className="h-8 w-full rounded border border-neutral-200 px-1.5 text-right font-mono text-[12.5px]"
      />

      <span className="text-right">
        <span
          className={juntar(
            'block font-mono text-[12.5px] font-medium',
            alerta ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
          )}
        >
          {previsto === null ? '—' : brl(previsto)}
        </span>
        <span
          className={juntar(
            'block font-mono text-[10px]',
            alerta ? 'text-[var(--color-perigo)]' : 'text-neutral-400',
          )}
        >
          {explicacao}
        </span>
      </span>
    </div>
  );
}

/**
 * Incluir item na nota.
 *
 * Os resultados sobem ACIMA do campo: num bloco de rodape eles empurrariam a
 * propria busca para fora da tela. E cada resultado mostra SKU, variacao e
 * saldo — sem isso, dois "Kimono Trancado" sao indistinguiveis.
 */
function IncluirItem({
  localId,
  jaNaNota,
  aoIncluir,
}: {
  readonly localId: string;
  readonly jaNaNota: readonly string[];
  readonly aoIncluir: (item: ItemParaComprar) => void;
}) {
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 300);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = useQuery({
    queryKey: ['compras', 'itens', localId, busca],
    queryFn: () =>
      pedir<ItemParaComprar[]>(
        `/compras/itens?localId=${localId}&limite=8&termo=${encodeURIComponent(busca)}`,
      ),
    enabled: busca.length > 0,
  });

  const achados = (consulta.data ?? []).filter((i) => !jaNaNota.includes(i.variacaoId));

  return (
    <div className="border-t border-neutral-100 bg-neutral-25">
      {busca && achados.length > 0 ? (
        <div className="max-h-[210px] overflow-auto border-b border-neutral-100">
          {achados.map((item) => (
            <button
              key={item.variacaoId}
              type="button"
              onClick={() => {
                aoIncluir(item);
                setTermo('');
                setBusca('');
              }}
              className="flex w-full items-center gap-2 border-b border-neutral-50 px-4 py-2 text-left last:border-0 hover:bg-white"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-neutral-900">
                  {item.produto}{' '}
                  <span className="text-neutral-500">· {item.descricaoVariacao}</span>
                </span>
                <span className="block truncate font-mono text-[10.5px] text-neutral-400">
                  {item.sku}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={juntar(
                    'block font-mono text-[11.5px]',
                    Number(item.saldoAtual) < 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-600',
                  )}
                >
                  saldo {num(item.saldoAtual, 2)}
                </span>
                <span className="block font-mono text-[10.5px] text-neutral-400">
                  {item.ultimoCusto ? `ultimo ${brl(item.ultimoCusto)}` : 'sem custo anterior'}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {busca && !consulta.isPending && achados.length === 0 ? (
        <p className="border-b border-neutral-100 px-4 py-2.5 text-[12px] text-neutral-500">
          Nada encontrado para “{busca}”.
        </p>
      ) : null}

      <div className="px-4 py-2.5">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Incluir item — SKU, produto ou descrição"
          aria-label="Incluir item na nota"
          className="h-9 w-full rounded-md border border-neutral-200 bg-white px-2.5 text-[12.5px]"
        />
      </div>
    </div>
  );
}

function LinhaItem({
  item,
  rascunho,
}: {
  readonly item: ItemCompraResumo;
  readonly rascunho: boolean;
}) {
  /*
    O que vai acontecer com a média, dito antes de acontecer.

    São os dois casos do COST_POLICY que ninguém lembra: saldo zero REDEFINE o
    custo em vez de fazer média com um passado que não existe, e saldo negativo
    a preserva até o saldo voltar a zero.
  */
  const saldo = item.saldoAtual === undefined ? null : Number(item.saldoAtual);
  const medioAtual = item.custoMedioAtual === undefined ? null : Number(item.custoMedioAtual);

  let previsto: string | null = null;
  let explicacao: string | null = null;
  let alerta = false;

  if (rascunho && saldo !== null && medioAtual !== null) {
    const q = Number(item.quantidade);
    const c = Number(item.custoUnitario);

    if (saldo <= 0) {
      previsto = c.toFixed(2);
      explicacao =
        saldo === 0 ? 'redefine · saldo era 0' : `saldo ${num(saldo)} · cobre a descoberto`;
      alerta = saldo < 0;
    } else {
      previsto = ((saldo * medioAtual + q * c) / (saldo + q)).toFixed(2);
      explicacao = `era ${brl(medioAtual)}`;
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_44px_84px_96px] items-center gap-2.5 border-b border-neutral-50 px-4 py-2 last:border-0">
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-neutral-900">
          {item.produto} <span className="text-neutral-500">· {item.descricaoVariacao}</span>
        </span>
        <span className="block truncate font-mono text-[10.5px] text-neutral-400">{item.sku}</span>
      </span>

      <span className="text-right font-mono text-[12.5px] text-neutral-700">
        {num(item.quantidade, 2)}
      </span>

      <span className="text-right font-mono text-[12.5px] text-neutral-700">
        {brl(item.custoUnitario)}
      </span>

      <span className="text-right">
        <span
          className={juntar(
            'block font-mono text-[12.5px] font-medium',
            alerta ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
          )}
        >
          {item.custoMedioDepois ? brl(item.custoMedioDepois) : (previsto ?? '—')}
        </span>
        <span
          className={juntar(
            'block font-mono text-[10px]',
            alerta ? 'text-[var(--color-perigo)]' : 'text-neutral-400',
          )}
        >
          {item.custoMedioAntes ? `era ${brl(item.custoMedioAntes)}` : (explicacao ?? '')}
        </span>
      </span>
    </div>
  );
}

/**
 * Nova entrada: o cabeçalho da nota primeiro, os itens depois.
 *
 * O rascunho nasce vazio de propósito — digitar quarenta linhas não acontece
 * num atendimento só, e a mercadoria só entra quando alguém confere que
 * chegou.
 */
function NovaEntrada({
  aoFechar,
  aoCriar,
  aoFalhar,
}: {
  readonly aoFechar: () => void;
  readonly aoCriar: (id: string) => Promise<void>;
  readonly aoFalhar: (mensagem: string) => void;
}) {
  const [fornecedorId, setFornecedorId] = useState('');
  const [lojaId, setLojaId] = useState('');
  const [localId, setLocalId] = useState('');
  const [numeroNota, setNumeroNota] = useState('');

  const fornecedores = useQuery({
    queryKey: ['compras', 'fornecedores'],
    queryFn: () => pedir<Fornecedor[]>('/compras/fornecedores'),
  });

  /*
    O painel de lojas, nao o contexto do PDV: a compra precisa dos LOCAIS, e o
    contexto do balcao so carrega o local padrao de venda — que quase nunca e
    o destino de uma nota de fornecedor.
  */
  const contexto = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
    staleTime: 5 * 60_000,
  });

  const lojas = (contexto.data ?? []).filter((l) => l.status === 'ATIVO');
  const loja = lojas.find((l) => l.id === lojaId);

  useEffect(() => {
    if (!lojaId && lojas.length > 0) setLojaId(lojas[0]!.id);
  }, [lojas, lojaId]);

  useEffect(() => {
    const locais = loja?.locais ?? [];
    if (locais.length > 0 && !locais.some((l) => l.id === localId)) {
      setLocalId(locais[0]!.id);
    }
  }, [loja, localId]);

  const criar = useMutation({
    mutationFn: () =>
      pedir<Compra>('/compras', {
        method: 'POST',
        body: {
          lojaId,
          localId,
          fornecedorId,
          ...(numeroNota.trim() ? { numeroNota: numeroNota.trim() } : {}),
          itens: [],
        },
      }),
    onSuccess: (compra) => void aoCriar(compra.id),
    onError: (e) => {
      aoFalhar(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível criar a nota.');
    },
  });

  return (
    <section className="flex flex-col gap-3 rounded-md border border-primary-100 bg-primary-50 p-4">
      <h2 className="font-display text-[15px] font-semibold text-neutral-900">Nova entrada</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Fornecedor
          </span>
          <select
            value={fornecedorId}
            onChange={(e) => setFornecedorId(e.target.value)}
            className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
          >
            <option value="">escolha…</option>
            {(fornecedores.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Loja
          </span>
          <select
            value={lojaId}
            onChange={(e) => setLojaId(e.target.value)}
            className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
          >
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Destino
          </span>
          <select
            value={localId}
            onChange={(e) => setLocalId(e.target.value)}
            className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
          >
            {(loja?.locais ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Número da nota
          </span>
          <input
            value={numeroNota}
            onChange={(e) => setNumeroNota(e.target.value)}
            placeholder="18442"
            className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 font-mono text-[13px]"
          />
        </label>
      </div>

      <p className="text-[11.5px] leading-4 text-neutral-600">
        A nota nasce em <strong className="font-semibold">rascunho</strong>, sem itens e sem mexer
        no estoque. A mesma nota do mesmo fornecedor não entra duas vezes — o banco recusa, porque
        lançar de novo dobraria a mercadoria e estragaria o custo médio.
      </p>

      <div className="flex gap-2">
        <Botao
          variante="primario"
          carregando={criar.isPending}
          disabled={!fornecedorId || !localId}
          onClick={() => criar.mutate()}
        >
          Criar rascunho
        </Botao>
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </section>
  );
}

/** Exportado para a tela de itens do rascunho usar a mesma busca. */
export type { ItemParaComprar };
