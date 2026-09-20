import {
  PERM,
  type Movimento,
  type PaginaMovimentos,
  type VariacaoParaMovimento,
} from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { useSessao } from '../../auth/sessao';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../../ui/Estados';
import { juntar } from '../../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

function qtd(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

const ROTULO_TIPO: Record<string, string> = {
  ENTRADA_COMPRA: 'Compra',
  ENTRADA_MANUAL: 'Entrada',
  ENTRADA_DEVOLUCAO: 'Devolução',
  ENTRADA_TRANSFERENCIA: 'Transf.',
  ENTRADA_INVENTARIO: 'Inventário',
  SAIDA_VENDA: 'Venda',
  SAIDA_MANUAL: 'Saída',
  SAIDA_PERDA: 'Perda',
  SAIDA_TRANSFERENCIA: 'Transf.',
  SAIDA_INVENTARIO: 'Inventário',
  AJUSTE_POSITIVO: 'Ajuste',
  AJUSTE_NEGATIVO: 'Ajuste',
};

/**
 * O razão de UM item num local.
 *
 * É a tela que a proposta desenha: saldo, custo médio e valor no topo, o
 * aviso quando o saldo está negativo, e cada movimento com saldo antes →
 * depois. O encadeamento é o que permite conferir o razão de fora: se a
 * coluna deixa de encadear, alguém gravou saldo sem passar por aqui.
 */
export function RazaoDoItem({
  variacao,
  localId,
  aoTrocarLocal,
  aoAjustar,
  aoVoltar,
}: {
  readonly variacao: VariacaoParaMovimento;
  readonly localId: string;
  readonly aoTrocarLocal: (id: string) => void;
  readonly aoAjustar: () => void;
  readonly aoVoltar: () => void;
}) {
  const { pode } = useSessao();
  const verCusto = pode(PERM.produto.verCusto);

  const consulta = useQuery({
    queryKey: ['estoque', 'razao', variacao.id, localId],
    queryFn: () =>
      pedir<PaginaMovimentos>(
        `/estoque/movimentos?variacaoId=${variacao.id}&localId=${localId}&limite=200`,
      ),
  });

  const noLocal = variacao.saldosPorLocal.find((s) => s.localId === localId);
  const saldo = Number(noLocal?.quantidade ?? 0);
  const custoMedio = noLocal?.custoMedio ?? null;
  const minimo = Number(variacao.estoqueMinimo);

  const movimentos = consulta.data?.itens ?? [];
  const negativos = movimentos.filter((m) => m.saldoNegativo).length;

  /**
   * Exporta o razão como CSV, do que já está carregado.
   *
   * Sem rota nova: o razão inteiro do item já veio para a tela. Gerar no
   * servidor só faria sentido para um período que não cabe aqui.
   */
  function exportar() {
    const cabecalho = [
      'data',
      'tipo',
      'documento',
      'quantidade',
      'saldo_anterior',
      'saldo_posterior',
      ...(verCusto ? ['custo_unitario', 'custo_medio_depois'] : []),
      'usuario',
      'justificativa',
    ];

    const linhas = movimentos.map((m) =>
      [
        new Date(m.criadoEm).toISOString(),
        m.tipo,
        m.documentoNumero ?? '',
        (m.sentido === 'SAIDA' ? '-' : '') + m.quantidade,
        m.saldoAnterior,
        m.saldoPosterior,
        ...(verCusto ? [m.custoUnitario ?? '', m.custoMedioDepois ?? ''] : []),
        m.ator ?? '',
        (m.justificativa ?? '').replaceAll(';', ','),
      ].join(';'),
    );

    const csv = [cabecalho.join(';'), ...linhas].join('\n');
    // Marca de ordem de bytes: sem ela, o Excel em pt-BR abre o arquivo em
    // Latin-1 e todo acento vira caractere estranho. Vai pelo código, não
    // literal — caractere invisível no fonte é erro de lint e some em
    // qualquer cópia-e-cola.
    const marcaUtf8 = String.fromCharCode(0xfeff);
    const blob = new Blob([marcaUtf8 + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `razao-${variacao.sku}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={aoVoltar}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-neutral-500 hover:bg-neutral-50"
        >
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
            <path d="M19 12H6" />
            <path d="m11 6-6 6 6 6" />
          </svg>
          Movimentações
        </button>

        <select
          value={localId}
          onChange={(e) => aoTrocarLocal(e.target.value)}
          aria-label="Local"
          className="h-[34px] rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
        >
          {variacao.saldosPorLocal.map((s) => (
            <option key={s.localId} value={s.localId}>
              {s.loja} · {s.local}
            </option>
          ))}
        </select>

        <div className="hidden flex-1 sm:block" />

        <Botao variante="secundario" tamanho="compacto" onClick={exportar}>
          Exportar razão
        </Botao>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[20px] font-bold text-neutral-900">
                {variacao.produto} — {variacao.descricao}
              </h1>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600">
                {variacao.sku}
              </span>
            </div>
            <p className="text-[12.5px] text-neutral-500">
              {noLocal ? `${noLocal.loja} · ${noLocal.local}` : '—'} · razão completo
            </p>
          </div>

          {pode(PERM.estoque.ajustar) ? (
            <Botao variante="secundario" tamanho="compacto" onClick={aoAjustar}>
              Novo ajuste
            </Botao>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            rotulo="Saldo atual"
            valor={qtd(saldo)}
            unidade="un"
            tom={saldo < 0 ? 'perigo' : saldo < minimo ? 'atencao' : 'normal'}
          />
          {/*
            Custo médio ausente é diferente de zero: ausente = sem permissão,
            nulo = sem saldo, e divisão por zero não existe.
          */}
          {verCusto ? (
            <Kpi
              rotulo="Custo médio"
              valor={custoMedio === null ? '—' : `R$ ${brl(custoMedio)}`}
              tom="normal"
            />
          ) : null}
          {verCusto ? (
            <Kpi
              rotulo="Valor em estoque"
              valor={custoMedio === null ? '—' : `R$ ${brl(saldo * Number(custoMedio))}`}
              tom={saldo < 0 ? 'perigo' : 'normal'}
            />
          ) : null}
          <Kpi
            rotulo="Estoque mínimo"
            valor={qtd(minimo)}
            unidade="un"
            tom={saldo < minimo && saldo >= 0 ? 'atencao' : 'normal'}
          />
        </div>

        {saldo < 0 ? (
          <Aviso
            tom="perigo"
            titulo={`Saldo negativo${negativos > 0 ? ` · ${String(negativos)} ${negativos === 1 ? 'movimentação abaixo' : 'movimentações abaixo'} de zero` : ''}`}
          >
            A venda com saldo negativo está autorizada pela configuração da empresa. O custo médio é
            preservado e não é recalculado enquanto o saldo estiver negativo — recalcular sobre
            saldo negativo produziria um custo sem significado.
          </Aviso>
        ) : null}

        {consulta.isPending ? <EstadoCarregando titulo="Carregando o razão…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar o razão"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Tente novamente em instantes.'
            }
          />
        ) : null}

        {consulta.isSuccess && movimentos.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma movimentação neste local"
            descricao="O item ainda não entrou nem saiu daqui."
          />
        ) : null}

        {movimentos.length > 0 ? (
          <section className="flex flex-col overflow-x-auto rounded-md border border-neutral-100 bg-white shadow-sm">
            <div
              className={juntar(
                'hidden shrink-0 items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 lg:grid',
                verCusto
                  ? 'lg:min-w-[940px] lg:grid-cols-[24px_92px_minmax(0,1fr)_72px_128px_96px_116px_120px]'
                  : 'lg:min-w-[720px] lg:grid-cols-[24px_92px_minmax(0,1fr)_72px_128px_120px]',
              )}
            >
              {[
                '',
                'Data',
                'Movimentação',
                'Qtd.',
                'Saldo ant. → post.',
                ...(verCusto ? ['Custo un.', 'Custo médio'] : []),
                'Usuário',
              ].map((t, i) => (
                <span
                  key={t || `c${String(i)}`}
                  className={juntar(
                    'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500',
                    (i === 3 || (verCusto && (i === 5 || i === 6))) && 'text-right',
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className={verCusto ? 'lg:min-w-[940px]' : 'lg:min-w-[720px]'}>
              {movimentos.map((m, i) => (
                <LinhaRazao
                  key={m.id}
                  movimento={m}
                  verCusto={verCusto}
                  primeiro={i === 0}
                  ultimo={i === movimentos.length - 1}
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function Kpi({
  rotulo,
  valor,
  unidade,
  tom,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly unidade?: string;
  readonly tom: 'normal' | 'atencao' | 'perigo';
}) {
  return (
    <div className="rounded-md border border-neutral-100 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1 font-mono text-[20px] font-semibold',
          tom === 'perigo'
            ? 'text-[var(--color-perigo)]'
            : tom === 'atencao'
              ? 'text-[var(--color-atencao)]'
              : 'text-neutral-900',
        )}
      >
        {valor}
        {unidade ? (
          <span className="ml-1 font-sans text-[12px] font-normal text-neutral-400">{unidade}</span>
        ) : null}
      </p>
    </div>
  );
}

function LinhaRazao({
  movimento,
  verCusto,
  primeiro,
  ultimo,
}: {
  readonly movimento: Movimento;
  readonly verCusto: boolean;
  readonly primeiro: boolean;
  readonly ultimo: boolean;
}) {
  const quando = new Date(movimento.criadoEm);
  const entrada = movimento.sentido === 'ENTRADA';

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 last:border-0',
        verCusto
          ? 'lg:grid lg:grid-cols-[24px_92px_minmax(0,1fr)_72px_128px_96px_116px_120px]'
          : 'lg:grid lg:grid-cols-[24px_92px_minmax(0,1fr)_72px_128px_120px]',
        movimento.saldoNegativo && 'bg-[#fdf6f6]',
      )}
    >
      {/* O fio da linha do tempo: o razão é uma cadeia, não uma lista. */}
      <span className="relative hidden h-full justify-center lg:flex" aria-hidden="true">
        <span
          className={juntar(
            'absolute w-px bg-neutral-100',
            primeiro ? 'top-1/2' : 'top-0',
            ultimo ? 'h-1/2' : 'bottom-0',
          )}
        />
        <span
          className={juntar(
            'relative mt-[7px] size-2 rounded-full',
            movimento.saldoNegativo
              ? 'bg-[var(--color-perigo)]'
              : entrada
                ? 'bg-[var(--color-sucesso)]'
                : 'bg-neutral-300',
          )}
        />
      </span>

      <span className="order-1 lg:order-none">
        <span className="block font-mono text-[12px] text-neutral-700">
          {quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
        </span>
        <span className="block font-mono text-[10.5px] text-neutral-400">
          {quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>

      <span className="order-3 flex w-full min-w-0 flex-wrap items-center gap-2 lg:order-none lg:w-auto">
        <span
          className={juntar(
            'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase',
            entrada
              ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
              : 'bg-neutral-100 text-neutral-600',
          )}
        >
          {ROTULO_TIPO[movimento.tipo] ?? movimento.tipo}
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-neutral-700">
          {movimento.documentoNumero ?? movimento.justificativa ?? '—'}
        </span>
        {movimento.saldoNegativo ? (
          <span className="shrink-0 rounded bg-[var(--color-perigo-fundo)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-perigo)]">
            saldo negativo
          </span>
        ) : null}
      </span>

      <span
        className={juntar(
          'order-2 text-right font-mono text-[13px] font-medium lg:order-none',
          entrada ? 'text-[var(--color-sucesso)]' : 'text-neutral-900',
        )}
      >
        {entrada ? '+' : '−'}
        {qtd(movimento.quantidade)}
      </span>

      {/* Saldo antes → depois: o encadeamento é o que se confere de fora. */}
      <span className="order-4 flex items-center gap-1.5 font-mono text-[12px] lg:order-none">
        <span className="text-neutral-400">{qtd(movimento.saldoAnterior)}</span>
        <span className="text-neutral-300">→</span>
        <span
          className={juntar(
            'font-medium',
            Number(movimento.saldoPosterior) < 0
              ? 'text-[var(--color-perigo)]'
              : 'text-neutral-900',
          )}
        >
          {qtd(movimento.saldoPosterior)}
        </span>
      </span>

      {verCusto ? (
        <span className="order-5 text-right font-mono text-[12px] text-neutral-600 lg:order-none">
          {movimento.custoUnitario ? `R$ ${brl(movimento.custoUnitario)}` : '—'}
        </span>
      ) : null}

      {verCusto ? (
        <span className="order-6 text-right lg:order-none">
          <span className="block font-mono text-[12px] text-neutral-900">
            {movimento.custoMedioDepois ? `R$ ${brl(movimento.custoMedioDepois)}` : '—'}
          </span>
          {/*
            A política diz por que o custo mudou — ou não. "Redefinido"
            acontece quando o saldo anterior era zero: não há média a fazer.
          */}
          {movimento.politicaCusto === 'MEDIA_PONDERADA' ? (
            <span className="block text-[10px] text-neutral-400">média recalculada</span>
          ) : movimento.politicaCusto === 'CUSTO_REDEFINIDO' ? (
            <span className="block text-[10px] text-neutral-400">custo redefinido</span>
          ) : movimento.politicaCusto === 'CUSTO_HISTORICO' ? (
            <span className="block text-[10px] text-neutral-400">preservado</span>
          ) : null}
        </span>
      ) : null}

      <span className="order-7 ml-auto truncate text-[12px] text-neutral-500 lg:order-none lg:ml-0">
        {movimento.ator ?? 'Sistema'}
      </span>
    </div>
  );
}
