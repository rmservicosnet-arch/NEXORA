import { type LinhaTrilha, type RelatorioSensiveis } from '@estoque/contracts';
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

const ACOES: Record<string, string> = {
  PRECOS_ALTERADOS: 'Preços alterados',
  PRECOS_DA_TABELA_ALTERADOS: 'Preços de tabela alterados',
  VENDA_CANCELADA: 'Venda cancelada',
  ESTOQUE_CONTAGEM: 'Contagem de estoque',
  ESTOQUE_AJUSTE: 'Ajuste de estoque',
  CARTEIRA_AJUSTE_CREDITO: 'Ajuste de crédito',
  CARTEIRA_AJUSTE_DEBITO: 'Ajuste de débito',
  CARTEIRA_BONIFICACAO: 'Bonificação',
  CARTEIRA_ESTORNO: 'Estorno de carteira',
  CARTEIRA_LIMITE_DEFINIDO: 'Limite definido',
  CARTEIRA_BLOQUEADA: 'Carteira bloqueada',
  CARTEIRA_DESBLOQUEADA: 'Carteira desbloqueada',
  PEDIDO_CONFIRMADO_SEM_SALDO: 'Pedido confirmado sem saldo',
  SENHA_REDEFINIDA: 'Senha redefinida',
  PRODUTO_EXCLUIDO: 'Produto excluído',
  IMAGEM_EXCLUIDA: 'Foto excluída',
};

/**
 * Ações sensíveis.
 *
 * O que une estas ações é que nenhuma tem contrapartida automática: alguém
 * decidiu. Por isso o motivo importa — e o que saiu sem motivo é contado, não
 * escondido numa célula vazia.
 */
export function RelatorioSensiveisTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 30);
  const acao = parametrosUrl.get('acao') ?? '';

  function trocar(chave: string, valor: string, padrao: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (valor === padrao) limpos.delete(chave);
    else limpos.set(chave, valor);
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'auditoria', 'sensiveis', dias, acao],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '120', dias: String(dias) });
      if (acao) p.set('acao', acao);
      return pedir<RelatorioSensiveis>(`/relatorios/auditoria/sensiveis?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'acoes-sensiveis.csv',
      ['quando', 'acao', 'entidade', 'entidade_id', 'ator', 'motivo', 'mudancas'],
      dados.itens.map((i) => [
        dataHora(i.em),
        ACOES[i.acao] ?? i.acao,
        i.entidade,
        i.entidadeId ?? '',
        i.ator ?? '',
        i.motivo ?? '',
        i.mudancas.map((m) => `${m.campo}: ${m.antes} → ${m.depois}`).join(' | '),
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Ações sensíveis"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Ações sensíveis
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              Preço, ajuste, cancelamento, estorno · nenhuma tem contrapartida automática
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao rotulo="Período" valor={String(dias)} aoMudar={(v) => trocar('dias', v, '30')}>
              {PERIODOS.map((d) => (
                <option key={d} value={d}>
                  {rotuloPeriodo(d)}
                </option>
              ))}
            </Selecao>

            <Selecao rotulo="Ação" valor={acao} aoMudar={(v) => trocar('acao', v, '')}>
              <option value="">Todas as sensíveis</option>
              {(dados?.porAcao ?? []).map((a) => (
                <option key={a.acao} value={a.acao}>
                  {ACOES[a.acao] ?? a.acao} ({a.registros})
                </option>
              ))}
            </Selecao>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Procurando as decisões…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível ler a trilha"
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
            <div className="grid shrink-0 auto-rows-fr gap-3 sm:grid-cols-3">
              <Indicador
                rotulo="Ações no período"
                valor={String(dados.registros)}
                nota={`em ${rotuloPeriodo(dados.dias)}`}
              />
              <Indicador
                rotulo="Pessoas envolvidas"
                valor={String(dados.atores)}
                nota="tomaram ao menos uma decisão dessas"
              />
              {/*
                Sem motivo é o que o suporte não consegue explicar seis meses
                depois. Vermelho porque é falha de registro, não estatística.
              */}
              <Indicador
                rotulo="Sem motivo escrito"
                valor={String(dados.semMotivo)}
                nota="a decisão existe e ninguém sabe por quê"
                tom={dados.semMotivo > 0 ? 'perigo' : 'normal'}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 lg:flex-row">
              <Painel>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dados.itens.length === 0 ? (
                    <EstadoVazio
                      titulo="Nenhuma ação sensível no período"
                      descricao="Aumente o período ou troque a ação."
                    />
                  ) : (
                    dados.itens.map((i) => <Linha key={i.id} item={i} />)
                  )}
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

function PorAtor({ dados }: { readonly dados: RelatorioSensiveis }) {
  const maior = dados.porAtor.reduce((m, a) => Math.max(m, a.registros), 0);

  return (
    <section className="w-full shrink-0 self-start rounded-lg border border-neutral-100 bg-white p-4 shadow-sm lg:w-[300px]">
      <h2 className="font-display text-[14px] font-semibold text-neutral-900">Por quem decidiu</h2>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Decidir não é falha. Decidir sem escrever o porquê é.
      </p>

      {dados.porAtor.length === 0 ? (
        <p className="mt-4 text-[13px] text-neutral-400">Nenhuma ação no período.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-2.5">
          {dados.porAtor.map((a) => (
            <div key={a.ator}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] text-neutral-700">{a.ator}</span>
                <span className="font-mono text-[12.5px] font-medium text-neutral-900">
                  {a.registros}
                </span>
              </div>

              <div className="mt-1 h-[6px] rounded-full bg-neutral-50">
                <div
                  className="h-full rounded-full bg-[var(--color-primary-500)]"
                  style={{ width: `${maior > 0 ? (a.registros / maior) * 100 : 0}%` }}
                />
              </div>

              {a.semMotivo > 0 ? (
                <p className="mt-0.5 text-[11.5px] font-medium text-[var(--color-perigo)]">
                  {a.semMotivo} sem motivo
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Linha({ item }: { readonly item: LinhaTrilha }) {
  return (
    <article
      className={juntar(
        'border-b border-neutral-50 px-4 py-3',
        item.motivo === null && 'bg-[#fdf5f5]',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">
          {ACOES[item.acao] ?? item.acao}
        </span>

        {item.entidadeId ? (
          <span className="font-mono text-[11px] text-neutral-400">{item.entidadeId}</span>
        ) : null}

        <span className="flex-1" />

        <span className="text-[12.5px] text-neutral-600">{item.ator ?? 'Sistema'}</span>
      </div>

      <p className="mt-1 text-[12.5px]">
        {item.motivo ?? (
          <span className="font-medium text-[var(--color-perigo)]">Sem motivo registrado</span>
        )}
      </p>

      {item.mudancas.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {item.mudancas.map((m) => (
            <p key={m.campo} className="text-[12px] leading-[17px]">
              <span className="font-medium text-neutral-700">{m.campo}</span>
              <span className="text-neutral-400"> · </span>
              <span className="font-mono text-neutral-500 line-through">{m.antes}</span>
              <span className="text-neutral-400"> → </span>
              <span className="font-mono font-medium text-neutral-900">{m.depois}</span>
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}
