import type { CatalogoPortal, ExtratoCarteira, ResultadoCheckout } from '@estoque/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { useCarrinho, type ItemCarrinho } from '../../portal/carrinho';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { EstadoVazio } from '../../ui/Estados';
import { Foto } from '../../ui/Foto';
import { juntar } from '../../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

/** A mesma grade no cabeçalho e em cada linha. Uma declaração, não duas. */
const GRADE =
  'lg:grid lg:grid-cols-[64px_minmax(0,1fr)_112px_128px_112px_44px] lg:items-center lg:gap-3.5';

export function PortalCarrinho() {
  const { itens, definirQuantidade, remover, esvaziar } = useCarrinho();
  const navegar = useNavigate();
  const fila = useQueryClient();

  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoEsvaziar, setConfirmandoEsvaziar] = useState(false);

  /**
   * Relê cada item do servidor.
   *
   * O carrinho guardou o preço e a disponibilidade de quando o item foi
   * escolhido — e ele sobrevive a dias no `localStorage`. Decidir por aquele
   * retrato é a armadilha "guardar o item buscado e reusar a foto dele" da
   * tabela do CLAUDE.md: aqui ela faria o cliente montar o pedido por um
   * preço que a loja não pratica mais.
   */
  const frescos = useQueries({
    queries: itens.map((item) => ({
      queryKey: ['portal', 'catalogo', item.sku],
      queryFn: () =>
        pedir<CatalogoPortal>(
          `/portal/pedidos/catalogo?limite=60&termo=${encodeURIComponent(item.sku)}`,
        ),
      staleTime: 30_000,
    })),
  });

  const linhas = itens.map((item, i) => {
    const consulta = frescos[i];
    const atual = consulta?.data?.itens.find((c) => c.variacaoId === item.variacaoId) ?? null;
    return {
      item,
      atual,
      carregando: consulta?.isPending ?? false,
      // Nulo quando o servidor não devolveu o item: ele saiu do catálogo ou
      // perdeu o preço na tabela deste cliente.
      preco: atual?.preco ?? null,
      disponivel: atual?.disponivel ?? null,
      mudouDePreco: Boolean(atual && atual.preco !== item.precoVisto),
    };
  });

  const tabela = frescos.find((c) => c.data)?.data?.tabela ?? null;
  const sumidos = linhas.filter((l) => !l.carregando && !l.atual);
  const total = linhas.reduce(
    (soma, l) => soma + Number(l.preco ?? l.item.precoVisto) * l.item.quantidade,
    0,
  );

  /**
   * O saldo entra na decisão de enviar.
   *
   * Saldo negativo é o que o cliente deve à loja — a convenção não se inverte
   * em camada nenhuma. Descobrir isso só no faturamento é o que vira
   * telefonema. Cliente sem carteira não vê bloco nenhum, em vez de ver zero.
   */
  const carteira = useQuery({
    queryKey: ['portal', 'carteira'],
    queryFn: () => pedir<ExtratoCarteira>('/portal/carteira?limite=1'),
    retry: false,
  });

  const enviar = useMutation({
    mutationFn: () =>
      pedir<ResultadoCheckout>('/portal/pedidos', {
        method: 'POST',
        body: {
          itens: itens.map((i) => ({
            variacaoId: i.variacaoId,
            quantidade: String(i.quantidade),
          })),
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        },
      }),
    onSuccess: (resultado) => {
      esvaziar();
      void fila.invalidateQueries({ queryKey: ['portal', 'pedidos'] });

      // O checkout produz PEDIDO ou VENDA conforme o `modoCheckout` da loja.
      // São desfechos diferentes e a tela não pode tratar os dois igual: num
      // o cliente espera confirmação, no outro ele já comprou.
      if (resultado.tipo === 'PEDIDO' && resultado.pedido) {
        void navegar(`/portal/pedidos/${resultado.pedido.id}`, {
          state: { mensagem: resultado.mensagem },
        });
      } else {
        void navegar('/portal/pedidos', { state: { mensagem: resultado.mensagem } });
      }
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível enviar.');
    },
  });

  if (itens.length === 0) {
    return (
      <EstadoVazio
        titulo="Carrinho vazio"
        descricao="Escolha itens no catálogo para montar seu pedido."
        acao={
          <Botao variante="primario" onClick={() => void navegar('/portal')}>
            Ver catálogo
          </Botao>
        }
      />
    );
  }

  const unidades = itens.reduce((soma, i) => soma + i.quantidade, 0);

  return (
    <>
      <div className="flex flex-col gap-[3px]">
        <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">Carrinho</h1>
        <p className="text-[13.5px] text-neutral-500">
          {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          {tabela ? (
            <>
              {' '}
              · preços da sua tabela{' '}
              <strong className="font-semibold text-neutral-900">{tabela}</strong>
            </>
          ) : null}
        </p>
      </div>

      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível enviar">
          {erro}
        </Aviso>
      ) : null}

      {sumidos.length > 0 ? (
        <Aviso tom="atencao" titulo="Itens que saíram do seu catálogo">
          {sumidos.map((l) => l.item.produto).join(', ')} — remova antes de enviar, ou fale com a
          loja.
        </Aviso>
      ) : null}

      {/*
        Itens à esquerda, resumo à direita — e empilhados no celular, que é
        onde o cliente monta o pedido. Numa coluna só, o total e o botão
        ficavam depois de rolar a lista inteira.
      */}
      <div className="flex flex-col items-start gap-[18px] lg:flex-row">
        <section className="w-full min-w-0 flex-1 overflow-hidden rounded-lg border border-neutral-100 bg-white">
          <div
            className={juntar(
              'hidden border-b border-neutral-100 bg-neutral-50 px-4 py-2.5',
              GRADE,
            )}
          >
            <span />
            <Coluna>Item</Coluna>
            <Coluna alinhamento="right">Unitário</Coluna>
            <Coluna alinhamento="center">Quantidade</Coluna>
            <Coluna alinhamento="right">Total</Coluna>
            <span />
          </div>

          {linhas.map(({ item, atual, preco, disponivel, mudouDePreco }) => (
            <Linha
              key={item.variacaoId}
              item={item}
              preco={preco}
              disponivel={disponivel}
              mudouDePreco={mudouDePreco}
              sumiu={!atual}
              aoMudar={(q) => definirQuantidade(item.variacaoId, q)}
              aoRemover={() => remover(item.variacaoId)}
            />
          ))}

          <div className="flex items-center gap-2.5 border-t border-neutral-100 px-4 py-3">
            <Link to="/portal" className="text-[12.5px] font-medium">
              ← Continuar escolhendo
            </Link>
            <span className="flex-1" />
            {/*
              Dois toques para esvaziar: o carrinho pode ter vinte linhas
              montadas ao longo de dias, e um toque errado ao lado do "Enviar"
              apagaria tudo sem volta.
            */}
            <button
              type="button"
              onClick={() => {
                if (confirmandoEsvaziar) {
                  esvaziar();
                  setConfirmandoEsvaziar(false);
                } else {
                  setConfirmandoEsvaziar(true);
                }
              }}
              onBlur={() => setConfirmandoEsvaziar(false)}
              className={juntar(
                'h-8 rounded-md border px-3 text-[12.5px]',
                confirmandoEsvaziar
                  ? 'border-[var(--color-perigo)] font-semibold text-[var(--color-perigo)]'
                  : 'border-neutral-100 text-neutral-500 hover:border-neutral-200',
              )}
            >
              {confirmandoEsvaziar ? 'Esvaziar mesmo?' : 'Esvaziar carrinho'}
            </button>
          </div>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[368px]">
          <section className="rounded-lg border border-neutral-100 bg-white p-4">
            <h2 className="font-display text-[14px] font-semibold text-neutral-900">Resumo</h2>

            <div className="mt-3 flex items-baseline justify-between pb-[9px]">
              <span className="text-[13px] text-neutral-500">
                {unidades} {unidades === 1 ? 'unidade' : 'unidades'} em {itens.length}{' '}
                {itens.length === 1 ? 'item' : 'itens'}
              </span>
              <span className="font-mono text-[13.5px] text-neutral-700">R$ {brl(total)}</span>
            </div>

            <div className="flex items-center justify-between border-t-2 border-neutral-900 pt-[11px]">
              <span className="font-display text-[15px] font-bold text-neutral-900">
                Total do pedido
              </span>
              <span className="font-display text-[26px] font-bold leading-8 text-neutral-900">
                R$ {brl(total)}
              </span>
            </div>

            {/*
              O prazo do congelamento sai da configuração da loja e só existe
              depois que o pedido nasce: escrever uma data aqui seria inventar
              uma que ninguém gravou. O que é verdade agora é QUANDO congela.
            */}
            <p className="mt-2.5 text-[11.5px] leading-4 text-neutral-500">
              O preço é{' '}
              <strong className="font-semibold text-neutral-700">congelado no envio</strong>. Depois
              disso, mudança na tabela não reescreve o seu pedido.
            </p>
          </section>

          <section className="rounded-lg border border-neutral-100 bg-white p-4">
            <label
              htmlFor="observacao-pedido"
              className="block text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-500"
            >
              Observação para a loja
            </label>
            <textarea
              id="observacao-pedido"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="Prazo, tamanho alternativo, quem retira…"
              className="mt-[7px] w-full resize-none rounded-lg border border-neutral-200 px-2.5 py-[9px] text-[12.5px]"
            />

            <div className="mt-3">
              <Botao
                variante="primario"
                tamanho="pdv"
                carregando={enviar.isPending}
                disabled={sumidos.length > 0}
                onClick={() => {
                  setErro(null);
                  enviar.mutate();
                }}
              >
                Enviar pedido
              </Botao>
            </div>

            {/*
              Dizer o que vai acontecer ANTES de acontecer. O pedido não reserva
              estoque e o valor pode mudar na confirmação — descobrir isso
              depois é o que vira telefonema.
            */}
            <p className="mt-2.5 flex gap-[7px] text-[11.5px] leading-4 text-neutral-500">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                className="mt-px shrink-0 text-neutral-400"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
              <span>
                Enviar{' '}
                <strong className="font-semibold text-neutral-700">não reserva estoque</strong>. A
                loja confere item a item e pode confirmar em parte — você vê o que foi atendido
                antes de qualquer cobrança.
              </span>
            </p>
          </section>

          {carteira.data ? (
            <section className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-[13px]">
              <p className="text-[12px] font-semibold text-neutral-700">Sua carteira</p>
              <div className="mt-[5px] flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-neutral-500">Saldo</span>
                <span
                  className={juntar(
                    'font-mono text-[15px] font-medium',
                    Number(carteira.data.carteira.saldo) < 0
                      ? 'text-[var(--color-perigo)]'
                      : 'text-[var(--color-sucesso)]',
                  )}
                >
                  {Number(carteira.data.carteira.saldo) < 0 ? '− ' : ''}R${' '}
                  {brl(Math.abs(Number(carteira.data.carteira.saldo)))}
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-4 text-neutral-500">
                {Number(carteira.data.carteira.saldo) < 0
                  ? 'Saldo negativo é o que você deve à loja. O pagamento é combinado com ela no faturamento.'
                  : 'Saldo positivo é crédito seu na loja.'}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Coluna({
  children,
  alinhamento,
}: {
  readonly children: React.ReactNode;
  readonly alinhamento?: 'right' | 'center';
}) {
  return (
    <span
      className={juntar(
        'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-neutral-500',
        alinhamento === 'right' && 'text-right',
        alinhamento === 'center' && 'text-center',
      )}
    >
      {children}
    </span>
  );
}

function SemFotoMini() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-neutral-300"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-4 4 3 3-2 6 5" />
      <circle cx="8.5" cy="9.5" r="1.4" />
    </svg>
  );
}

