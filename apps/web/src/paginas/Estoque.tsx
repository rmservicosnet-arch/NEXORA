import { PERM, type LocalResumo, type Movimento, type PaginaMovimentos } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import { PainelMovimento } from './estoque/PainelMovimento';

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
  const [painelAberto, setPainelAberto] = useState(false);

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

  const parametros = new URLSearchParams(FILTROS.find((f) => f.chave === filtro)?.params ?? '');
  if (localId) parametros.set('localId', localId);
  parametros.set('limite', '50');

  const movimentos = useQuery({
    queryKey: ['estoque', 'movimentos', filtro, localId],
    queryFn: () => pedir<PaginaMovimentos>(`/estoque/movimentos?${parametros.toString()}`),
    placeholderData: keepPreviousData,
  });

  const itens = movimentos.data?.itens ?? [];

  // Mesma regra dos produtos: a coluna existe porque o servidor mandou o campo.
  const mostrarCusto = itens.some((m) => m.custoUnitario !== undefined);

  const colunas = mostrarCusto
    ? 'grid-cols-[132px_150px_minmax(0,1fr)_150px_120px_86px_110px_110px]'
    : 'grid-cols-[132px_150px_minmax(0,1fr)_150px_120px_86px_110px]';

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
                filtro === 'todos' && !localId
                  ? 'Assim que houver entrada, saída ou contagem, tudo aparece aqui.'
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
                  <Linha key={m.id} movimento={m} colunas={colunas} mostrarCusto={mostrarCusto} />
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

      {painelAberto ? <PainelMovimento aoFechar={() => setPainelAberto(false)} /> : null}
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
}: {
  readonly movimento: Movimento;
  readonly colunas: string;
  readonly mostrarCusto: boolean;
}) {
  const entrada = movimento.sentido === 'ENTRADA';
  const quantidade = Number(movimento.quantidade);
  const saldo = Number(movimento.saldoPosterior);

  const quando = new Date(movimento.criadoEm);

  return (
    <div
      className={juntar(
        'grid h-[46px] items-center gap-2.5 border-b border-neutral-50 px-4',
        movimento.saldoNegativo && 'bg-[#fdf5f5]',
        colunas,
      )}
      title={movimento.justificativa ?? undefined}
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
    </div>
  );
}
