import { type LinhaTrilha, type RelatorioTrilha } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';
import {
  baixarCsv,
  CabecalhoRelatorio,
  dataHora,
  Filtro,
  Indicador,
  Painel,
  PERIODOS,
  rotuloPeriodo,
  Selecao,
} from './relatorio-pecas';

const ENTIDADES: Record<string, string> = {
  produto: 'Produto',
  produto_imagem: 'Foto de produto',
  movimento_estoque: 'Movimentação de estoque',
  venda: 'Venda',
  pedido: 'Pedido',
  caixa: 'Caixa',
  carteira: 'Carteira',
  carteira_movimento: 'Lançamento de carteira',
  tabela_preco: 'Tabela de preço',
  requisicao: 'Requisição',
  usuario: 'Usuário',
  loja: 'Loja',
  cliente: 'Cliente',
};

/**
 * Trilha por entidade.
 *
 * `audit_log` é append-only: esta tela só lê. O antes e o depois viram uma
 * lista dos campos que MUDARAM — despejar os dois JSON faria quem audita
 * comparar chave a chave, e é aí que a alteração passa despercebida.
 */
export function RelatorioTrilhaTela() {
  const [parametrosUrl, setParametrosUrl] = useSearchParams();

  const dias = Number(parametrosUrl.get('dias') ?? 90);
  const entidade = parametrosUrl.get('entidade') ?? '';
  const entidadeId = parametrosUrl.get('entidadeId') ?? '';

  function trocar(chave: string, valor: string) {
    const limpos = new URLSearchParams(parametrosUrl);
    if (!valor) limpos.delete(chave);
    else limpos.set(chave, valor);
    // Trocar de entidade invalida o id digitado para a anterior.
    if (chave === 'entidade') limpos.delete('entidadeId');
    setParametrosUrl(limpos, { replace: true });
  }

  const consulta = useQuery({
    queryKey: ['relatorios', 'auditoria', 'trilha', dias, entidade, entidadeId],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '120', dias: String(dias) });
      if (entidade) p.set('entidade', entidade);
      // Um id incompleto não é filtro: só viaja quando está inteiro.
      if (entidadeId.length === 36) p.set('entidadeId', entidadeId);
      return pedir<RelatorioTrilha>(`/relatorios/auditoria/trilha?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;

  function exportar() {
    if (!dados) return;

    baixarCsv(
      'trilha-de-auditoria.csv',
      ['quando', 'acao', 'entidade', 'entidade_id', 'ator', 'motivo', 'ip', 'mudancas'],
      dados.itens.map((i) => [
        dataHora(i.em),
        i.acao,
        i.entidade,
        i.entidadeId ?? '',
        i.ator ?? '',
        i.motivo ?? '',
        i.ip ?? '',
        i.mudancas.map((m) => `${m.campo}: ${m.antes} → ${m.depois}`).join(' | '),
      ]),
    );
  }

  return (
    <>
      <CabecalhoRelatorio
        titulo="Trilha por entidade"
        comCusto={false}
        aoExportar={exportar}
        podeExportar={Boolean(dados)}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
              Trilha por entidade
            </h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              Tudo que aconteceu com um registro · a trilha é somente leitura
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Selecao
              rotulo="Período"
              valor={String(dias)}
              aoMudar={(v) => trocar('dias', v === '90' ? '' : v)}
            >
              {PERIODOS.map((d) => (
                <option key={d} value={d}>
                  {rotuloPeriodo(d)}
                </option>
              ))}
            </Selecao>

            {/*
              As entidades vêm da consulta, com a contagem: decorar
              `movimento_estoque` para digitar no filtro não é interface.
            */}
            <Selecao rotulo="Entidade" valor={entidade} aoMudar={(v) => trocar('entidade', v)}>
              <option value="">Todas</option>
              {(dados?.entidades ?? []).map((e) => (
                <option key={e.entidade} value={e.entidade}>
                  {ENTIDADES[e.entidade] ?? e.entidade} ({e.registros})
                </option>
              ))}
            </Selecao>

            <Filtro rotulo="Id">
              <input
                value={entidadeId}
                onChange={(e) => trocar('entidadeId', e.target.value)}
                aria-label="Id do registro"
                placeholder="cole para ver só ele"
                className="w-[210px] bg-transparent font-mono text-[12px] text-neutral-900 outline-none placeholder:font-sans placeholder:text-neutral-400"
              />
            </Filtro>
          </div>
        </div>

        {consulta.isPending ? <EstadoCarregando titulo="Lendo a trilha…" /> : null}

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
                rotulo="Registros no recorte"
                valor={String(dados.registros)}
                nota={
                  dados.entidadeId
                    ? 'deste registro'
                    : dados.entidade
                      ? `de ${ENTIDADES[dados.entidade] ?? dados.entidade}`
                      : 'de todas as entidades'
                }
              />
              <Indicador
                rotulo="Entidades com registro"
                valor={String(dados.entidades.length)}
                nota={`em ${rotuloPeriodo(dados.dias)}`}
              />
              <Indicador
                rotulo="Exibindo"
                valor={String(dados.itens.length)}
                nota="do mais recente para trás"
              />
            </div>

            <Painel>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {dados.itens.length === 0 ? (
                  <EstadoVazio
                    titulo="Nada nesta trilha"
                    descricao="Ajuste o período, a entidade ou o id."
                  />
                ) : (
                  dados.itens.map((i) => <Linha key={i.id} item={i} />)
                )}
              </div>
            </Painel>
          </>
        ) : null}
      </main>
    </>
  );
}

function Linha({ item }: { readonly item: LinhaTrilha }) {
  return (
    <article className="border-b border-neutral-50 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[11.5px] text-neutral-500">{dataHora(item.em)}</span>

        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">
          {item.acao}
        </span>

        <span className="text-[12.5px] text-neutral-600">
          {ENTIDADES[item.entidade] ?? item.entidade}
        </span>

        {item.entidadeId ? (
          <span className="font-mono text-[11px] text-neutral-400">{item.entidadeId}</span>
        ) : null}

        <span className="flex-1" />

        <span className="text-[12.5px] text-neutral-600">
          {item.ator ?? (item.atorTipo === 'SISTEMA' ? 'Sistema' : 'Não identificado')}
        </span>

        {item.ip ? <span className="font-mono text-[11px] text-neutral-400">{item.ip}</span> : null}
      </div>

      {item.motivo ? (
        <p className="mt-1 text-[12.5px] text-neutral-600">
          <span className="text-neutral-400">Motivo: </span>
          {item.motivo}
        </p>
      ) : null}

      {/* Só os campos que mudaram: a lista inteira esconde a alteração. */}
      {item.mudancas.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {item.mudancas.map((m) => (
            <p key={m.campo} className="text-[12px] leading-[17px]">
              <span className="font-medium text-neutral-700">{m.campo}</span>
              <span className="text-neutral-400"> · </span>
              <span className="font-mono text-neutral-500 line-through">{m.antes}</span>
              <span className="text-neutral-400"> → </span>
              <span className={juntar('font-mono font-medium text-neutral-900')}>{m.depois}</span>
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}
