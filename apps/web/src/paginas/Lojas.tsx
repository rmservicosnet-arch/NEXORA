import type { LojaPainel } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
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
  const consulta = useQuery({
    queryKey: ['lojas', 'painel'],
    queryFn: () => pedir<LojaPainel[]>('/lojas/painel'),
  });

  const lojas = consulta.data ?? [];

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Lojas</span>
        <div className="flex-1" />
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-4 sm:p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">Lojas</h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            {lojas.length} {lojas.length === 1 ? 'loja' : 'lojas'} · você vê apenas aquelas às quais
            tem vínculo · permissão diz o que você pode fazer, vínculo diz onde
          </p>
        </div>

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
            Cada loja tem um local padrão de venda: é dele que o PDV baixa o estoque. Sem esse
            local, a venda não sabe de onde tirar a mercadoria.
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
          <p className="font-mono text-[11px] text-neutral-400">{loja.codigo}</p>
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
