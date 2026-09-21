import {
  PERM,
  type LocalResumo,
  type Movimento,
  type PaginaMovimentos,
  type VariacaoParaMovimento,
} from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { diaISO } from '../ui/datas';
import { juntar } from '../ui/juntar';
import { PainelMovimento } from './estoque/PainelMovimento';
import { RazaoDoItem } from './estoque/RazaoDoItem';

const LARGURA_MINIMA = 'min-w-[980px]';

/** Rótulo curto por tipo. O enum do banco não é texto de tela. */
const ROTULO_TIPO: Record<string, string> = {
  ENTRADA_COMPRA: 'Compra',
  ENTRADA_DEVOLUCAO_CLIENTE: 'Devolução de cliente',
  ENTRADA_TRANSFERENCIA: 'Transferência',
  ENTRADA_AJUSTE: 'Ajuste',
  ENTRADA_INVENTARIO: 'Contagem',
  SAIDA_VENDA: 'Venda',
  SAIDA_DEVOLUCAO_FORNECEDOR: 'Devolução a fornecedor',
  SAIDA_TRANSFERENCIA: 'Transferência',
  SAIDA_AJUSTE: 'Ajuste',
  SAIDA_PERDA: 'Perda',
  SAIDA_AVARIA: 'Avaria',
  SAIDA_CONSUMO: 'Consumo',
  SAIDA_INVENTARIO: 'Contagem',
};

/**
 * Recortes de data oferecidos.
 *
 * Um controle só. Um `select` de período ao lado de dois campos de data
 * sempre ativos seriam dois controles para a mesma coisa, e nenhum dos dois
 * diria qual vale — o mesmo defeito do stepper e do campo de edição na
 * conferência. Aqui o período É o controle, e "escolher datas" LIBERA os
 * campos.
 */
const PERIODOS = [
  { chave: 'tudo', rotulo: 'Todo o período', dias: null },
  { chave: 'hoje', rotulo: 'Hoje', dias: 0 },
  { chave: '7', rotulo: 'Últimos 7 dias', dias: 6 },
  { chave: '30', rotulo: 'Últimos 30 dias', dias: 29 },
  { chave: '90', rotulo: 'Últimos 90 dias', dias: 89 },
  { chave: 'faixa', rotulo: 'Escolher datas…', dias: null },
] as const;

/** "de 12/09 até 20/09", "a partir de 12/09", "até 20/09". */
function rotuloRecorte(r: { de?: string; ate?: string }): string {
  // Com o ano: "de 01/01 até 02/01" num recorte de 2020 diz o dia certo do
  // ano errado, e quem lê decide pelo que está escrito.
  const br = (d: string): string => d.split('-').reverse().join('/');
  if (r.de && r.ate) return `de ${br(r.de)} até ${br(r.ate)}`;
  if (r.de) return `a partir de ${br(r.de)}`;
  return `até ${br(r.ate ?? '')}`;
}

const FILTROS = [
  { chave: 'todos', rotulo: 'Tudo', params: '' },
  { chave: 'entradas', rotulo: 'Entradas', params: 'sentido=ENTRADA' },
  { chave: 'saidas', rotulo: 'Saídas', params: 'sentido=SAIDA' },
  { chave: 'negativos', rotulo: 'Deixaram negativo', params: 'apenasNegativos=true' },
];

