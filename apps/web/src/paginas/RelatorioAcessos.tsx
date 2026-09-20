import { type LinhaAcesso, type RelatorioAcessos } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  CabecalhoRelatorio,
  dataHora,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

const ACOES: Record<string, { nome: string; classe: string }> = {
  RELATORIO_EXPORTADO: {
    nome: 'Exportou relatório',
    classe: 'bg-neutral-100 text-neutral-700',
  },
  CROSS_TENANT_ATTEMPT: {
    nome: 'Tentou ler outra empresa',
    classe: 'bg-[#fdecec] text-[var(--color-perigo)]',
  },
  REUSO_DETECTADO: {
    nome: 'Reuso de token',
    classe: 'bg-[#fdecec] text-[var(--color-perigo)]',
  },
  SENHA_REDEFINIDA: {
    nome: 'Senha redefinida',
    classe: 'bg-[#fdf3e3] text-[var(--color-atencao)]',
  },
};

/**
 * Acessos e exportações.
 *
 * O CSV é montado no navegador e nunca passaria pelo servidor — por isso a
 * tela avisa a API antes de baixar. Sem esse aviso, "quem levou dado de
 * custo" seria uma tela em branco que parece dizer que ninguém exportou nada.
 */
export function RelatorioAcessosTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();
  const dias = Number(parametrosUrl.get('dias') ?? 30);

  function trocar(valor: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === '30') limpos.delete('dias');
    else limpos.set('dias', valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'auditoria', 'acessos', dias],
    queryFn: () =>
      pedir<RelatorioAcessos>(`/relatorios/auditoria/acessos?dias=${String(dias)}&limite=120`),
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'acessos-e-exportacoes.csv',
      ['quando', 'acao', 'ator', 'relatorio', 'linhas', 'com_custo', 'ip'],
      dados.itens.map((i) => [
        dataHora(i.em),
        ACOES[i.acao]?.nome ?? i.acao,
        i.ator ?? '',
        i.relatorio ?? '',
        i.linhas ?? '',
        i.comCusto ? 'sim' : 'não',
        i.ip ?? '',
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Acessos e exportações"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Acessos e exportações
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              Quem levou dado de custo ou de cliente · e o que o servidor recusou
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

        {consulta.isPending ? <EstadoCarregando titulo="Vendo o que saiu…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível ler os acessos"
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
                rotulo="Exportações"
                valor={String(dados.exportacoes)}
                nota={`${dados.linhasExportadas} linhas saíram em CSV`}
              />
              <Indicador
                rotulo="Levaram custo"
                valor={String(dados.comCusto)}
                nota="o arquivo tinha coluna de custo, valor ou margem"
                tom={dados.comCusto > 0 ? 'atencao' : 'normal'}
              />
              {/*
                Estes dois não são exportação, mas pertencem à mesma pergunta:
                quem tentou ver o que não devia. O RLS barrou — e registrou.
              */}
              <Indicador
                rotulo="Tentativas entre empresas"
                valor={String(dados.crossTenant)}
                nota="barradas pelo banco, não pela tela"
                tom={dados.crossTenant > 0 ? 'perigo' : 'normal'}
              />
              <Indicador
                rotulo="Reuso de token"
                valor={String(dados.reusoDeToken)}
                nota="sessão derrubada por segurança"
                tom={dados.reusoDeToken > 0 ? 'perigo' : 'normal'}
              />
            </div>

            <p className="shrink-0 rounded-lg border border-neutral-100 bg-neutral-25 px-3.5 py-2.5 text-[12.5px] leading-[18px] text-neutral-600">
              O CSV é montado no navegador e nunca passa pelo servidor. A tela{' '}
              <strong className="text-neutral-800">avisa</strong> a API antes de baixar — se o aviso
              falhar, o arquivo desce assim mesmo e a falha fica no console. Impedir a exportação
              porque o registro falhou seria pior.
            </p>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="flex min-h-0 flex-1 flex-col lg:min-w-[780px]">
                  <Cabecalho />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {dados.itens.length === 0 ? (
                      <EstadoVazio
                        titulo="Nada saiu no período"
                        descricao="Nenhuma exportação nem evento de segurança."
                      />
                    ) : (
                      dados.itens.map((i) => <Linha key={i.id} item={i} />)
                    )}
                  </div>
                </div>
              </Painel>

              <PorAtor dados={dados} />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function PorAtor({ dados }: { readonly dados: RelatorioAcessos }) {
  return (
    <section className="w-full shrink-0 self-start rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[300px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">Quem exportou</h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Levar dado não é falha. Não saber quem levou é.
      </p>

      {dados.porAtor.length === 0 ? (
        <p className="mt-4 text-[13px] text-neutral-400">Nenhuma exportação no período.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-2.5">
          {dados.porAtor.map((a) => (
            <div key={a.ator} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[12.5px] text-neutral-700">{a.ator}</span>
              <span className="shrink-0 font-mono text-[12.5px] text-neutral-900">
                {a.exportacoes}
                {a.comCusto > 0 ? (
                  <span className="ml-1.5 text-[11.5px] font-medium text-[var(--color-atencao)]">
                    {a.comCusto} c/ custo
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const GRADE = 'sm:grid-cols-[124px_180px_minmax(150px,1fr)_180px_74px_120px]';

function Cabecalho() {
  const colunas = ['Quando', 'O que', 'Quem', 'Relatório', 'Linhas', 'IP'];

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
            c === 'Linhas' ? 'text-right' : '',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function Linha({ item }: { readonly item: LinhaAcesso }) {
  const alerta = item.acao === 'CROSS_TENANT_ATTEMPT' || item.acao === 'REUSO_DETECTADO';

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2 sm:grid',
        GRADE,
        alerta && 'bg-[#fdf5f5]',
      )}
    >
      <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

      <span>
        <span
          className={juntar(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
            ACOES[item.acao]?.classe ?? 'bg-neutral-100 text-neutral-700',
          )}
        >
          {ACOES[item.acao]?.nome ?? item.acao}
        </span>
      </span>

      <span className="min-w-0 truncate text-[13px] text-neutral-900">{item.ator ?? '—'}</span>

      <span className="min-w-0 truncate text-[12.5px] text-neutral-600">
        {item.relatorio ?? '—'}
        {item.comCusto ? (
          <span className="ml-1.5 inline-flex rounded-full bg-[#fdf3e3] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-atencao)]">
            custo
          </span>
        ) : null}
      </span>

      <span className="font-mono text-[12.5px] text-neutral-600 sm:text-right">
        {item.linhas ?? '—'}
      </span>

      <span className="font-mono text-[11.5px] text-neutral-400">{item.ip ?? '—'}</span>
    </div>
  );
}
