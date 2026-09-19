import type { ItemCatalogo, ResultadoCheckout } from '@estoque/contracts';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

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

export function PortalCarrinho() {
  const { itens, definirQuantidade, remover, esvaziar } = useCarrinho();
  const navegar = useNavigate();
  const fila = useQueryClient();

  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

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
        pedir<ItemCatalogo[]>(
          `/portal/pedidos/catalogo?limite=60&termo=${encodeURIComponent(item.sku)}`,
        ),
      staleTime: 30_000,
    })),
  });

  const linhas = itens.map((item, i) => {
    const consulta = frescos[i];
    const atual = consulta?.data?.find((c) => c.variacaoId === item.variacaoId) ?? null;
    return {
      item,
      atual,
      carregando: consulta?.isPending ?? false,
      // Nulo quando o servidor não devolveu o item: ele saiu do catálogo ou
      // perdeu o preço na tabela deste cliente.
      preco: atual?.preco ?? null,
      mudouDePreco: Boolean(atual && atual.preco !== item.precoVisto),
    };
  });

  const sumidos = linhas.filter((l) => !l.carregando && !l.atual);
  const total = linhas.reduce(
    (soma, l) => soma + Number(l.preco ?? l.item.precoVisto) * l.item.quantidade,
    0,
  );

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

  return (
    <>
      <h1 className="font-display text-[22px] font-bold text-neutral-900">Carrinho</h1>

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

      <section className="flex flex-col rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
        {linhas.map(({ item, atual, preco, mudouDePreco }) => (
          <Linha
            key={item.variacaoId}
            item={item}
            preco={preco}
            mudouDePreco={mudouDePreco}
            sumiu={!atual}
            aoMudar={(q) => definirQuantidade(item.variacaoId, q)}
            aoRemover={() => remover(item.variacaoId)}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Observação para a loja
          </span>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="Prazo, quem vai retirar, o que for útil"
            className="rounded-md border border-neutral-200 px-3 py-2 text-[13.5px]"
          />
        </label>

        <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
          <span className="text-[13px] text-neutral-500">Total</span>
          <span className="font-mono text-[19px] font-semibold text-neutral-900">
            R$ {brl(total)}
          </span>
        </div>

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

        {/*
          Dizer o que vai acontecer ANTES de acontecer. O pedido não reserva
          estoque e o valor pode mudar na confirmação — descobrir isso depois é
          o que vira telefonema.
        */}
        <p className="text-center text-[12px] leading-[18px] text-neutral-500">
          A loja confere item a item e confirma. Se o valor subir, você decide se aceita antes de
          qualquer cobrança.
        </p>
      </section>
    </>
  );
}

function Linha({
  item,
  preco,
  mudouDePreco,
  sumiu,
  aoMudar,
  aoRemover,
}: {
  readonly item: ItemCarrinho;
  readonly preco: string | null;
  readonly mudouDePreco: boolean;
  readonly sumiu: boolean;
  readonly aoMudar: (q: number) => void;
  readonly aoRemover: () => void;
}) {
  const unitario = Number(preco ?? item.precoVisto);

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-3 border-b border-neutral-50 py-3 last:border-0',
        sumiu && 'opacity-60',
      )}
    >
      <div className="size-12 shrink-0 overflow-hidden rounded bg-primary-50">
        {item.imagemPrincipalId ? (
          <Foto
            imagemId={item.imagemPrincipalId}
            alt={item.produto}
            raiz="/portal/midia"
            className="size-full"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-neutral-900">{item.produto}</p>
        <p className="truncate text-[11.5px] text-neutral-500">{item.descricaoVariacao}</p>
        {mudouDePreco ? (
          <p className="text-[11.5px] font-medium text-[--color-atencao]">
            preço atualizado: era R$ {brl(item.precoVisto)}
          </p>
        ) : null}
        {sumiu ? (
          <p className="text-[11.5px] font-medium text-[--color-perigo]">
            não está mais no seu catálogo
          </p>
        ) : null}
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <div className="flex items-center rounded-md border border-neutral-200">
          <button
            type="button"
            aria-label={`Diminuir ${item.sku}`}
            onClick={() => aoMudar(item.quantidade - 1)}
            className="flex size-9 items-center justify-center text-neutral-600 hover:bg-neutral-50"
          >
            −
          </button>
          <input
            value={item.quantidade}
            onChange={(e) => aoMudar(Number(e.target.value.replace(/\D/g, '')) || 0)}
            aria-label={`Quantidade de ${item.sku}`}
            className="h-9 w-11 border-x border-neutral-200 text-center font-mono text-[13.5px]"
          />
          <button
            type="button"
            aria-label={`Aumentar ${item.sku}`}
            onClick={() => aoMudar(item.quantidade + 1)}
            className="flex size-9 items-center justify-center text-neutral-600 hover:bg-neutral-50"
          >
            +
          </button>
        </div>

        <span className="ml-auto w-[92px] text-right font-mono text-[13.5px] font-medium text-neutral-900 sm:ml-0">
          R$ {brl(unitario * item.quantidade)}
        </span>

        <button
          type="button"
          onClick={aoRemover}
          className="text-[11.5px] font-medium text-neutral-500 underline decoration-neutral-300 underline-offset-2"
        >
          remover
        </button>
      </div>
    </div>
  );
}
