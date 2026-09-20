import type { ItemCatalogo } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
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

  // Uma pausa antes de perguntar: digitar "kimono" dispararia seis consultas,
  // e cada uma custa um cálculo de disponibilidade por item no servidor.
  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = useQuery({
    queryKey: ['portal', 'catalogo', busca],
    queryFn: () =>
      pedir<ItemCatalogo[]>(
        `/portal/pedidos/catalogo?limite=48${busca ? `&termo=${encodeURIComponent(busca)}` : ''}`,
      ),
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[22px] font-bold text-neutral-900">Catálogo</h1>
        <p className="text-[13px] text-neutral-500">
          Os preços são os da sua tabela. Itens sem preço para você não aparecem aqui.
        </p>
      </div>

      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar por produto, código ou descrição"
        aria-label="Buscar no catálogo"
        className="h-11 w-full rounded-md border border-neutral-200 bg-white px-3.5 text-[14px]"
      />

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

      {consulta.data?.length === 0 ? (
        <EstadoVazio
          titulo={busca ? 'Nada encontrado' : 'Catálogo vazio'}
          descricao={
            busca
              ? 'Tente outro termo, ou fale com a loja.'
              : 'A loja ainda não publicou itens na sua tabela de preço.'
          }
        />
      ) : null}

      {consulta.data && consulta.data.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {consulta.data.map((item) => (
            <CartaoItem key={item.variacaoId} item={item} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function CartaoItem({ item }: { readonly item: ItemCatalogo }) {
  const { adicionar, itens } = useCarrinho();
  const jaNoCarrinho = itens.find((i) => i.variacaoId === item.variacaoId);

  return (
    <li className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
      <div className="aspect-square bg-primary-50">
        {item.imagemPrincipalId ? (
          <Foto
            imagemId={item.imagemPrincipalId}
            alt={item.produto}
            raiz="/portal/midia"
            className="size-full"
          />
        ) : null}
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
          <Botao
            tamanho="compacto"
            variante={jaNoCarrinho ? 'secundario' : 'primario'}
            onClick={() => adicionar(item)}
          >
            {jaNoCarrinho ? `+1 (${String(jaNoCarrinho.quantidade)})` : 'Adicionar'}
          </Botao>
        </div>
      </div>
    </li>
  );
}
