import { type LinhaAjuste, type RelatorioAjustes } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  brl,
  CabecalhoRelatorio,
  dataHora,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

const TIPOS: Record<string, string> = {
  AJUSTE_CREDITO: 'Ajuste de crédito',
  AJUSTE_DEBITO: 'Ajuste de débito',
  BONIFICACAO: 'Bonificação',
};

/**
 * Ajustes e bonificações.
 *
 * Quitação tem dinheiro do outro lado; venda a prazo tem mercadoria. Ajuste e
 * bonificação não têm nada — só a assinatura de quem lançou. É por isso que o
 * banco exige justificativa neles, e é por isso que esta tela existe.
 */
export function RelatorioAjustesTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const dias = Number(parametrosUrl.get('dias') ?? 90);

  function trocar(valor: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === '90') limpos.delete('dias');
    else limpos.set('dias', valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'carteira', 'ajustes', dias],
    queryFn: () =>
      pedir<RelatorioAjustes>(`/relatorios/carteira/ajustes?dias=${String(dias)}&limite=200`),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const liquido = Number(dados?.liquido ?? 0);

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'ajustes-e-bonificacoes.csv',
      ['quando', 'cliente', 'tipo', 'sentido', 'valor', 'saldo_depois', 'autor', 'justificativa'],
      dados.itens.map((i) => [
        dataHora(i.em),
        i.cliente,
        TIPOS[i.tipo] ?? i.tipo,
        i.credito ? 'crédito' : 'débito',
        i.valor,
        i.saldoPosterior,
        i.autor ?? '',
        i.justificativa ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Ajustes e bonificações"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Ajustes e bonificações
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {dados ? (
                <>
                  Últimos{' '}
                  <strong className="font-semibold text-neutral-900">
                    {rotuloPeriodo(dados.dias)}
                  </strong>{' '}
                  · os lançamentos que criam dinheiro sem contrapartida
                </>
              ) : (
                'Carregando…'
              )}
            </p>
          </div>

          <Selecao rotulo="Período" valor={String(dias)} aoMudar={trocar}>
            {PERIODOS.map((d) => (
              <option key={d} value={d}>
                {rotuloPeriodo(d)}
              </option>
            ))}
          </Selecao>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Buscando os lançamentos…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível listar os lançamentos"
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
              <Indicador
                rotulo="Lançamentos"
                valor={String(dados.lancamentos)}
                nota="ajustes e bonificações no período"
              />
              <Indicador
                rotulo="Crédito lançado"
                valor={`R$ ${brl(dados.credito)}`}
                nota="dinheiro dado ao cliente"
                tom={Number(dados.credito) > 0 ? 'atencao' : 'normal'}
              />
              <Indicador
                rotulo="Débito lançado"
                valor={`R$ ${brl(dados.debito)}`}
                nota="dívida criada sem venda"
              />
              {/*
                O líquido com sinal: crédito e débito não se anulam num número
                só sem dizer para que lado pendeu.
              */}
              <Indicador
                rotulo="Efeito líquido"
                valor={`${liquido < 0 ? '− ' : '+ '}R$ ${brl(liquido)}`}
                nota={liquido >= 0 ? 'a favor dos clientes' : 'a favor da loja'}
                tom={liquido > 0 ? 'atencao' : 'normal'}
              />
            </div>

            {dados.semJustificativa > 0 ? (
              <p className="shrink-0 rounded-lg border border-[#f0c9cb] bg-[#fdf5f5] px-3.5 py-2.5 text-[12.5px] leading-[18px] text-neutral-700">
                <strong className="text-[var(--color-perigo)]">
                  {dados.semJustificativa}{' '}
                  {dados.semJustificativa === 1 ? 'lançamento' : 'lançamentos'} sem justificativa.
                </strong>{' '}
                O banco exige justificativa nestes tipos — linha sem ela veio de carga direta, fora
                do sistema.
              </p>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[800px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Nenhum ajuste no período"
                        descricao="Nenhum dinheiro foi criado sem contrapartida."
                      />
                    ) : (
                      dados.itens.map((i) => <Linha key={i.id} item={i} />)
                    )}
                  </div>
                </div>
              </Painel>

              <PorAutor dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function PorAutor({ dados }: { readonly dados: RelatorioAjustes }) {
  return (
    <section className="w-full shrink-0 self-start rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[300px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">Por quem lançou</h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Estes lançamentos não têm contrapartida: a assinatura é a única garantia.
      </p>

      {dados.porAutor.length === 0 ? (
        <p className="mt-4 text-[13px] text-neutral-400">Nenhum lançamento no período.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3">
          {dados.porAutor.map((a) => (
            <div
              key={a.autor}
              className="border-t border-neutral-50 pt-2.5 first:border-t-0 first:pt-0"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
                  {a.autor}
                </span>
                <span className="font-mono text-[12.5px] text-neutral-500">{a.lancamentos}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[12px]">
                <span className="text-[var(--color-atencao)]">
                  + <span className="font-mono">R$ {brl(a.credito)}</span>
                </span>
                <span className="text-neutral-600">
                  − <span className="font-mono">R$ {brl(a.debito)}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const GRADE = 'sm:grid-cols-[116px_minmax(150px,1fr)_128px_110px_110px_150px]';

function Cabecalho() {
  const colunas = ['Quando', 'Cliente', 'Tipo', 'Valor', 'Saldo depois', 'Justificativa'];

  return (
    <div
      className={juntar(
        'hidden shrink-0 gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 sm:grid',
        GRADE,
      )}
    >
      {colunas.map((c) => (
        <span
          key={c}
          className={juntar(
            'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
            ['Valor', 'Saldo depois'].includes(c) ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAjuste }) {
  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">
        {item.cliente}
        {item.autor ? (
          <span className="block truncate text-[11.5px] font-normal text-neutral-400">
            por {item.autor}
          </span>
        ) : null}
      </span>

      <span className="truncate text-[12.5px] text-neutral-600">
        {TIPOS[item.tipo] ?? item.tipo}
      </span>

      <span
        className={juntar(
          'font-mono text-[13px] font-medium sm:text-right',
          item.credito ? 'text-[var(--color-atencao)]' : 'text-neutral-900',
        )}
      >
        {item.credito ? '+' : '−'} R$ {brl(item.valor)}
      </span>

      <span
        className={juntar(
          'font-mono text-[12.5px] sm:text-right',
          Number(item.saldoPosterior) < 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-600',
        )}
      >
        R$ {brl(item.saldoPosterior)}
      </span>

      <span className="min-w-0 truncate text-[12.5px]" title={item.justificativa ?? ''}>
        {item.justificativa ?? (
          <span className="font-medium text-[var(--color-perigo)]">não registrada</span>
        )}
      </span>
    </div>
  );
}
