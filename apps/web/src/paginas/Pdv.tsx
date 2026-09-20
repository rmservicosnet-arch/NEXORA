import {
  type CaixaAtual,
  type ContextoPdv,
  type FormaPagamento,
  type ItemParaVenda,
  type ResultadoVenda,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando } from '../ui/Estados';
import { Foto } from '../ui/Foto';
import { juntar } from '../ui/juntar';

interface LinhaCarrinho {
  readonly variacaoId: string;
  readonly sku: string;
  readonly produto: string;
  readonly descricaoVariacao: string;
  readonly imagemPrincipalId: string | null;
  readonly precoTabela: string;
  quantidade: number;
  /** Preenchido só quando o operador digita outro preço. */
  precoManual: string | null;
  readonly saldo: number;
}

interface LinhaPagamento {
  readonly chave: number;
  forma: FormaPagamento;
  valor: string;
}

const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'PIX', rotulo: 'PIX' },
  { valor: 'DEBITO', rotulo: 'Débito' },
  { valor: 'CREDITO', rotulo: 'Crédito' },
  { valor: 'TRANSFERENCIA', rotulo: 'Transferência' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'PRAZO', rotulo: 'A prazo' },
];

function brl(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Pdv() {
  const fila = useQueryClient();
  const campoBusca = useRef<HTMLInputElement>(null);

  const [lojaId, setLojaId] = useState('');
  const [tabelaPrecoId, setTabelaPrecoId] = useState('');
  const [termo, setTermo] = useState('');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [desconto, setDesconto] = useState('');
  const [pagamentos, setPagamentos] = useState<LinhaPagamento[]>([
    { chave: 1, forma: 'DINHEIRO', valor: '' },
  ]);
  const [erro, setErro] = useState<string | null>(null);
  const [concluida, setConcluida] = useState<ResultadoVenda | null>(null);

  const contexto = useQuery({
    queryKey: ['pdv', 'contexto'],
    queryFn: () => pedir<ContextoPdv>('/vendas/contexto'),
    staleTime: 5 * 60_000,
  });

  // Uma loja só: não faz o operador escolher o óbvio toda vez que abre o caixa.
  useEffect(() => {
    const lojas = contexto.data?.lojas ?? [];
    if (!lojaId && lojas.length > 0) {
      setLojaId(lojas[0]!.id);
    }
  }, [contexto.data, lojaId]);

  useEffect(() => {
    campoBusca.current?.focus();
  }, [concluida]);

  // O caixa é perguntado na abertura da tela, não no fechamento da venda.
  // Descobrir que o caixa está fechado depois de montar o carrinho inteiro é
  // fazer o cliente esperar por uma informação que já existia.
  const caixa = useQuery({
    queryKey: ['caixa', 'meu', lojaId],
    queryFn: () => pedir<CaixaAtual>(`/caixa/meu?lojaId=${lojaId}`),
    enabled: Boolean(lojaId),
  });

  const caixaAberto = caixa.data?.caixa ?? null;

  const busca = useQuery({
    queryKey: ['pdv', 'itens', termo, lojaId, tabelaPrecoId],
    queryFn: () => {
      const p = new URLSearchParams({ termo, lojaId });
      if (tabelaPrecoId) p.set('tabelaPrecoId', tabelaPrecoId);
      return pedir<ItemParaVenda[]>(`/vendas/itens?${p.toString()}`);
    },
    enabled: termo.trim().length >= 2 && Boolean(lojaId),
  });

  // Código de barras lido: entra no carrinho e o campo se limpa sozinho, pronto
  // para a próxima leitura. É o ritmo do balcão — uma peça por bipe.
  useEffect(() => {
    const achados = busca.data;
    if (achados?.length === 1 && achados[0]?.casouCodigoBarras) {
      adicionar(achados[0]);
      setTermo('');
    }
    // Depende só do resultado da busca: `adicionar` lê o carrinho pelo
    // atualizador do `setState`, então não precisa entrar aqui.
  }, [busca.data]);

  function adicionar(item: ItemParaVenda) {
    setErro(null);

    if (item.preco === null) {
      setErro(`${item.sku} não tem preço na tabela escolhida.`);
      return;
    }

    setCarrinho((atual) => {
      const existente = atual.find((l) => l.variacaoId === item.variacaoId);

      // Bipar a mesma peça duas vezes soma, não duplica a linha.
      if (existente) {
        return atual.map((l) =>
          l.variacaoId === item.variacaoId ? { ...l, quantidade: l.quantidade + 1 } : l,
        );
      }

      return [
        ...atual,
        {
          variacaoId: item.variacaoId,
          sku: item.sku,
          produto: item.produto,
          descricaoVariacao: item.descricaoVariacao,
          imagemPrincipalId: item.imagemPrincipalId,
          precoTabela: item.preco ?? '0',
          quantidade: 1,
          precoManual: null,
          saldo: Number(item.saldo),
        },
      ];
    });
  }

  function alterar(variacaoId: string, mudanca: Partial<LinhaCarrinho>) {
    setCarrinho((atual) =>
      atual.map((l) => (l.variacaoId === variacaoId ? { ...l, ...mudanca } : l)),
    );
  }

  const totais = useMemo(() => {
    let subtotal = 0;
    for (const l of carrinho) {
      subtotal += l.quantidade * Number(l.precoManual ?? l.precoTabela);
    }
    const abatimento = Number(desconto || 0);
    const total = Math.max(0, subtotal - abatimento);

    let recebido = 0;
    let emDinheiro = 0;
    for (const p of pagamentos) {
      const v = Number(p.valor || 0);
      recebido += v;
      if (p.forma === 'DINHEIRO') emDinheiro += v;
    }

    return {
      subtotal,
      total,
      recebido,
      emDinheiro,
      falta: Math.max(0, total - recebido),
      troco: Math.max(0, recebido - total),
    };
  }, [carrinho, desconto, pagamentos]);

  const finalizar = useMutation({
    mutationFn: () =>
      pedir<ResultadoVenda>('/vendas', {
        method: 'POST',
        body: {
          lojaId,
          ...(tabelaPrecoId ? { tabelaPrecoId } : {}),
          itens: carrinho.map((l) => ({
            variacaoId: l.variacaoId,
            quantidade: String(l.quantidade),
            ...(l.precoManual ? { precoUnitario: l.precoManual } : {}),
          })),
          ...(Number(desconto || 0) > 0 ? { desconto: Number(desconto).toFixed(2) } : {}),
          pagamentos: pagamentos
            .filter((p) => Number(p.valor || 0) > 0)
            .map((p) => ({ forma: p.forma, valor: Number(p.valor).toFixed(2), parcelas: 1 })),
        },
      }),
    onSuccess: async (resultado) => {
      setConcluida(resultado);
      setCarrinho([]);
      setDesconto('');
      setPagamentos([{ chave: 1, forma: 'DINHEIRO', valor: '' }]);
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['estoque'] });
      await fila.invalidateQueries({ queryKey: ['produtos'] });
      // Venda em dinheiro muda o esperado na gaveta. Sem isto, o selo do
      // cabeçalho continuaria mostrando o valor de antes da venda.
      await fila.invalidateQueries({ queryKey: ['caixa'] });
    },
    onError: (e) => {
      setConcluida(null);
      setErro(
        e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir a venda.',
      );
    },
  });

  const podeFinalizar =
    carrinho.length > 0 && totais.falta === 0 && totais.total > 0 && !finalizar.isPending;

  if (contexto.isPending) {
    return <EstadoCarregando titulo="Abrindo o PDV…" />;
  }

  const lojas = contexto.data?.lojas ?? [];
  const tabelas = contexto.data?.tabelas ?? [];
  const podeDarDesconto = contexto.data?.podeDarDesconto ?? false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">PDV</span>

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

        <select
          value={tabelaPrecoId}
          onChange={(e) => setTabelaPrecoId(e.target.value)}
          aria-label="Tabela de preço"
          className="h-[35px] rounded-md border border-neutral-200 bg-white px-2.5 text-[13px]"
        >
          <option value="">Tabela padrão</option>
          {tabelas
            .filter((t) => !t.padrao)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
        </select>

        <div className="flex-1" />

        {lojaId ? (
          caixaAberto ? (
            <Link
              to="/caixa"
              className="flex items-center gap-1.5 rounded-full bg-[var(--color-sucesso-fundo)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--color-sucesso)] no-underline"
              title={`Esperado na gaveta: R$ ${caixaAberto.resumo.esperadoEmCaixa}`}
            >
              <span className="size-1.5 rounded-full bg-current" />
              Caixa {caixaAberto.numero} aberto
            </Link>
          ) : (
            <Link
              to="/caixa"
              className="flex items-center gap-1.5 rounded-full bg-[var(--color-atencao-fundo)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--color-atencao)] no-underline"
              title="Sem caixa aberto, o PDV não recebe em dinheiro"
            >
              <span className="size-1.5 rounded-full bg-current" />
              Caixa fechado
            </Link>
          )
        ) : null}

        {carrinho.length > 0 ? (
          <Botao
            variante="perigo"
            onClick={() => {
              setCarrinho([]);
              setDesconto('');
              setErro(null);
            }}
          >
            Limpar venda
          </Botao>
        ) : null}
      </header>

      {/* No balcão são duas colunas; no celular viram uma pilha que rola.
          Só o layout muda — nenhum passo da venda foi mexido. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-y-hidden">
        {/* Coluna da esquerda: busca e carrinho */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
          <input
            ref={campoBusca}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Leia o código de barras ou digite o nome do produto"
            aria-label="Buscar produto"
            // 48px: alvo de toque para uso sob pressão. DESIGN_SYSTEM.md §6.
            className="h-12 shrink-0 rounded-md border border-neutral-200 bg-white px-4 text-[15px] placeholder:text-neutral-400"
          />

          {busca.data && busca.data.length > 0 && termo.trim().length >= 2 ? (
            <div className="max-h-[220px] shrink-0 overflow-auto rounded-md border border-neutral-100 bg-white shadow-sm">
              {busca.data.map((i) => (
                <button
                  key={i.variacaoId}
                  type="button"
                  onClick={() => {
                    adicionar(i);
                    setTermo('');
                    campoBusca.current?.focus();
                  }}
                  className="flex w-full items-center gap-3 border-b border-neutral-50 px-3 py-2 text-left last:border-0 hover:bg-neutral-25"
                >
                  <span className="size-9 shrink-0 overflow-hidden rounded bg-primary-50">
                    {i.imagemPrincipalId ? (
                      <Foto imagemId={i.imagemPrincipalId} alt={i.produto} className="size-full" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-neutral-900">
                      {i.produto}
                    </span>
                    <span className="block truncate font-mono text-[11.5px] text-neutral-500">
                      {i.sku} · {i.descricaoVariacao}
                    </span>
                  </span>
                  <span
                    className={juntar(
                      'shrink-0 font-mono text-[12px]',
                      Number(i.saldo) <= 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-500',
                    )}
                  >
                    {i.saldo} un
                  </span>
                  <span className="shrink-0 font-mono text-[13.5px] font-medium text-neutral-900">
                    {i.preco ? `R$ ${i.preco}` : 'sem preço'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {concluida ? (
            <Aviso tom="sucesso" titulo={`Venda ${concluida.venda.numero} concluída`}>
              Total de R$ {concluida.venda.total}
              {Number(concluida.venda.troco) > 0 ? ` · troco de R$ ${concluida.venda.troco}` : ''}
              {concluida.avisos.length > 0 ? (
                <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4">
                  {concluida.avisos.map((a) => (
                    <li key={a.codigo + a.mensagem}>{a.mensagem}</li>
                  ))}
                </ul>
              ) : null}
            </Aviso>
          ) : null}

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
            {carrinho.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-8 text-center">
                <p className="text-[14px] font-medium text-neutral-700">Nenhum item</p>
                <p className="text-[13px] text-neutral-500">
                  Leia um código de barras para começar.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                {carrinho.map((l) => (
                  <LinhaItem
                    key={l.variacaoId}
                    linha={l}
                    podeDarDesconto={podeDarDesconto}
                    aoAlterar={(m) => alterar(l.variacaoId, m)}
                    aoRemover={() =>
                      setCarrinho((a) => a.filter((x) => x.variacaoId !== l.variacaoId))
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Coluna da direita: totais e pagamento */}
        <aside className="flex w-full shrink-0 flex-col border-t border-neutral-100 bg-white lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-2 border-b border-neutral-100 p-4 sm:p-5">
            <Linha rotulo="Subtotal" valor={totais.subtotal} />

            {podeDarDesconto ? (
              <label className="flex items-center justify-between gap-3">
                <span className="text-[13.5px] text-neutral-600">Desconto</span>
                <input
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                  placeholder="0,00"
                  aria-label="Desconto na venda"
                  className="h-9 w-[110px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[14px]"
                />
              </label>
            ) : null}

            <div className="mt-1 flex items-baseline justify-between border-t border-neutral-100 pt-3">
              <span className="text-[15px] font-semibold text-neutral-900">Total</span>
              <span className="font-mono text-[26px] font-bold leading-8 text-neutral-900">
                R$ {brl(totais.total)}
              </span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Pagamento
              </h2>
              <button
                type="button"
                onClick={() =>
                  setPagamentos((a) => [
                    ...a,
                    { chave: Math.max(...a.map((p) => p.chave)) + 1, forma: 'PIX', valor: '' },
                  ])
                }
                className="text-[12px] font-medium text-primary-600 underline"
              >
                + outra forma
              </button>
            </div>

            {pagamentos.map((p) => (
              <div key={p.chave} className="flex items-center gap-2">
                <select
                  value={p.forma}
                  onChange={(e) =>
                    setPagamentos((a) =>
                      a.map((x) =>
                        x.chave === p.chave ? { ...x, forma: e.target.value as FormaPagamento } : x,
                      ),
                    )
                  }
                  aria-label="Forma de pagamento"
                  className="h-11 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[14px]"
                >
                  {FORMAS.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>

                <input
                  value={p.valor}
                  onChange={(e) =>
                    setPagamentos((a) =>
                      a.map((x) => (x.chave === p.chave ? { ...x, valor: e.target.value } : x)),
                    )
                  }
                  placeholder="0,00"
                  aria-label={`Valor em ${p.forma}`}
                  className="h-11 w-[110px] rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[15px]"
                />

                {pagamentos.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setPagamentos((a) => a.filter((x) => x.chave !== p.chave))}
                    aria-label="Remover forma de pagamento"
                    className="size-8 shrink-0 rounded-md text-neutral-400 hover:bg-neutral-50"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setPagamentos((a) =>
                  a.map((x, i) => (i === 0 ? { ...x, valor: totais.total.toFixed(2) } : x)),
                )
              }
              className="w-fit text-[12.5px] font-medium text-primary-600 underline"
            >
              valor exato
            </button>

            <div className="mt-1 flex flex-col gap-1 rounded-md bg-neutral-25 p-3">
              <Linha rotulo="Recebido" valor={totais.recebido} />
              {totais.falta > 0 ? (
                <Linha rotulo="Falta" valor={totais.falta} tom="perigo" />
              ) : (
                <Linha
                  rotulo="Troco"
                  valor={totais.troco}
                  tom={totais.troco > 0 ? 'sucesso' : undefined}
                />
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-neutral-100 p-4 sm:p-5">
            <Botao
              variante="primario"
              tamanho="pdv"
              className="w-full"
              disabled={!podeFinalizar}
              carregando={finalizar.isPending}
              onClick={() => finalizar.mutate()}
            >
              Finalizar venda
            </Botao>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  tom,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly tom?: 'perigo' | 'sucesso';
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[13.5px] text-neutral-600">{rotulo}</span>
      <span
        className={juntar(
          'font-mono text-[14px] font-medium',
          tom === 'perigo' && 'text-[var(--color-perigo)]',
          tom === 'sucesso' && 'text-[var(--color-sucesso)]',
          !tom && 'text-neutral-900',
        )}
      >
        R$ {brl(valor)}
      </span>
    </div>
  );
}

function LinhaItem({
  linha,
  podeDarDesconto,
  aoAlterar,
  aoRemover,
}: {
  readonly linha: LinhaCarrinho;
  readonly podeDarDesconto: boolean;
  readonly aoAlterar: (m: Partial<LinhaCarrinho>) => void;
  readonly aoRemover: () => void;
}) {
  const preco = Number(linha.precoManual ?? linha.precoTabela);
  const total = preco * linha.quantidade;
  const excedeSaldo = linha.quantidade > linha.saldo;

  return (
    <div
      className={juntar(
        'flex items-center gap-3 border-b border-neutral-50 px-4 py-2.5',
        excedeSaldo && 'bg-[#fdf5f5]',
      )}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded bg-primary-50">
        {linha.imagemPrincipalId ? (
          <Foto imagemId={linha.imagemPrincipalId} alt={linha.produto} className="size-full" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-neutral-900">{linha.produto}</p>
        <p className="truncate font-mono text-[11.5px] text-neutral-500">
          {linha.sku} · {linha.descricaoVariacao}
        </p>
        {excedeSaldo ? (
          <p className="text-[11.5px] font-medium text-[var(--color-perigo)]">
            {/* Aviso, não bloqueio: a API decide. Quem tem permissão conclui e
                a divergência fica registrada; quem não tem recebe a recusa. */}
            Há {linha.saldo} no balcão — a venda deixará o saldo negativo
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => aoAlterar({ quantidade: Math.max(1, linha.quantidade - 1) })}
          aria-label={`Diminuir ${linha.sku}`}
          className="size-9 rounded-md border border-neutral-200 text-[16px] text-neutral-600 hover:bg-neutral-50"
        >
          −
        </button>
        <input
          value={linha.quantidade}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/\D/g, ''));
            aoAlterar({ quantidade: n > 0 ? n : 1 });
          }}
          aria-label={`Quantidade de ${linha.sku}`}
          className="h-9 w-[52px] rounded-md border border-neutral-200 text-center font-mono text-[14px]"
        />
        <button
          type="button"
          onClick={() => aoAlterar({ quantidade: linha.quantidade + 1 })}
          aria-label={`Aumentar ${linha.sku}`}
          className="size-9 rounded-md border border-neutral-200 text-[16px] text-neutral-600 hover:bg-neutral-50"
        >
          +
        </button>
      </div>

      {podeDarDesconto ? (
        <input
          value={linha.precoManual ?? ''}
          onChange={(e) => aoAlterar({ precoManual: e.target.value || null })}
          placeholder={linha.precoTabela}
          aria-label={`Preço de ${linha.sku}`}
          className={juntar(
            'h-9 w-[92px] shrink-0 rounded-md border px-2 text-right font-mono text-[13.5px]',
            linha.precoManual
              ? 'border-[var(--color-atencao)] bg-[var(--color-atencao-fundo)]'
              : 'border-neutral-200',
          )}
          title={linha.precoManual ? `Preço de tabela: R$ ${linha.precoTabela}` : undefined}
        />
      ) : (
        <span className="w-[92px] shrink-0 text-right font-mono text-[13.5px] text-neutral-600">
          R$ {linha.precoTabela}
        </span>
      )}

      <span className="w-[96px] shrink-0 text-right font-mono text-[14px] font-semibold text-neutral-900">
        R$ {brl(total)}
      </span>

      <button
        type="button"
        onClick={aoRemover}
        aria-label={`Remover ${linha.sku}`}
        className="size-8 shrink-0 rounded-md text-neutral-400 hover:bg-[var(--color-perigo-fundo)] hover:text-[var(--color-perigo)]"
      >
        ✕
      </button>
    </div>
  );
}