function Linha({
  item,
  preco,
  disponivel,
  mudouDePreco,
  sumiu,
  aoMudar,
  aoRemover,
}: {
  readonly item: ItemCarrinho;
  readonly preco: string | null;
  /** Nulo enquanto o servidor nao respondeu. */
  readonly disponivel: boolean | null;
  readonly mudouDePreco: boolean;
  readonly sumiu: boolean;
  readonly aoMudar: (q: number) => void;
  readonly aoRemover: () => void;
}) {
  const unitario = Number(preco ?? item.precoVisto);

  return (
    <div
      className={juntar(
        /*
          No celular uma grade de tres colunas e duas linhas: foto a esquerda
          ocupando as duas, item e lixeira em cima, quantidade e total embaixo.
          Com `flex-wrap` o bloco do item tinha `flex-1 min-w-0` e ENCOLHIA em
          vez de empurrar os controles para a linha de baixo — o nome do
          produto virava uma letra so.
        */
        'grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-neutral-50 px-4 py-3 last:border-0',
        GRADE,
        sumiu && 'opacity-60',
      )}
    >
      <span className="col-start-1 row-span-2 row-start-1 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-50 lg:col-start-auto lg:row-span-1 lg:row-start-auto">
        {item.imagemPrincipalId ? (
          <Foto
            imagemId={item.imagemPrincipalId}
            alt={item.produto}
            raiz="/portal/midia"
            className="size-full"
            // Foto quebrada e problema da loja, e ela ve isso nas telas dela.
            seFalhar={<SemFotoMini />}
          />
        ) : (
          <SemFotoMini />
        )}
      </span>

      <div className="col-start-2 row-start-1 min-w-0 lg:col-start-auto lg:row-start-auto">
        <p className="truncate text-[13.5px] text-neutral-900">
          {item.produto} <span className="text-neutral-500">· {item.descricaoVariacao}</span>
        </p>
        <p className="mt-0.5 truncate font-mono text-[10.5px] text-neutral-400">{item.sku}</p>

        {/*
          Disponibilidade por linha, relida do servidor: o carrinho sobrevive
          dias no navegador, e "pronta entrega" de três dias atrás não diz
          nada sobre hoje.

          "Sob encomenda" não é selo, é frase com ícone: o cliente precisa
          saber que aquele item depende de um prazo que a loja ainda vai dar.
        */}
        {disponivel === true ? (
          <span className="mt-1 inline-block rounded-full bg-[var(--color-sucesso-fundo)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-sucesso)]">
            pronta entrega
          </span>
        ) : null}
        {disponivel === false ? (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-atencao)]">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4.5" />
              <path d="M12 16h.01" />
            </svg>
            sob encomenda — a loja confirma o prazo
          </p>
        ) : null}

        {mudouDePreco ? (
          <p className="text-[11px] font-medium text-[var(--color-atencao)]">
            preço atualizado: era R$ {brl(item.precoVisto)}
          </p>
        ) : null}
        {sumiu ? (
          <p className="text-[11px] font-medium text-[var(--color-perigo)]">
            não está mais no seu catálogo
          </p>
        ) : null}

        {/* No celular não há coluna de unitário; o preço mora com o item. */}
        <p className="mt-1 font-mono text-[12px] text-neutral-700 lg:hidden">
          R$ {brl(unitario)} cada
        </p>
      </div>

      <span className="hidden font-mono text-[12.5px] text-neutral-700 lg:block lg:text-right">
        R$ {brl(unitario)}
      </span>

      <span className="col-start-2 row-start-2 inline-flex w-fit items-center overflow-hidden rounded-lg border border-neutral-200 lg:col-start-auto lg:row-start-auto lg:justify-self-center">
        <button
          type="button"
          aria-label={`Diminuir ${item.sku}`}
          onClick={() => aoMudar(item.quantidade - 1)}
          className="flex h-8 w-[30px] items-center justify-center text-[15px] text-neutral-600 hover:bg-neutral-50"
        >
          −
        </button>
        <input
          value={item.quantidade}
          onChange={(e) => aoMudar(Number(e.target.value.replace(/\D/g, '')) || 0)}
          aria-label={`Quantidade de ${item.sku}`}
          className="h-8 w-[34px] border-x border-neutral-200 text-center font-mono text-[13px]"
        />
        <button
          type="button"
          aria-label={`Aumentar ${item.sku}`}
          onClick={() => aoMudar(item.quantidade + 1)}
          className="flex h-8 w-[30px] items-center justify-center text-[15px] text-neutral-600 hover:bg-neutral-50"
        >
          +
        </button>
      </span>

      <span className="col-start-3 row-start-2 text-right font-mono text-[13.5px] font-medium text-neutral-900 lg:col-start-auto lg:row-start-auto">
        R$ {brl(unitario * item.quantidade)}
      </span>

      <button
        type="button"
        onClick={aoRemover}
        aria-label={`Remover ${item.produto} do carrinho`}
        className="col-start-3 row-start-1 flex size-8 items-center justify-center justify-self-end rounded-lg border border-neutral-100 hover:border-[var(--color-perigo)] lg:col-start-auto lg:row-start-auto"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-perigo)"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M6 7l1 12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8L18 7" />
          <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
        </svg>
      </button>
    </div>
  );
}