export function Estoque() {
  const { pode } = useSessao();
  const [filtro, setFiltro] = useState('todos');
  const [localId, setLocalId] = useState('');
  const [periodo, setPeriodo] = useState<string>('tudo');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  /**
   * `?operacao=contagem` abre o painel já na regularização.
   *
   * É o destino do "Abrir regularização de estoque" da visão geral: mandar
   * para a lista e pedir que a pessoa ache o botão seria mandá-la procurar
   * o que já se sabia.
   */
  const [urlParams, setUrlParams] = useSearchParams();
  const operacaoDaUrl = urlParams.get('operacao');
  const [painelAberto, setPainelAberto] = useState(Boolean(operacaoDaUrl));
  /**
   * Qual item está com o razão aberto.
   *
   * A lista global responde "o que aconteceu"; o razão responde "o que
   * aconteceu com ESTE item", que é a pergunta de quem vai decidir sobre
   * ele. A proposta desenha a segunda; a primeira é como se chega nela.
   */
  const [aberto, setAberto] = useState<{
    variacaoId: string;
    sku: string;
    localId: string;
  } | null>(null);

  const podeMovimentar =
    pode(PERM.estoque.entradaManual) ||
    pode(PERM.estoque.ajustar) ||
    pode(PERM.estoque.transferir) ||
    pode(PERM.estoque.inventariar);

  const locais = useQuery({
    queryKey: ['estoque', 'locais'],
    queryFn: () => pedir<LocalResumo[]>('/estoque/locais'),
    staleTime: 5 * 60_000,
  });

  /*
    O recorte vira um par de dias, e o servidor traduz cada um para o começo e
    o FIM do dia no fuso de quem opera. A tela nunca manda instante: "de 12/09
    até 20/09" é a pergunta, e o teto do dia 20 é às 23h59 dele — não à
    meia-noite, que esconderia o dia inteiro.
  */
  const recorte = ((): { de?: string; ate?: string } => {
    if (periodo === 'faixa') {
      return { ...(de ? { de } : {}), ...(ate ? { ate } : {}) };
    }

    const escolhido = PERIODOS.find((p) => p.chave === periodo);
    if (!escolhido || escolhido.dias === null) return {};

    const inicio = new Date();
    inicio.setDate(inicio.getDate() - escolhido.dias);
    return { de: diaISO(inicio), ate: diaISO() };
  })();

  const parametros = new URLSearchParams(FILTROS.find((f) => f.chave === filtro)?.params ?? '');
  if (localId) parametros.set('localId', localId);
  if (recorte.de) parametros.set('de', recorte.de);
  if (recorte.ate) parametros.set('ate', recorte.ate);
  parametros.set('limite', '50');

  const movimentos = useQuery({
    queryKey: ['estoque', 'movimentos', filtro, localId, recorte.de, recorte.ate],
    queryFn: () => pedir<PaginaMovimentos>(`/estoque/movimentos?${parametros.toString()}`),
    placeholderData: keepPreviousData,
  });

  const doItem = useQuery({
    queryKey: ['estoque', 'variacao', aberto?.sku],
    queryFn: () =>
      pedir<VariacaoParaMovimento[]>(
        `/estoque/variacoes?termo=${encodeURIComponent(aberto?.sku ?? '')}`,
      ),
    enabled: aberto !== null,
  });

  const variacaoAberta = doItem.data?.find((v) => v.id === aberto?.variacaoId) ?? null;

  const itens = movimentos.data?.itens ?? [];

  // Mesma regra dos produtos: a coluna existe porque o servidor mandou o campo.
  const mostrarCusto = itens.some((m) => m.custoUnitario !== undefined);

  const colunas = mostrarCusto
    ? 'grid-cols-[132px_150px_minmax(0,1fr)_150px_120px_86px_110px_110px]'
    : 'grid-cols-[132px_150px_minmax(0,1fr)_150px_120px_86px_110px]';

  if (aberto && variacaoAberta) {
    return (
      <RazaoDoItem
        variacao={variacaoAberta}
        localId={aberto.localId}
        aoTrocarLocal={(id) => setAberto({ ...aberto, localId: id })}
        aoAjustar={() => {
          setAberto(null);
          setPainelAberto(true);
        }}
        aoVoltar={() => setAberto(null)}
      />
    );
  }

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Estoque</span>
        <div className="flex-1" />
        {podeMovimentar ? (
          <Botao variante="primario" onClick={() => setPainelAberto(true)}>
            Movimentar estoque
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Movimentação
          </h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            O razão é a verdade: o saldo é derivado daqui. Nada é editado nem apagado — correção é
            lançamento contrário.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filtrar movimentos" className="flex gap-1.5">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                aria-pressed={filtro === f.chave}
                onClick={() => setFiltro(f.chave)}
                className={juntar(
                  'h-[35px] rounded-full border px-3 text-[12.5px] font-medium',
                  filtro === f.chave
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-neutral-200 bg-white text-neutral-700',
                )}
              >
                {f.rotulo}
              </button>
            ))}
          </div>

          <select
            value={localId}
            onChange={(e) => setLocalId(e.target.value)}
            aria-label="Local de estoque"
            className="h-[35px] rounded-md border border-neutral-200 bg-white px-2.5 text-[13px] text-neutral-900"
          >
            <option value="">Todos os locais</option>
            {(locais.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.loja} · {l.nome}
              </option>
            ))}
          </select>

          <select
            value={periodo}
            onChange={(e) => {
              setPeriodo(e.target.value);
              if (e.target.value === 'faixa' && !de && !ate) {
                // Começa no mês corrente para a pessoa ajustar, nunca vazio:
                // faixa em branco é "todo o período" com cara de recorte.
                const inicio = new Date();
                inicio.setDate(inicio.getDate() - 29);
                setDe(diaISO(inicio));
                setAte(diaISO());
              }
            }}
            aria-label="Período"
            className="h-[35px] rounded-md border border-neutral-200 bg-white px-2.5 text-[13px] text-neutral-900"
          >
            {PERIODOS.map((p) => (
              <option key={p.chave} value={p.chave}>
                {p.rotulo}
              </option>
            ))}
          </select>

          {periodo === 'faixa' ? (
            <span className="flex h-[35px] items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5">
              <input
                type="date"
                value={de}
                max={ate || undefined}
                onChange={(e) => setDe(e.target.value)}
                aria-label="De"
                className="bg-transparent text-[13px] text-neutral-900 outline-none"
              />
              <span className="text-[13px] text-neutral-400">até</span>
              <input
                type="date"
                value={ate}
                min={de || undefined}
                onChange={(e) => setAte(e.target.value)}
                aria-label="Até"
                className="bg-transparent text-[13px] text-neutral-900 outline-none"
              />
            </span>
          ) : null}

          {recorte.de || recorte.ate ? (
            <button
              type="button"
              onClick={() => {
                setPeriodo('tudo');
                setDe('');
                setAte('');
              }}
              className="text-[12.5px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
            >
              Limpar data
            </button>
          ) : null}
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {movimentos.isPending ? <EstadoCarregando titulo="Carregando movimentos…" /> : null}

          {movimentos.isError ? (
            <EstadoErro
              titulo="Não foi possível carregar o razão"
              descricao={
                movimentos.error instanceof ErroRequisicao
                  ? movimentos.error.corpo.mensagem
                  : 'Verifique se a API está no ar.'
              }
              aoTentarNovamente={() => void movimentos.refetch()}
            />
          ) : null}

          {movimentos.isSuccess && itens.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum movimento"
              descricao={
                filtro === 'todos' && !localId && !recorte.de && !recorte.ate
                  ? 'Assim que houver entrada, saída ou contagem, tudo aparece aqui.'
                  : recorte.de || recorte.ate
                    ? `Nenhum movimento ${rotuloRecorte(recorte)}. O razão não está vazio — o recorte é que não pegou nada.`
                    : 'Nenhum movimento corresponde ao filtro.'
              }
            />
          ) : null}

          {itens.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
              <div
                className={juntar(
                  'grid h-9 shrink-0 items-center gap-2.5 border-b border-neutral-100 bg-neutral-25 px-4',
                  LARGURA_MINIMA,
                  colunas,
                )}
              >
                <Cabecalho>Quando</Cabecalho>
                <Cabecalho>SKU</Cabecalho>
                <Cabecalho>Produto</Cabecalho>
                <Cabecalho>Local</Cabecalho>
                <Cabecalho>Tipo</Cabecalho>
                <Cabecalho direita>Qtd.</Cabecalho>
                <Cabecalho direita>Saldo</Cabecalho>
                {mostrarCusto ? <Cabecalho direita>Custo un.</Cabecalho> : null}
              </div>

              <div className={juntar('min-h-0 flex-1 overflow-y-auto', LARGURA_MINIMA)}>
                {itens.map((m) => (
                  <Linha
                    key={m.id}
                    movimento={m}
                    colunas={colunas}
                    mostrarCusto={mostrarCusto}
                    aoAbrir={() =>
                      setAberto({ variacaoId: m.variacaoId, sku: m.sku, localId: m.localId })
                    }
                  />
                ))}
              </div>

              <div
                className={juntar(
                  'flex h-12 shrink-0 items-center justify-between border-t border-neutral-100 bg-neutral-25 px-4 text-[13px] text-neutral-500',
                  LARGURA_MINIMA,
                )}
              >
                <span>
                  {itens.length} movimento{itens.length === 1 ? '' : 's'}
                </span>
                {movimentos.data?.proximoCursor ? (
                  <span className="text-[12.5px]">Há mais páginas — paginação por cursor</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </main>

      {painelAberto ? (
        <PainelMovimento
          operacaoInicial={operacaoDaUrl}
          aoFechar={() => {
            setPainelAberto(false);
            if (operacaoDaUrl) {
              const limpos = new URLSearchParams(urlParams);
              limpos.delete('operacao');
              setUrlParams(limpos, { replace: true });
            }
          }}
        />
      ) : null}
    </>
  );
}

function Cabecalho({
  children,
  direita,
}: {
  readonly children: string;
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

function Linha({
  movimento,
  colunas,
  mostrarCusto,
  aoAbrir,
}: {
  readonly movimento: Movimento;
  readonly colunas: string;
  readonly mostrarCusto: boolean;
  readonly aoAbrir: () => void;
}) {
  const entrada = movimento.sentido === 'ENTRADA';
  const quantidade = Number(movimento.quantidade);
  const saldo = Number(movimento.saldoPosterior);

  const quando = new Date(movimento.criadoEm);

  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={juntar(
        'grid h-[46px] w-full items-center gap-2.5 border-b border-neutral-50 px-4 text-left hover:bg-neutral-25',
        movimento.saldoNegativo && 'bg-[#fdf5f5]',
        colunas,
      )}
      title={`Abrir o razão de ${movimento.sku}${movimento.justificativa ? ` · ${movimento.justificativa}` : ''}`}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">
        {quando.toLocaleDateString('pt-BR')}{' '}
        <span className="text-neutral-400">
          {quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>

      <span className="truncate font-mono text-[12.5px] text-neutral-600">{movimento.sku}</span>

      <div className="min-w-0">
        <p className="truncate text-[13.5px] text-neutral-900">{movimento.produto}</p>
        <p className="truncate text-[11.5px] text-neutral-400">{movimento.descricaoVariacao}</p>
      </div>

      <span className="truncate text-[12.5px] text-neutral-600">
        {movimento.loja} · {movimento.local}
      </span>

      <span className="flex items-center gap-1.5">
        <span
          className={juntar(
            'size-1.5 shrink-0 rounded-full',
            entrada ? 'bg-[var(--color-sucesso)]' : 'bg-[var(--color-atencao)]',
          )}
          aria-hidden="true"
        />
        <span className="truncate text-[12.5px] text-neutral-700">
          {ROTULO_TIPO[movimento.tipo] ?? movimento.tipo}
        </span>
      </span>

      <span
        className={juntar(
          'tabular text-right font-mono text-[13px] font-medium',
          entrada ? 'text-[var(--color-sucesso)]' : 'text-neutral-900',
        )}
      >
        {/* O sinal é do sentido, não da quantidade: ela é sempre positiva no
            razão, e é assim que a auditoria consegue somar entradas e saídas
            separadamente sem interpretar sinal. */}
        {entrada ? '+' : '−'}
        {quantidade.toLocaleString('pt-BR')}
      </span>

      <span
        className={juntar(
          'tabular text-right font-mono text-[13px]',
          saldo < 0 ? 'font-semibold text-[var(--color-perigo)]' : 'text-neutral-600',
        )}
      >
        {saldo < 0 ? `−${Math.abs(saldo).toLocaleString('pt-BR')}` : saldo.toLocaleString('pt-BR')}
      </span>

      {mostrarCusto ? (
        <span className="tabular text-right font-mono text-[12.5px] text-neutral-500">
          {movimento.custoUnitario ? `R$ ${Number(movimento.custoUnitario).toFixed(2)}` : '—'}
        </span>
      ) : null}
    </button>
  );
}
