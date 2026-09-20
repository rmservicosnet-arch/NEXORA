import { PERM, type ContextoPdv, type PaginaVendas, type Venda } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Dia e hora, curtos: a lista é lida em varredura, não em leitura. */
function quando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

const SITUACAO: Record<Venda['status'], { texto: string; pilula: string }> = {
  RASCUNHO: { texto: 'Rascunho', pilula: 'bg-neutral-100 text-neutral-500' },
  CONCLUIDA: { texto: 'Concluída', pilula: 'bg-[#e6f1eb] text-[#155537]' },
  DEVOLVIDA_PARCIAL: { texto: 'Devolvida em parte', pilula: 'bg-[#fbf0da] text-[#8f6206]' },
  DEVOLVIDA_TOTAL: { texto: 'Devolvida', pilula: 'bg-neutral-100 text-neutral-500' },
  CANCELADA: { texto: 'Cancelada', pilula: 'bg-[#fdf5f5] text-[var(--color-perigo)]' },
};

/*
  Os quatro recortes PARTICIONAM o total: concluídas + com devolução +
  canceladas = todas. Se um dia o PDV passar a deixar rascunho, ele ganha
  pílula própria — sumir dentro de outro número é o defeito que "Todos 1462"
  com quatro pílulas somando 1166 já produziu.
*/
type Recorte = 'todas' | 'concluidas' | 'devolvidas' | 'canceladas';

const RECORTES: { chave: Recorte; nome: string; status?: string }[] = [
  { chave: 'todas', nome: 'Todas' },
  { chave: 'concluidas', nome: 'Concluídas', status: 'CONCLUIDA' },
  { chave: 'devolvidas', nome: 'Com devolução', status: 'DEVOLVIDA_PARCIAL' },
  { chave: 'canceladas', nome: 'Canceladas', status: 'CANCELADA' },
];

const PERIODOS = [
  { dias: 1, nome: 'Hoje' },
  { dias: 7, nome: 'Últimos 7 dias' },
  { dias: 30, nome: 'Últimos 30 dias' },
  { dias: 90, nome: 'Últimos 90 dias' },
];

const PAGINA = 30;

/**
 * O histórico de vendas.
 *
 * O PDV CRIA a venda e, até aqui, nada a mostrava de novo: `GET /vendas`,
 * `GET /vendas/:id` e `POST /vendas/:id/cancelar` existiam desde o início e
 * nenhuma tela os chamava. Cancelar uma venda só era possível por API — e a
 * devolução parcial não tinha por onde começar.
 */
