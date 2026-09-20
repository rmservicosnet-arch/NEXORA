import type { CatalogoPortal, ItemCatalogo } from '@estoque/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { useCarrinho } from '../../portal/carrinho';
import { Botao } from '../../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../../ui/Estados';
import { Foto } from '../../ui/Foto';
import { juntar } from '../../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

export function PortalCatalogo() {
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [apenasDisponiveis, setApenasDisponiveis] = useState(false);

  // Uma pausa antes de perguntar: digitar "kimono" dispararia seis consultas,
  // e cada uma custa um cálculo de disponibilidade por item no servidor.
  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = useQuery({
    queryKey: ['portal', 'catalogo', busca, categoriaId, apenasDisponiveis],
    queryFn: () => {
      const p = new URLSearchParams({ limite: '48' });
      if (busca) p.set('termo', busca);
      if (categoriaId) p.set('categoriaId', categoriaId);
      if (apenasDisponiveis) p.set('apenasDisponiveis', 'true');
      return pedir<CatalogoPortal>(`/portal/pedidos/catalogo?${p.toString()}`);
    },
    // Trocar de categoria não pode piscar a tela inteira em branco.
    placeholderData: keepPreviousData,
  });

  const dados = consulta.data;
  const filtrando = Boolean(busca) || categoriaId !== null || apenasDisponiveis;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[22px] font-bold text-neutral-900">Catálogo</h1>
        {/*
          A TABELA aparece por nome. É ela que decide o catálogo inteiro —
          item sem preço nela não existe para este cliente —, e sem esse nome
          o cliente não sabe o que perguntar quando falta alguma coisa.
        */}
        <p className="text-[13px] text-neutral-500">
          {dados ? (
            <>
              Preços da sua tabela{' '}
              <strong className="font-semibold text-neutral-900">{dados.tabela}</strong> ·{' '}
              {dados.totalNaTabela} {dados.totalNaTabela === 1 ? 'item' : 'itens'} disponíveis
            </>
          ) : (
            'Carregando…'
          )}
        </p>
      </div>

      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar por produto, código ou descrição"
        aria-label="Buscar no catálogo"
        className="h-11 w-full rounded-md border border-neutral-200 bg-white px-3.5 text-[14px]"
      />

      {/*
        As categorias vêm do servidor: são as que este cliente realmente tem.
        Uma lista fixa ofereceria pílula que abre em nada.
      */}
      {dados && dados.categorias.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pilula ativa={categoriaId === null} aoClicar={() => setCategoriaId(null)}>
            Todas
          </Pilula>
          {dados.categorias.map((c) => (
            <Pilula
              key={c.id}
              ativa={categoriaId === c.id}
              aoClicar={() => setCategoriaId(categoriaId === c.id ? null : c.id)}
            >
              {c.nome}
            </Pilula>
          ))}

          <div className="hidden flex-1 sm:block" />

          <label
            className={juntar(
              'flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12.5px] font-medium',
              apenasDisponiveis
                ? 'border-[var(--color-sucesso)] bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
                : 'border-neutral-200 bg-white text-neutral-600',
            )}
          >
            <input
              type="checkbox"
              checked={apenasDisponiveis}
              onChange={(e) => setApenasDisponiveis(e.target.checked)}
              className="size-3.5"
            />
            Só pronta entrega
          </label>
        </div>
      ) : null}

      {consulta.isPending ? <EstadoCarregando titulo="Carregando catálogo…" /> : null}

      {consulta.isError ? (
        <EstadoErro
          titulo="Não foi possível carregar o catálogo"
          descricao={
            consulta.error instanceof ErroRequisicao
              ? consulta.error.corpo.mensagem
              : 'Tente novamente em instantes.'
          }
        />
      ) : null}

      {dados && dados.itens.length === 0 ? (
        <EstadoVazio
          titulo={filtrando ? 'Nada encontrado' : 'Catálogo vazio'}
          descricao={
            filtrando
              ? 'Tente outro termo ou outra categoria — ou tire o filtro de pronta entrega.'
              : 'A loja ainda não publicou itens na sua tabela de preço.'
          }
        />
      ) : null}

      {dados && dados.itens.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {dados.itens.map((item) => (
            <CartaoItem key={item.variacaoId} item={item} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Pilula({
  ativa,
  aoClicar,
  children,
}: {
  readonly ativa: boolean;
  readonly aoClicar: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={juntar(
        'h-9 rounded-full border px-3.5 text-[12.5px]',
        ativa
          ? 'border-primary-600 bg-primary-600 font-semibold text-white'
          : 'border-neutral-200 bg-white text-neutral-700',
      )}
    >
      {children}
    </button>
  );
}

function SemFoto() {
  return (
    <span className="flex flex-col items-center gap-1 text-neutral-300">
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 16 5-4 4 3 3-2 6 5" />
        <circle cx="8.5" cy="9.5" r="1.4" />
      </svg>
      <span className="text-[10.5px] text-neutral-400">sem foto</span>
    </span>
  );
}

function CartaoItem({ item }: { readonly item: ItemCatalogo }) {
  const { adicionar, itens } = useCarrinho();
  const jaNoCarrinho = itens.find((i) => i.variacaoId === item.variacaoId);

  /** Quantas unidades levar. Some ao adicionar: o carrinho passa a mandar. */
  const [quantidade, setQuantidade] = useState(1);

  return (
    <li className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
      {/*
        A foto ocupa metade do que ocupava.

        Era um quadrado inteiro em cor de fundo: num catálogo sem fotos, a
        tela virava uma grade de retângulos coloridos e o texto — que é o que
        decide a compra — ficava espremido embaixo.
      */}
      <div className="flex h-[132px] shrink-0 items-center justify-center bg-neutral-50">
        {item.imagemPrincipalId ? (
          <Foto
            imagemId={item.imagemPrincipalId}
            alt={item.produto}
            raiz="/portal/midia"
            className="size-full"
            /*
              Foto que não carrega vira "sem foto", não caixa de erro: o
              defeito é da loja e aparece nas telas dela. Para o cliente, uma
              parede de avisos vermelhos numa vitrine só diz que a loja está
              quebrada.
            */
            seFalhar={<SemFoto />}
          />
        ) : (
          <SemFoto />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-[13px] font-medium leading-[17px] text-neutral-900">
          {item.produto}
        </p>
        <p className="truncate text-[11.5px] text-neutral-500">{item.descricaoVariacao}</p>
        <p className="truncate font-mono text-[10.5px] text-neutral-400">{item.sku}</p>

        {/*
          Disponível é BOOLEANO e vem assim do servidor: o cliente nunca vê
          quantidade, em loja nenhuma. Saber que restam duas peças é informação
          comercial da loja. Ver docs/ORDERS.md §7.

          "Sob encomenda" não é bloqueio: a loja aceita o pedido e confirma o
          que consegue. Esconder o item seria decidir pelo cliente.
        */}
        <span
          className={juntar(
            'w-fit rounded px-1.5 py-0.5 text-[10.5px] font-semibold',
            item.disponivel
              ? 'bg-[var(--color-sucesso-fundo)] text-[var(--color-sucesso)]'
              : 'bg-[var(--color-atencao-fundo)] text-[var(--color-atencao)]',
          )}
        >
          {item.disponivel ? 'pronta entrega' : 'sob encomenda'}
        </span>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <span className="font-mono text-[15px] font-semibold text-neutral-900">
            R$ {brl(item.preco)}
          </span>

          {/*
            A quantidade é escolhida ANTES de adicionar. Sem isto, levar seis
            faixas era clicar seis vezes e conferir o contador a cada clique.
          */}
          <span className="inline-flex items-center overflow-hidden rounded-md border border-neutral-200">
            <button
              type="button"
              aria-label={`Diminuir quantidade de ${item.sku}`}
              disabled={quantidade <= 1}
              onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              className="flex size-8 items-center justify-center text-[15px] text-neutral-600 disabled:opacity-35"
            >
              −
            </button>
            <span className="w-7 text-center font-mono text-[12.5px]">{quantidade}</span>
            <button
              type="button"
              aria-label={`Aumentar quantidade de ${item.sku}`}
              onClick={() => setQuantidade((q) => q + 1)}
              className="flex size-8 items-center justify-center text-[15px] text-neutral-600"
            >
              +
            </button>
          </span>
        </div>

        <Botao
          tamanho="compacto"
          variante={jaNoCarrinho ? 'secundario' : 'primario'}
          onClick={() => {
            adicionar(item, quantidade);
            setQuantidade(1);
          }}
        >
          {jaNoCarrinho ? `No carrinho (${String(jaNoCarrinho.quantidade)}) · somar` : 'Adicionar'}
        </Botao>
      </div>
    </li>
  );
}
