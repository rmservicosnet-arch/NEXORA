import { type LinhaAging, type RelatorioAging } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import { baixarCsv, brl, CabecalhoRelatorio, Indicador, Painel, Selecao } from './relatorio-pecas';

/**
 * Aging: quanto se deve, e há quanto tempo venceu.
 *
 * O mesmo relatório dos dois lados. A pagar responde "o que a loja precisa
 * pagar"; a receber, "quem está devendo para ela" — e o saldo do revendedor
 * continua sendo o da carteira: aqui entra só o que tem VENCIMENTO.
 *
 * Todas as colunas somam `valor − pago`, nunca o valor cheio. Um título de
 * 9.600 com 4.743 já pagos pesa 4.856; somar o cheio mostraria uma dívida
 * que já não existe.
 */
export function RelatorioAgingTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const tipo = parametrosUrl.get('tipo') === 'RECEBER' ? 'RECEBER' : 'PAGAR';

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'aging', tipo],
    queryFn: () => pedir<RelatorioAging>(`/relatorios/financeiro/aging?tipo=${tipo}&limite=200`),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const aPagar = tipo === 'PAGAR';

  function exportar() {
    if (!dados) return;

    baixarCsv(
      `aging-${aPagar ? 'a-pagar' : 'a-receber'}.csv`,
      [aPagar ? 'fornecedor' : 'cliente', ...dados.faixas.map((f) => f.faixa), 'total', 'titulos'],
      dados.itens.map((i) => [i.contraparte, ...i.porFaixa, i.total, i.titulos]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo={aPagar ? 'Contas a pagar por vencimento' : 'Contas a receber por vencimento'}
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              {aPagar ? 'Contas a pagar por vencimento' : 'Contas a receber por vencimento'}
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              Cada coluna soma o que{' '}
              <strong className="font-semibold text-neutral-900">falta</strong>, não o valor cheio
              do título
              {aPagar ? '' : ' · o saldo do cliente continua sendo o da carteira'}
            </p>
          </div>

          <Selecao rotulo="Lado" valor={tipo} aoMudar={(v) => trocar('tipo', v, 'PAGAR')}>
            <option value="PAGAR">A pagar — fornecedores</option>
            <option value="RECEBER">A receber — clientes</option>
          </Selecao>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Agrupando por vencimento…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível montar o aging"
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
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {dados.faixas.map((f, i) => (
                <Indicador
                  key={f.faixa}
                  rotulo={f.faixa}
                  valor={`R$ ${brl(f.valor)}`}
                  nota={`${String(f.titulos)} ${f.titulos === 1 ? 'título' : 'títulos'}`}
                  /*
                    A cor escala com o atraso: a vencer é normal, e "mais de
                    60 dias" é onde mora o que provavelmente não vai ser pago.
                  */
                  tom={
                    Number(f.valor) === 0
                      ? 'normal'
                      : i === 0
                        ? 'normal'
                        : i === 3
                          ? 'perigo'
                          : 'atencao'
                  }
                />
              ))}
            </div>

            <Painel>
              <div className="flex min-h-0 flex-1 flex-col lg:min-w-[980px]">
                <Cabecalho faixas={dados.faixas.map((f) => f.faixa)} aPagar={aPagar} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo={aPagar ? 'Nada a pagar' : 'Nada a receber'}
                      descricao="Nenhum título em aberto neste lado."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.contraparte} item={i} />)
                  )}
                </div>

                {/*
                  O rodapé fecha com as faixas de cima: se a soma das colunas
                  não desse o total, uma das duas estaria errada — e quem lê
                  não teria como saber qual.
                */}
                <div className="hidden shrink-0 items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3 lg:flex">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    {dados.itens.length}{' '}
                    {aPagar
                      ? dados.itens.length === 1
                        ? 'fornecedor'
                        : 'fornecedores'
                      : dados.itens.length === 1
                        ? 'cliente'
                        : 'clientes'}{' '}
                    · {dados.totalTitulos} títulos
                  </span>
                  <span className="flex-1" />
                  <span className="text-[12.5px] text-neutral-500">
                    vencido R$ {brl(dados.vencido)} · a vencer R$ {brl(dados.aVencer)}
                  </span>
                  <span className="font-mono text-[14px] font-semibold tabular-nums text-neutral-900">
                    R$ {brl(dados.total)}
                  </span>
                </div>
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

const GRADE = 'lg:grid-cols-[minmax(200px,1fr)_130px_130px_130px_130px_140px]';

function Cabecalho({
  faixas,
  aPagar,
}: {
  readonly faixas: readonly string[];
  readonly aPagar: boolean;
}) {
  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
        GRADE,
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {aPagar ? 'Fornecedor' : 'Cliente'}
      </span>
      {faixas.map((f) => (
        <span
          key={f}
          className="text-right text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500"
        >
          {f}
        </span>
      ))}
      <span className="text-right text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        Total
      </span>
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAging }) {
  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 lg:grid',
        GRADE,
        item.atrasoMaisAntigo !== null && item.atrasoMaisAntigo > 60 && 'bg-[#fdf5f5]',
      )}
    >
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        <span className="block truncate text-[13px] text-neutral-900">{item.contraparte}</span>
        <span className="block text-[11.5px] text-neutral-500">
          {item.titulos} {item.titulos === 1 ? 'título' : 'títulos'}
          {item.atrasoMaisAntigo === null
            ? ''
            : ` · o mais antigo venceu há ${String(item.atrasoMaisAntigo)} dias`}
        </span>
      </span>

      {item.porFaixa.map((valor, i) => (
        <span
          key={i}
          className={juntar(
            'font-mono text-[12.5px] tabular-nums lg:text-right',
            Number(valor) === 0
              ? 'text-neutral-300'
              : i === 3
                ? 'font-medium text-[var(--color-perigo)]'
                : i === 0
                  ? 'text-neutral-600'
                  : 'text-[var(--color-atencao)]',
          )}
        >
          {Number(valor) === 0 ? '—' : `R$ ${brl(valor)}`}
        </span>
      ))}

      <span className="ml-auto font-mono text-[13px] font-semibold tabular-nums text-neutral-900 lg:ml-0 lg:text-right">
        R$ {brl(item.total)}
      </span>
    </div>
  );
}