export function Vendas() {
  const { pode } = useSessao();
  const [parametros, setParametros] = useSearchParams();

  const recorte = (parametros.get('recorte') ?? 'todas') as Recorte;
  const dias = Number(parametros.get('dias') ?? 7);
  const lojaId = parametros.get('lojaId') ?? '';

  /*
    A lista CRESCE, não troca de página: trocar de página desmontaria as
    linhas e quem estava comparando duas vendas perderia o lugar.
  */
  const [paginas, setPaginas] = useState(1);

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametros);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametros(limpos, { replace: true });
    setPaginas(1);
  }

  const contexto = useQuery({
    queryKey: ['vendas', 'contexto'],
    queryFn: () => pedir<ContextoPdv>('/vendas/contexto'),
    staleTime: 5 * 60_000,
  });

  const de = new Date();
  de.setDate(de.getDate() - dias + 1);
  de.setHours(0, 0, 0, 0);

  const consulta = useQuery({
    queryKey: ['vendas', 'lista', recorte, dias, lojaId, paginas],
    queryFn: () => {
      const p = new URLSearchParams({
        limite: String(PAGINA * paginas),
        de: de.toISOString(),
      });
      const alvo = RECORTES.find((r) => r.chave === recorte)?.status;
      if (alvo) p.set('status', alvo);
      if (lojaId) p.set('lojaId', lojaId);
      return pedir<PaginaVendas>(`/vendas?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const itens = dados?.itens ?? [];

  /*
    "Com devolução" são dois status, e a API filtra por UM. Pedir
    DEVOLVIDA_PARCIAL e completar no cliente daria lista errada na página 2 —
    o recorte pede as duas ao servidor.
  */
  const lista =
    recorte === 'devolvidas'
      ? itens.filter((v) => v.status === 'DEVOLVIDA_PARCIAL' || v.status === 'DEVOLVIDA_TOTAL')
      : itens;

  const contagens = dados?.contagens;

  const numero = (chave: Recorte): number | null => {
    if (!contagens) return null;
    if (chave === 'todas') return contagens.total;
    if (chave === 'concluidas') return contagens.concluidas;
    if (chave === 'devolvidas') return contagens.comDevolucao;
    return contagens.canceladas;
  };

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Vendas</span>
        <div className="flex-1" />
        {pode(PERM.venda.criar) ? (
          <Botao variante="primario" comoFilho>
            <Link to="/pdv">Abrir PDV</Link>
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Vendas
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              O que o PDV registrou — e a única porta para{' '}
              <strong className="font-semibold text-neutral-900">devolver</strong> ou cancelar uma
              venda
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '7')}>
              {PERIODOS.map((p) => (
                <option key={p.dias} value={p.dias}>
                  {p.nome}
                </option>
              ))}
            </Selecao>

            <Selecao rotulo="Loja" valor={lojaId} aoMudar={(v) => trocar('lojaId', v, '')}>
              <option value="">Todas</option>
              {(contexto.data?.lojas ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar as vendas"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {dados ? (
          <>
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador
                rotulo="Faturado no período"
                valor={`R$ ${brl(dados.totalVendido)}`}
                nota="cancelada não entra; devolvida entra pelo que ficou"
              />
              <Indicador
                rotulo="Vendas"
                valor={String(contagens?.total ?? 0)}
                nota={`${String(contagens?.concluidas ?? 0)} sem nenhuma devolução`}
              />
              <Indicador
                rotulo="Ticket médio"
                valor={
                  contagens && contagens.total - contagens.canceladas > 0
                    ? `R$ ${brl(Number(dados.totalVendido) / (contagens.total - contagens.canceladas))}`
                    : '—'
                }
                nota="sobre as não canceladas"
              />
              <Indicador
                rotulo="Devolvido no período"
                valor={`R$ ${brl(dados.totalDevolvido)}`}
                nota={
                  Number(dados.totalBruto) > 0
                    ? `${String(contagens?.comDevolucao ?? 0)} vendas · ${brl((Number(dados.totalDevolvido) / Number(dados.totalBruto)) * 100)}% do bruto`
                    : 'nada voltou'
                }
                tom={Number(dados.totalDevolvido) > 0 ? 'atencao' : 'normal'}
              />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {RECORTES.map((r) => {
                const n = numero(r.chave);
                return (
                  <button
                    key={r.chave}
                    type="button"
                    aria-pressed={recorte === r.chave}
                    onClick={() => trocar('recorte', r.chave, 'todas')}
                    className={juntar(
                      'flex h-8 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-medium',
                      recorte === r.chave
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-25',
                    )}
                  >
                    {r.nome}
                    {n !== null ? (
                      <span
                        className={juntar(
                          'font-mono text-[11.5px] tabular-nums',
                          recorte === r.chave ? 'text-primary-100' : 'text-neutral-400',
                        )}
                      >
                        {n.toLocaleString('pt-BR')}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {/*
                A soma escrita: recorte cujo total não fecha com o número ao
                lado é pior do que recorte nenhum.
              */}
              {contagens ? (
                <span className="text-[12px] text-neutral-400">
                  {contagens.concluidas} + {contagens.comDevolucao} + {contagens.canceladas} ={' '}
                  {contagens.total} — os quatro recortes fecham com o total
                </span>
              ) : null}
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="min-w-full lg:min-w-[980px]">
                  <Cabecalho />

                  {lista.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma venda no período"
                      descricao="Aumente o período, troque o recorte, ou registre uma venda no PDV."
                    />
                  ) : (
                    lista.map((v) => <Linha key={v.id} venda={v} />)
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3">
                <span className="text-[12.5px] font-semibold text-neutral-700">
                  {/* O rodapé conta o que a LISTA mostra, não o conjunto. */}
                  Exibindo {lista.length} de {numero(recorte) ?? lista.length} · da mais recente
                </span>
                <div className="flex-1" />
                {dados.proximoCursor ? (
                  <Botao
                    variante="secundario"
                    carregando={consulta.isFetching}
                    onClick={() => setPaginas(paginas + 1)}
                  >
                    Carregar mais
                  </Botao>
                ) : null}
              </div>
            </section>
          </>
        ) : consulta.isPending ? (
          <EstadoCarregando titulo="Buscando vendas…" />
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'lg:grid-cols-[72px_104px_minmax(0,1fr)_140px_60px_150px_130px_160px]';

function Cabecalho() {
  const colunas = [
    { t: 'Nº' },
    { t: 'Quando' },
    { t: 'Cliente' },
    { t: 'Vendedor' },
    { t: 'Itens', a: true },
    { t: 'Pagamento' },
    { t: 'Total', a: true },
    { t: 'Situação' },
  ];

  return (
    <div
      className={juntar(
        'sticky top-0 z-10 hidden gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE,
      )}
    >
      {colunas.map((c) => (
        <span
          key={c.t}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            c.a && 'text-right',
          )}
        >
          {c.t}
        </span>
      ))}
    </div>
  );
}

/** As formas, em uma frase. Duas viram "A + B"; três ou mais, "3 formas". */
function formas(venda: Venda): string {
  const nomes: Record<string, string> = {
    DINHEIRO: 'Dinheiro',
    PIX: 'PIX',
    DEBITO: 'Débito',
    CREDITO: 'Crédito',
    TRANSFERENCIA: 'Transferência',
    BOLETO: 'Boleto',
    PRAZO: 'A prazo',
    CARTEIRA: 'Carteira',
  };

  const unicas = [...new Set(venda.pagamentos.map((p) => nomes[p.forma] ?? p.forma))];
  if (unicas.length === 0) return '—';
  if (unicas.length <= 2) return unicas.join(' + ');
  return `${String(unicas.length)} formas`;
}

function Linha({ venda }: { readonly venda: Venda }) {
  const s = SITUACAO[venda.status];
  const cancelada = venda.status === 'CANCELADA';
  const unidades = venda.itens.reduce((soma, i) => soma + Number(i.quantidade), 0);

  return (
    <Link
      to={`/vendas/${venda.id}`}
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 no-underline hover:bg-neutral-25 lg:grid',
        GRADE,
        cancelada && 'bg-[#fdfafa]',
        venda.status === 'DEVOLVIDA_PARCIAL' && 'bg-[#fefbf3]',
      )}
    >
      <span
        className={juntar(
          'font-mono text-[12.5px]',
          cancelada ? 'text-neutral-400' : 'text-neutral-600',
        )}
      >
        {venda.numero}
      </span>

      <span className="text-[12.5px] text-neutral-500">{quando(venda.concluidaEm)}</span>

      <span
        className={juntar(
          'min-w-0 flex-1 truncate text-[13px] lg:flex-none',
          cancelada ? 'text-neutral-500' : 'text-neutral-900',
        )}
      >
        {venda.cliente ?? 'Consumidor'}
      </span>

      <span className="truncate text-[12.5px] text-neutral-500">{venda.vendedor}</span>

      <span className="font-mono text-[12.5px] text-neutral-500 lg:text-right">
        {unidades.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
      </span>

      <span className="truncate text-[12.5px] text-neutral-500">{formas(venda)}</span>

      <span
        className={juntar(
          'font-mono text-[13px] font-medium tabular-nums lg:text-right',
          cancelada ? 'text-neutral-400 line-through' : 'text-neutral-900',
        )}
      >
        R$ {brl(venda.total)}
      </span>

      <span className="flex items-center gap-2">
        <span
          className={juntar(
            'inline-flex h-5 items-center rounded-full px-2.5 text-[11px] font-semibold',
            s.pilula,
          )}
        >
          {s.texto}
        </span>
        {Number(venda.valorDevolvido) > 0 ? (
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-atencao)]">
            − {brl(venda.valorDevolvido)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function Selecao({
  rotulo,
  valor,
  aoMudar,
  children,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (valor: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-2.5">
      <span className="text-[12.5px] text-neutral-500">{rotulo}</span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="bg-transparent text-[13px] font-medium text-neutral-900 outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function Indicador({
  rotulo,
  valor,
  nota,
  tom = 'normal',
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  readonly tom?: 'normal' | 'atencao';
}) {
  return (
    <div
      className={juntar(
        'flex flex-col justify-center rounded-md border bg-white px-4 py-3 shadow-sm',
        tom === 'atencao' ? 'border-[#ebd6a8]' : 'border-neutral-100',
      )}
    >
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1 font-display text-[24px] font-bold leading-7 tabular-nums',
          tom === 'atencao' ? 'text-[var(--color-atencao)]' : 'text-neutral-900',
        )}
      >
        {valor}
      </p>
      <p className="mt-0.5 text-[12px] text-neutral-500">{nota}</p>
    </div>
  );
}
