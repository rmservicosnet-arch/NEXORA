import {
  PERM,
  type Caixa as CaixaDto,
  type CaixaAtual,
  type ContextoPdv,
  type PaginaCaixas,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(valor: string | number): string {
  return Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function Caixa() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [lojaId, setLojaId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<
    'abrir' | 'fechar' | 'sangria' | 'suprimento' | null
  >(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');

  const contexto = useQuery({
    queryKey: ['pdv', 'contexto'],
    queryFn: () => pedir<ContextoPdv>('/vendas/contexto'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const lojas = contexto.data?.lojas ?? [];
    if (!lojaId && lojas.length > 0) {
      setLojaId(lojas[0]!.id);
    }
  }, [contexto.data, lojaId]);

  const atual = useQuery({
    queryKey: ['caixa', 'meu', lojaId],
    queryFn: () => pedir<CaixaAtual>(`/caixa/meu?lojaId=${lojaId}`),
    enabled: Boolean(lojaId),
  });

  const historico = useQuery({
    queryKey: ['caixa', 'historico'],
    queryFn: () => pedir<PaginaCaixas>('/caixa?limite=20'),
  });

  const caixa = atual.data?.caixa ?? null;

  function fechar() {
    setFormulario(null);
    setValor('');
    setMotivo('');
    setErro(null);
  }

  const acao = useMutation({
    mutationFn: async () => {
      if (formulario === 'abrir') {
        return pedir<CaixaDto>('/caixa/abrir', {
          method: 'POST',
          body: { lojaId, valorAbertura: valor || '0', ...(motivo ? { observacao: motivo } : {}) },
        });
      }

      if (!caixa) throw new Error('sem caixa');

      if (formulario === 'fechar') {
        return pedir<CaixaDto>(`/caixa/${caixa.id}/fechar`, {
          method: 'POST',
          body: { valorContado: valor || '0', ...(motivo ? { observacao: motivo } : {}) },
        });
      }

      return pedir<CaixaDto>(`/caixa/${caixa.id}/movimento`, {
        method: 'POST',
        body: {
          tipo: formulario === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO',
          valor,
          motivo,
        },
      });
    },
    onSuccess: async () => {
      fechar();
      await fila.invalidateQueries({ queryKey: ['caixa'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  if (contexto.isPending) {
    return <EstadoCarregando titulo="Carregando…" />;
  }

  const lojas = contexto.data?.lojas ?? [];

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Caixa</span>

        <select
          value={lojaId}
          onChange={(e) => setLojaId(e.target.value)}
          aria-label="Loja"
          className="h-[35px] rounded-md border border-neutral-200 bg-white px-2.5 text-[13px]"
        >
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {caixa ? (
          <>
            {pode(PERM.caixa.suprimento) ? (
              <Botao
                variante="secundario"
                onClick={() => {
                  fechar();
                  setFormulario('suprimento');
                }}
              >
                Suprimento
              </Botao>
            ) : null}
            {pode(PERM.caixa.sangria) ? (
              <Botao
                variante="secundario"
                onClick={() => {
                  fechar();
                  setFormulario('sangria');
                }}
              >
                Sangria
              </Botao>
            ) : null}
            {pode(PERM.caixa.fechar) ? (
              <Botao
                variante="primario"
                onClick={() => {
                  fechar();
                  setFormulario('fechar');
                  setValor(caixa.resumo.esperadoEmCaixa);
                }}
              >
                Fechar caixa
              </Botao>
            ) : null}
          </>
        ) : pode(PERM.caixa.abrir) ? (
          <Botao
            variante="primario"
            onClick={() => {
              fechar();
              setFormulario('abrir');
            }}
          >
            Abrir caixa
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {formulario ? (
            <section className="flex flex-col gap-3 rounded-md border border-primary-100 bg-primary-50 p-5">
              <h2 className="font-display text-[15px] font-semibold text-neutral-900">
                {formulario === 'abrir'
                  ? 'Abrir caixa'
                  : formulario === 'fechar'
                    ? 'Fechar caixa'
                    : formulario === 'sangria'
                      ? 'Registrar sangria'
                      : 'Registrar suprimento'}
              </h2>

              {formulario === 'fechar' ? (
                <Aviso tom="atencao">
                  Informe o que foi <strong>contado na gaveta</strong>. A diferença para o esperado
                  fica registrada como é — o sistema não ajusta nada.
                </Aviso>
              ) : null}

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  {formulario === 'abrir'
                    ? 'Fundo de troco'
                    : formulario === 'fechar'
                      ? 'Valor contado'
                      : 'Valor'}
                </span>
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="h-12 w-[200px] rounded-md border border-neutral-200 bg-white px-3 text-right font-mono text-[18px]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  {formulario === 'sangria' || formulario === 'suprimento'
                    ? 'Motivo'
                    : 'Observação (opcional)'}
                </span>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={
                    formulario === 'sangria'
                      ? 'Para onde foi o dinheiro'
                      : formulario === 'suprimento'
                        ? 'De onde veio o dinheiro'
                        : ''
                  }
                  className="h-11 rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
                />
              </label>

              <div className="flex gap-2">
                <Botao
                  variante="primario"
                  carregando={acao.isPending}
                  disabled={
                    valor.trim().length === 0 ||
                    ((formulario === 'sangria' || formulario === 'suprimento') &&
                      motivo.trim().length < 5)
                  }
                  onClick={() => acao.mutate()}
                >
                  Confirmar
                </Botao>
                <Botao variante="secundario" onClick={fechar}>
                  Cancelar
                </Botao>
              </div>
            </section>
          ) : null}

          {atual.isPending ? <EstadoCarregando titulo="Carregando caixa…" /> : null}

          {caixa ? <PainelCaixa caixa={caixa} /> : null}

          {!caixa && !atual.isPending && !formulario ? (
            <Aviso tom="info" titulo="Nenhum caixa aberto nesta loja">
              Enquanto não houver caixa aberto, o PDV recusa pagamento em dinheiro. Cartão e PIX
              continuam funcionando — eles não passam pela gaveta.
            </Aviso>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              Caixas anteriores
            </h2>

            <div className="overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              {(historico.data?.itens ?? []).length === 0 ? (
                <p className="p-5 text-[13px] text-neutral-500">Nenhum caixa registrado ainda.</p>
              ) : (
                (historico.data?.itens ?? []).map((c) => <LinhaHistorico key={c.id} caixa={c} />)
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function PainelCaixa({ caixa }: { readonly caixa: CaixaDto }) {
  const r = caixa.resumo;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[17px] font-semibold text-neutral-900">
            Caixa {caixa.numero}
          </h2>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            {caixa.operador} · aberto em{' '}
            {new Date(caixa.abertoEm).toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
        </div>

        <div className="text-right">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Esperado na gaveta
          </p>
          <p className="font-mono text-[28px] font-bold leading-9 text-neutral-900">
            R$ {brl(r.esperadoEmCaixa)}
          </p>
        </div>
      </div>

      {/* A conta aberta em parcelas.
          O total sozinho não serve a quem confere: diante de uma diferença, a
          única saída seria aceitar o número. */}
      <div className="grid grid-cols-4 gap-3 rounded-md bg-neutral-25 p-4">
        <Parcela rotulo="Fundo de troco" valor={r.valorAbertura} />
        <Parcela rotulo="Suprimentos" valor={r.suprimentos} sinal="+" />
        <Parcela rotulo="Sangrias" valor={r.sangrias} sinal="−" />
        <Parcela rotulo="Vendas em dinheiro" valor={r.vendasEmDinheiro} sinal="+" destaque />
      </div>

      <div className="grid grid-cols-4 gap-3 border-t border-neutral-100 pt-3">
        <Parcela rotulo="Cartão" valor={r.vendasEmCartao} discreto />
        <Parcela rotulo="PIX" valor={r.vendasEmPix} discreto />
        <Parcela rotulo="Outras formas" valor={r.outrasFormas} discreto />
        <div>
          <p className="text-[11.5px] text-neutral-500">Vendido no turno</p>
          <p className="font-mono text-[15px] font-semibold text-neutral-900">
            R$ {brl(r.totalVendido)}
          </p>
          <p className="text-[11px] text-neutral-400">
            {r.quantidadeVendas} venda{r.quantidadeVendas === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {caixa.movimentos.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-neutral-100 pt-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Sangrias e suprimentos
          </p>
          {caixa.movimentos.map((m) => (
            <div key={m.id} className="flex items-baseline gap-2 text-[13px]">
              <span
                className={juntar(
                  'w-[92px] shrink-0 font-medium',
                  m.tipo === 'SANGRIA' ? 'text-[--color-perigo]' : 'text-[--color-sucesso]',
                )}
              >
                {m.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}
              </span>
              <span className="w-[100px] shrink-0 text-right font-mono text-neutral-900">
                {m.tipo === 'SANGRIA' ? '−' : '+'} R$ {brl(m.valor)}
              </span>
              <span className="min-w-0 flex-1 truncate text-neutral-500">{m.motivo}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Parcela({
  rotulo,
  valor,
  sinal,
  destaque,
  discreto,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly sinal?: '+' | '−';
  readonly destaque?: boolean;
  readonly discreto?: boolean;
}) {
  return (
    <div>
      <p className="text-[11.5px] text-neutral-500">{rotulo}</p>
      <p
        className={juntar(
          'font-mono text-[15px]',
          destaque
            ? 'font-semibold text-neutral-900'
            : discreto
              ? 'text-neutral-600'
              : 'text-neutral-900',
        )}
      >
        {sinal && Number(valor) > 0 ? `${sinal} ` : ''}R$ {brl(valor)}
      </p>
    </div>
  );
}

function LinhaHistorico({ caixa }: { readonly caixa: CaixaDto }) {
  const diferenca = caixa.diferenca === null ? null : Number(caixa.diferenca);

  return (
    <div className="grid grid-cols-[70px_minmax(0,1fr)_130px_120px_120px] items-center gap-3 border-b border-neutral-50 px-4 py-2.5 last:border-0">
      <span className="font-mono text-[13px] text-neutral-600">#{caixa.numero}</span>

      <div className="min-w-0">
        <p className="truncate text-[13.5px] text-neutral-900">{caixa.operador}</p>
        <p className="truncate text-[11.5px] text-neutral-400">
          {caixa.loja} · {new Date(caixa.abertoEm).toLocaleDateString('pt-BR')}
        </p>
      </div>

      <Selo status={caixa.status} />

      <span className="text-right font-mono text-[13px] text-neutral-600">
        {caixa.valorContado === null ? '—' : `R$ ${brl(caixa.valorContado)}`}
      </span>

      <span
        className={juntar(
          'text-right font-mono text-[13px] font-medium',
          diferenca === null
            ? 'text-neutral-400'
            : diferenca === 0
              ? 'text-[--color-sucesso]'
              : 'text-[--color-perigo]',
        )}
        title={diferenca === null ? undefined : diferenca < 0 ? 'Falta' : 'Sobra'}
      >
        {diferenca === null
          ? '—'
          : diferenca === 0
            ? 'exato'
            : `${diferenca > 0 ? '+' : '−'} R$ ${brl(Math.abs(diferenca))}`}
      </span>
    </div>
  );
}

function Selo({ status }: { readonly status: CaixaDto['status'] }) {
  const mapa = {
    ABERTO: { texto: 'Aberto', cor: 'text-[--color-sucesso] bg-[--color-sucesso-fundo]' },
    FECHADO: { texto: 'Fechado', cor: 'text-[--color-atencao] bg-[--color-atencao-fundo]' },
    CONFERIDO: { texto: 'Conferido', cor: 'text-neutral-600 bg-neutral-50' },
  } as const;

  const { texto, cor } = mapa[status];

  return (
    <span
      className={juntar(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
        cor,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {texto}
    </span>
  );
}
