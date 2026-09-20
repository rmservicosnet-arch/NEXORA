import { PERM, type LojaPainel } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { juntar } from '../ui/juntar';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * As lojas e seus locais de estoque.
 *
 * Permissão diz o que você pode fazer; vínculo diz onde — e esta lista
 * mostra só as lojas às quais o seu usuário está vinculado.
 */
export function Lojas() {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [localPadrao, setLocalPadrao] = useState('Balcão');
  /** Vazio = estoque próprio. Preenchido = compartilha o daquela loja. */
  const [compartilharCom, setCompartilharCom] = useState('');
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
  });

  const criar = useMutation({
    mutationFn: () =>
      pedir<{ id: string }>('/lojas', {
        method: 'POST',
        body: compartilharCom
          ? { nome: nome.trim(), compartilharCom }
          : { nome: nome.trim(), localPadrao: localPadrao.trim() || 'Balcão' },
      }),
    onSuccess: async () => {
      setCriando(false);
      setNome('');
      setLocalPadrao('Balcão');
      setCompartilharCom('');
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['lojas'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível abrir a loja.');
    },
  });

  const todas = consulta.data ?? [];
  const inativas = todas.filter((l) => l.status === 'INATIVO').length;
  // Loja desativada continua existindo — mas não é o que se vem ver aqui.
  const lojas = mostrarInativas ? todas : todas.filter((l) => l.status === 'ATIVO');
  const podeCriar = pode(PERM.loja.criar);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Lojas</span>
        <div className="flex-1" />
        {podeCriar && !criando ? (
          <Botao variante="primario" onClick={() => setCriando(true)}>
            <Mais />
            Nova loja
          </Botao>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">Lojas</h1>
            <p className="mt-0.5 text-[13.5px] text-neutral-500">
              {lojas.length} {lojas.length === 1 ? 'loja' : 'lojas'} · você vê apenas aquelas às
              quais tem vínculo · permissão diz o que você pode fazer, vínculo diz onde
            </p>
          </div>

          {inativas > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-neutral-600">
              <input
                type="checkbox"
                checked={mostrarInativas}
                onChange={(e) => setMostrarInativas(e.target.checked)}
                className="size-3.5"
              />
              Mostrar {inativas} {inativas === 1 ? 'desativada' : 'desativadas'}
            </label>
          ) : null}
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível abrir a loja">
            {erro}
          </Aviso>
        ) : null}

        {criando ? (
          <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <Campo
              rotulo="Nome da loja"
              value={nome}
              autoFocus
              onChange={(e) => setNome(e.target.value)}
              placeholder="Loja Shopping"
              ajuda="O código sai do nome: Loja Shopping vira LOJA_SHOPPING."
              className="max-w-[420px]"
            />

            {/*
              Estoque próprio ou compartilhado é decisão de quem abre a loja.
              Compartilhar não copia nem transfere nada: a mercadoria continua
              onde está, e as duas lojas vendem do mesmo lugar.
            */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={compartilharCom === ''}
                onClick={() => setCompartilharCom('')}
                className={juntar(
                  'rounded-lg border p-3.5 text-left',
                  compartilharCom === ''
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-neutral-200 bg-white hover:bg-neutral-25',
                )}
              >
                <span className="block text-[13.5px] font-semibold text-neutral-900">
                  Estoque próprio
                </span>
                <span className="mt-1 block text-[12px] leading-[17px] text-neutral-500">
                  A loja nasce com um local seu, e o saldo dela é dela.
                </span>
              </button>

              <button
                type="button"
                aria-pressed={compartilharCom !== ''}
                disabled={lojas.length === 0}
                onClick={() => setCompartilharCom(lojas[0]?.id ?? '')}
                className={juntar(
                  'rounded-lg border p-3.5 text-left disabled:opacity-60',
                  compartilharCom !== ''
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-neutral-200 bg-white hover:bg-neutral-25',
                )}
              >
                <span className="block text-[13.5px] font-semibold text-neutral-900">
                  Estoque compartilhado
                </span>
                <span className="mt-1 block text-[12px] leading-[17px] text-neutral-500">
                  Vende do estoque de outra loja. Nada é transferido.
                </span>
              </button>
            </div>

            {compartilharCom === '' ? (
              <Campo
                rotulo="Local padrão de venda"
                value={localPadrao}
                onChange={(e) => setLocalPadrao(e.target.value)}
                placeholder="Balcão"
                ajuda="Nasce junto com a loja: é dele que o PDV baixa o estoque."
                className="max-w-[420px]"
              />
            ) : (
              <label className="flex max-w-[420px] flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                  Vende do estoque de
                </span>
                <select
                  value={compartilharCom}
                  onChange={(e) => setCompartilharCom(e.target.value)}
                  className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
                >
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-neutral-500">
                  O PDV da loja nova baixa do local de venda desta aqui. O saldo é o mesmo para as
                  duas — vender numa reduz o da outra.
                </span>
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              <Botao
                variante="primario"
                carregando={criar.isPending}
                disabled={nome.trim().length < 2}
                onClick={() => {
                  setErro(null);
                  criar.mutate();
                }}
              >
                Abrir loja
              </Botao>
              <Botao variante="secundario" onClick={() => setCriando(false)}>
                Cancelar
              </Botao>
            </div>

            <p className="text-[12px] text-neutral-500">
              Abrir a loja não vincula você a ela: vínculo é outra decisão, e é o que diz quem opera
              onde.
            </p>
          </section>
        ) : null}

        {consulta.isPending ? <EstadoCarregando titulo="Carregando lojas…" /> : null}

        {consulta.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar as lojas"
            descricao={
              consulta.error instanceof ErroRequisicao
                ? consulta.error.corpo.mensagem
                : 'Verifique se a API está no ar.'
            }
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {consulta.isSuccess && lojas.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma loja vinculada"
            descricao="Peça ao administrador da empresa para vincular seu usuário a uma loja."
          />
        ) : null}

        {lojas.length > 0 ? (
          <div className="grid min-h-0 flex-1 auto-rows-[320px] content-start gap-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
            {lojas.map((l) => (
              <CartaoLoja key={l.id} loja={l} />
            ))}
          </div>
        ) : null}

        <div className="flex shrink-0 items-start gap-2.5 rounded-md border border-primary-100 bg-primary-50 px-3.5 py-3">
          <span className="shrink-0 text-primary-600">
            <Informacao />
          </span>
          <span className="text-[12.5px] leading-[18px] text-primary-800">
            Cada loja tem um local padrão de venda: é dele que o PDV baixa o estoque. Ele pode ser
            próprio ou compartilhado com outra loja — compartilhado, o saldo é o mesmo para as duas,
            e vender numa reduz o da outra.
          </span>
        </div>
      </main>
    </>
  );
}

function CartaoLoja({ loja }: { readonly loja: LojaPainel }) {
  const semPadrao = !loja.locais.some((o) => o.padraoVenda);

  return (
    <section
      className={juntar(
        'flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm',
        loja.variacoesNegativas > 0 ? 'border-[#f0c9cb]' : 'border-neutral-100',
        loja.status === 'INATIVO' && 'opacity-60',
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-neutral-100 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
          <Casa />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold text-neutral-900">
            {loja.nome}
          </p>
          <p className="font-mono text-[11px] text-neutral-400">
            {loja.codigo}
            {loja.status === 'INATIVO' ? ' · desativada' : ''}
          </p>
        </div>
        <span
          className={juntar(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            loja.caixaAberto !== null
              ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
              : 'bg-neutral-50 text-neutral-500',
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {loja.caixaAberto !== null ? `Caixa ${loja.caixaAberto} aberto` : 'Caixa fechado'}
        </span>
      </div>

      <div className="flex shrink-0 gap-3 border-b border-neutral-50 px-4 py-3">
        <div className="flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-400">
            Vendas hoje
          </p>
          <p className="mt-0.5 font-mono text-[17px] font-medium text-neutral-900">
            R$ {brl(loja.vendasHoje)}
          </p>
        </div>
        <div className="flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-400">
            Saldo negativo
          </p>
          <p
            className={juntar(
              'mt-0.5 font-mono text-[17px] font-medium',
              loja.variacoesNegativas > 0
                ? 'text-[var(--color-perigo)]'
                : 'text-[var(--color-sucesso)]',
            )}
          >
            {loja.variacoesNegativas === 0 ? 'nenhum' : loja.variacoesNegativas}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-400">
          Locais de estoque
        </p>

        {loja.locais.length === 0 ? (
          <p className="text-[12.5px] text-neutral-400">Nenhum local cadastrado.</p>
        ) : (
          loja.locais.map((o) => (
            <div key={o.id} className="flex items-center gap-2 py-1">
              <span className="shrink-0 text-neutral-400">
                <Cubo />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700">
                {o.nome}
              </span>
              {o.compartilhado ? (
                <span
                  className="shrink-0 rounded-full bg-[var(--color-atencao-fundo)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-atencao)]"
                  title={`Local da ${o.dono ?? 'outra loja'}`}
                >
                  de {o.dono ?? 'outra loja'}
                </span>
              ) : null}
              {o.padraoVenda ? (
                <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                  venda
                </span>
              ) : null}
              <span className="shrink-0 font-mono text-[11.5px] text-neutral-500">
                {o.itens} {o.itens === 1 ? 'item' : 'itens'}
              </span>
            </div>
          ))
        )}

        {/*
          Sem local padrão de venda o PDV não sabe de onde baixar — e o erro
          só apareceria no balcão, com o cliente esperando.
        */}
        {semPadrao ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-[var(--color-perigo-fundo)] px-2 py-1 text-[11.5px] font-semibold text-[var(--color-perigo)]">
            <Alerta />
            Sem local padrão de venda — o PDV não vende nesta loja
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-neutral-100 bg-neutral-25 px-4 py-3">
        <Link
          to="/estoque"
          className="flex h-8 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white text-[12.5px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
        >
          Estoque
        </Link>
        <Link
          to="/caixa"
          className="flex h-8 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white text-[12.5px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
        >
          Caixa
        </Link>
        <Link
          to="/"
          className="flex h-8 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white text-[12.5px] font-medium text-primary-600 no-underline hover:bg-neutral-50"
        >
          Números
        </Link>
      </div>
    </section>
  );
}

function Mais() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function Casa() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function Cubo() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
    </svg>
  );
}

function Informacao() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function Alerta() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}
