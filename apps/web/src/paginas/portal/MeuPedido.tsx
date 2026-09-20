import type { Pedido, PedidoItem } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { EstadoCarregando, EstadoErro } from '../../ui/Estados';
import { Foto } from '../../ui/Foto';
import { juntar } from '../../ui/juntar';
import { SeloStatusCliente } from './MeusPedidos';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

export function PortalMeuPedido() {
  const { pedidoId } = useParams<{ pedidoId: string }>();
  const local = useLocation();
  const fila = useQueryClient();

  const daNavegacao = (local.state as { mensagem?: string } | null)?.mensagem ?? null;
  const [motivo, setMotivo] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: ['portal', 'pedidos', pedidoId],
    queryFn: () => pedir<Pedido>(`/portal/pedidos/${pedidoId ?? ''}`),
    enabled: Boolean(pedidoId),
    // Enquanto a loja confere, o estado muda sem o cliente fazer nada.
    refetchInterval: 30_000,
  });

  const responder = useMutation({
    mutationFn: (aceita: boolean) =>
      pedir<Pedido>(`/portal/pedidos/${pedidoId ?? ''}/aceite`, {
        method: 'POST',
        body: { aceita, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) },
      }),
    onSuccess: (_p, aceita) => {
      setErro(null);
      setRecusando(false);
      setMotivo('');
      setFeito(
        aceita
          ? 'Aceite registrado. A loja segue com o pedido.'
          : 'Recusa registrada. A loja vai retomar o pedido.',
      );
      void fila.invalidateQueries({ queryKey: ['portal', 'pedidos'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível responder.');
    },
  });

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando pedido…" />;
  }

  if (consulta.isError || !consulta.data) {
    return (
      <EstadoErro
        titulo="Não foi possível abrir o pedido"
        descricao={
          consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente novamente em instantes.'
        }
      />
    );
  }

  const pedido = consulta.data;
  const esperaVoce = pedido.status === 'AGUARDANDO_ACEITE_CLIENTE';
  const diferenca = Number(pedido.diferenca);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/portal/pedidos"
          className="text-[13px] text-neutral-500 no-underline hover:underline"
        >
          Meus pedidos
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-mono text-[13.5px] font-medium text-neutral-900">
          #{pedido.numero}
        </span>
        <SeloStatusCliente status={pedido.status} />
      </div>

      {daNavegacao ? <Aviso tom="sucesso">{daNavegacao}</Aviso> : null}
      {feito ? <Aviso tom="sucesso">{feito}</Aviso> : null}
      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível responder">
          {erro}
        </Aviso>
      ) : null}

      <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-neutral-500">{pedido.loja}</p>
            {pedido.tabelaPreco ? (
              <p className="text-[12px] text-neutral-400">tabela {pedido.tabelaPreco}</p>
            ) : null}
          </div>

          <div className="text-right">
            <p className="font-mono text-[22px] font-bold text-neutral-900">
              R$ {brl(pedido.valorConfirmado)}
            </p>
            {/*
              A diferença é o assunto da tela quando existe. O cliente enviou
              um valor; mostrar só o novo total esconderia a mudança que ele
              precisa aprovar.
            */}
            {diferenca !== 0 ? (
              <p
                className={juntar(
                  'font-mono text-[12.5px]',
                  diferenca > 0 ? 'text-[var(--color-perigo)]' : 'text-[var(--color-sucesso)]',
                )}
              >
                {diferenca > 0 ? '+' : '−'} R$ {brl(Math.abs(diferenca))} em relação ao que você
                enviou
              </p>
            ) : null}
          </div>
        </div>

        {pedido.resumoAlteracao ? (
          <Aviso tom="atencao" titulo="O que a loja mudou">
            {pedido.resumoAlteracao}
          </Aviso>
        ) : null}
      </section>

      {esperaVoce ? (
        <section className="flex flex-col gap-3 rounded-md border border-[var(--color-atencao)] bg-[var(--color-atencao-fundo)] p-4">
          <p className="text-[13.5px] font-semibold text-neutral-900">
            O pedido mudou e precisa da sua resposta.
          </p>
          <p className="text-[12.5px] leading-[18px] text-neutral-600">
            Nada é cobrado antes de você aceitar. Se recusar, o pedido volta para a loja com o seu
            motivo.
          </p>

          {recusando ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={400}
                autoFocus
                placeholder="O que não ficou bom?"
                className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13.5px]"
              />
              <div className="flex flex-wrap gap-2">
                <Botao
                  variante="perigo"
                  carregando={responder.isPending}
                  onClick={() => responder.mutate(false)}
                >
                  Confirmar recusa
                </Botao>
                <Botao variante="secundario" onClick={() => setRecusando(false)}>
                  Voltar
                </Botao>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Botao
                variante="primario"
                tamanho="pdv"
                carregando={responder.isPending}
                onClick={() => responder.mutate(true)}
              >
                Aceitar R$ {brl(pedido.valorConfirmado)}
              </Botao>
              <Botao variante="secundario" tamanho="pdv" onClick={() => setRecusando(true)}>
                Recusar
              </Botao>
            </div>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">Itens</h2>
        {pedido.itens.map((item) => (
          <LinhaItem key={item.id} item={item} />
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">Andamento</h2>
        {pedido.eventos.map((evento) => (
          <div key={evento.id} className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
            <span className="w-[112px] shrink-0 font-mono text-neutral-400">
              {new Date(evento.criadoEm).toLocaleDateString('pt-BR')}{' '}
              {new Date(evento.criadoEm).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-neutral-700">
                {/* Quem agiu importa: "a loja" e "você" são partes diferentes
                    da mesma conversa, e a linha do tempo é a prova dela. */}
                {evento.atorTipo === 'CLIENTE' ? 'Você' : (evento.ator ?? 'A loja')}
              </p>
              {evento.motivo ? <p className="text-neutral-500">{evento.motivo}</p> : null}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function LinhaItem({ item }: { readonly item: PedidoItem }) {
  const removido = item.status === 'REMOVIDO';
  const devolvido = item.status === 'DEVOLVIDO';
  const incluido = item.origem === 'ADICIONADO_EQUIPE';

  // O que o cliente pediu e o que ele vai receber são números diferentes
  // quando a loja confirmou menos. Mostrar só um dos dois esconde a conversa.
  const pedida = Number(item.quantidadeSolicitada);
  const confirmada = Number(item.quantidadeConfirmada);
  const cortou = confirmada > 0 && pedida > 0 && confirmada < pedida;

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-3 border-b border-neutral-50 py-2.5 last:border-0',
        (removido || devolvido) && 'opacity-60',
      )}
    >
      <div className="size-11 shrink-0 overflow-hidden rounded bg-primary-50">
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
        <p
          className={juntar('truncate text-[13.5px] text-neutral-900', removido && 'line-through')}
        >
          {item.produto}
        </p>
        <p className="truncate text-[11.5px] text-neutral-500">{item.descricaoVariacao}</p>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {incluido ? (
            <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary-700">
              incluído pela loja
            </span>
          ) : null}
          {removido ? (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-600">
              removido
            </span>
          ) : null}
          {devolvido ? (
            <span className="rounded bg-[var(--color-perigo-fundo)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-perigo)]">
              não vem desta vez
            </span>
          ) : null}
          {cortou ? (
            <span className="rounded bg-[var(--color-atencao-fundo)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--color-atencao)]">
              {confirmada} de {pedida}
            </span>
          ) : null}
        </div>

        {item.motivoDevolucao ? (
          <p className="truncate text-[11.5px] text-[var(--color-perigo)]">{item.motivoDevolucao}</p>
        ) : null}
        {item.motivoRemocao ? (
          <p className="truncate text-[11.5px] text-neutral-500">{item.motivoRemocao}</p>
        ) : null}
      </div>

      <div className="ml-auto text-right">
        <p className="font-mono text-[13px] text-neutral-600">
          {confirmada > 0 ? confirmada : pedida} × R$ {brl(item.precoUnitario)}
        </p>
        <p className="font-mono text-[13.5px] font-medium text-neutral-900">
          R$ {brl(item.totalItem)}
        </p>
      </div>
    </div>
  );
}
