import { PERM, type PrecosDoProduto as Precos } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { juntar } from '../ui/juntar';

/** Chave de uma célula: uma variação numa tabela. */
function celula(variacaoId: string, tabelaId: string): string {
  return `${variacaoId}|${tabelaId}`;
}

/**
 * Os preços do produto em cada tabela.
 *
 * A API existia desde a fatia do portal e nenhuma tela a usava — o mesmo
 * defeito de `cliente.tabelaPrecoId`: o sistema lia um dado que ninguém
 * conseguia gravar. Sem preço na tabela do cliente, o item simplesmente não
 * existe para ele: o catálogo o omite, não mostra "consulte".
 */
export function PrecosDoProduto({ produtoId }: { readonly produtoId: string }) {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const podeVer = pode(PERM.preco.visualizar);
  const podeEditar = pode(PERM.preco.editar);

  const consulta = useQuery({
    queryKey: ['produtos', produtoId, 'precos'],
    queryFn: () => pedir<Precos>(`/produtos/${produtoId}/precos`),
    enabled: podeVer,
  });

  // O formulário nasce do servidor. String vazia é "sem preço nesta tabela",
  // que é diferente de zero — zero seria um item de graça.
  useEffect(() => {
    if (!consulta.data) return;
    const inicial: Record<string, string> = {};
    for (const v of consulta.data.variacoes) {
      for (const p of v.precos) {
        inicial[celula(v.variacaoId, p.tabelaPrecoId)] = p.preco ?? '';
      }
    }
    setValores(inicial);
  }, [consulta.data]);

  const salvar = useMutation({
    mutationFn: () => {
      const precos: { variacaoId: string; tabelaPrecoId: string; preco: string | null }[] = [];

      for (const v of consulta.data?.variacoes ?? []) {
        for (const p of v.precos) {
          const bruto = (valores[celula(v.variacaoId, p.tabelaPrecoId)] ?? '').trim();
          const novo = bruto === '' ? null : bruto.replace(',', '.');
          // Só o que mudou: mandar a grade inteira escreveria histórico de
          // preço para células que ninguém tocou.
          if (novo !== (p.preco ?? null)) {
            precos.push({ variacaoId: v.variacaoId, tabelaPrecoId: p.tabelaPrecoId, preco: novo });
          }
        }
      }

      if (precos.length === 0) {
        return Promise.resolve(null);
      }

      return pedir<Precos>(`/produtos/${produtoId}/precos`, { method: 'PUT', body: { precos } });
    },
    onSuccess: async () => {
      setErro(null);
      setSalvo(true);
      await fila.invalidateQueries({ queryKey: ['produtos'] });
    },
    onError: (e) => {
      setSalvo(false);
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  if (!podeVer) {
    return null;
  }

  const dados = consulta.data;
  const tabelas = dados?.variacoes[0]?.precos ?? [];

  const semPreco = tabelas.filter((t) =>
    (dados?.variacoes ?? []).every((v) => !valores[celula(v.variacaoId, t.tabelaPrecoId)]),
  );

  return (
    <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">
          Preço por tabela
        </h2>
        <Link
          to="/tabelas-preco"
          className="text-[12px] text-neutral-500 underline decoration-neutral-300 underline-offset-2"
        >
          Gerenciar tabelas
        </Link>
      </div>

      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível salvar">
          {erro}
        </Aviso>
      ) : null}
      {salvo ? <Aviso tom="sucesso">Preços atualizados.</Aviso> : null}

      {/*
        Vazio não é zero. Sem preço na tabela do cliente, o item não aparece
        no catálogo dele — não aparece "consulte", não aparece nada. É o
        efeito mais silencioso do cadastro inteiro.
      */}
      {semPreco.length > 0 ? (
        <Aviso tom="atencao">
          Sem preço em {semPreco.map((t) => t.tabela).join(', ')}. Quem compra por{' '}
          {semPreco.length === 1 ? 'essa tabela' : 'essas tabelas'} não vê este produto no catálogo.
        </Aviso>
      ) : null}

      {dados ? (
        <div className="flex flex-col gap-3">
          {dados.variacoes.map((v) => (
            <div key={v.variacaoId} className="flex flex-col gap-2">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13.5px] text-neutral-900">{v.descricao}</span>
                <span className="font-mono text-[11px] text-neutral-400">{v.sku}</span>
              </p>

              <div className="flex flex-wrap gap-2">
                {v.precos.map((p) => {
                  const chave = celula(v.variacaoId, p.tabelaPrecoId);
                  const vazio = !valores[chave];

                  return (
                    <label key={p.tabelaPrecoId} className="flex flex-col gap-1">
                      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                        {p.tabela}
                        {p.padrao ? (
                          <span className="rounded bg-primary-50 px-1 py-px text-[9.5px] text-primary-700">
                            padrão
                          </span>
                        ) : null}
                      </span>
                      <div className="flex items-center">
                        <span className="rounded-l-md border border-r-0 border-neutral-200 bg-neutral-25 px-2 py-2 text-[12px] text-neutral-500">
                          R$
                        </span>
                        <input
                          value={valores[chave] ?? ''}
                          disabled={!podeEditar}
                          inputMode="decimal"
                          aria-label={`${p.tabela} · ${v.sku}`}
                          placeholder="sem preço"
                          onChange={(e) => {
                            setSalvo(false);
                            setValores((a) => ({
                              ...a,
                              [chave]: e.target.value.replace(/[^\d.,]/g, ''),
                            }));
                          }}
                          className={juntar(
                            'h-[38px] w-[104px] rounded-r-md border px-2 text-right font-mono text-[13.5px]',
                            vazio
                              ? 'border-[var(--color-atencao)] bg-[var(--color-atencao-fundo)]'
                              : 'border-neutral-200',
                          )}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {podeEditar ? (
        <div className="flex flex-wrap items-center gap-3">
          <Botao variante="primario" carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar preços
          </Botao>
          <span className="text-[12px] text-neutral-500">
            Apagar o campo remove o preço — e o item some do catálogo de quem usa a tabela.
          </span>
        </div>
      ) : (
        <Aviso tom="info">
          Você pode ver os preços, mas não alterá-los. Falta a permissão
          <span className="font-mono"> preco.editar</span>.
        </Aviso>
      )}
    </section>
  );
}
