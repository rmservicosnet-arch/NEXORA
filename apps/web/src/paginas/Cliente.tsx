import { PERM, type ApoioCliente, type Cliente as ClienteDto } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { EstadoCarregando, EstadoErro } from '../ui/Estados';

const MODOS = [
  {
    valor: 'PEDIDO_COM_CONFIRMACAO',
    rotulo: 'Pedido com confirmação',
    ajuda: 'O cliente envia; a equipe confere e confirma antes de virar venda.',
  },
  {
    valor: 'PAGAMENTO_IMEDIATO',
    rotulo: 'Pagamento imediato',
    ajuda: 'O carrinho vira venda na hora, debitada na carteira do cliente.',
  },
] as const;

export function Cliente() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [tabelaPrecoId, setTabelaPrecoId] = useState<string>('');
  const [modoCheckout, setModoCheckout] = useState<string>('');
  const [usaCarteira, setUsaCarteira] = useState(false);
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const consulta = useQuery({
    queryKey: ['clientes', clienteId],
    queryFn: () => pedir<ClienteDto>(`/clientes/${clienteId ?? ''}`),
    enabled: Boolean(clienteId),
  });

  const apoio = useQuery({
    queryKey: ['clientes', 'apoio'],
    queryFn: () => pedir<ApoioCliente>('/clientes/apoio'),
  });

  // O formulário nasce do servidor a cada carga do cadastro.
  useEffect(() => {
    const c = consulta.data;
    if (!c) return;
    setTabelaPrecoId(c.tabelaPrecoId ?? '');
    setModoCheckout(c.modoCheckout ?? '');
    setUsaCarteira(c.usaCarteira);
    setNome(c.nome);
    setDocumento(c.documento ?? '');
    setEmail(c.email ?? '');
    setTelefone(c.telefone ?? '');
  }, [consulta.data]);

  const salvar = useMutation({
    mutationFn: () =>
      pedir<{ id: string }>(`/clientes/${clienteId ?? ''}`, {
        method: 'PATCH',
        body: {
          nome,
          documento: documento.trim() || null,
          email: email.trim() || null,
          telefone: telefone.trim() || null,
          // String vazia significa "nenhuma" — e `null` é como se diz isso à
          // API. Mandar `''` faria o Zod recusar um uuid inválido.
          tabelaPrecoId: tabelaPrecoId || null,
          modoCheckout: modoCheckout || null,
          usaCarteira,
        },
      }),
    onSuccess: async () => {
      setErro(null);
      setSalvo(true);
      await fila.invalidateQueries({ queryKey: ['clientes'] });
    },
    onError: (e) => {
      setSalvo(false);
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível salvar.');
    },
  });

  if (consulta.isPending) {
    return <EstadoCarregando titulo="Carregando cadastro…" />;
  }

  if (consulta.isError || !consulta.data) {
    return (
      <EstadoErro
        titulo="Não foi possível abrir o cadastro"
        descricao={
          consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente novamente em instantes.'
        }
      />
    );
  }

  const cliente = consulta.data;
  const podeEditar = pode(PERM.cliente.editar);
  const tabelaEscolhida = apoio.data?.tabelas.find((t) => t.id === tabelaPrecoId) ?? null;

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <Link
          to="/clientes"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Clientes
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-[13.5px] font-medium text-neutral-900">{cliente.nome}</span>
        <div className="hidden flex-1 sm:block" />
        {podeEditar ? (
          <Botao variante="primario" carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar
          </Botao>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível salvar">
              {erro}
            </Aviso>
          ) : null}
          {salvo ? <Aviso tom="sucesso">Cadastro atualizado.</Aviso> : null}

          <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              Tabela de preço
            </h2>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Tabela deste cadastro
              </span>
              <select
                value={tabelaPrecoId}
                disabled={!podeEditar}
                onChange={(e) => {
                  setTabelaPrecoId(e.target.value);
                  setSalvo(false);
                }}
                className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900"
              >
                <option value="">Nenhuma — o cliente não vê catálogo</option>
                {apoio.data?.tabelas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                    {t.padrao ? ' (padrão)' : ''} — {t.itensComPreco}{' '}
                    {t.itensComPreco === 1 ? 'item' : 'itens'}
                  </option>
                ))}
              </select>
            </label>

            {/*
              Duas armadilhas diferentes, e a tela precisa distinguir: sem
              tabela o catálogo é vazio porque não há lista; com uma tabela
              vazia ele é vazio porque a lista não foi preenchida. O segundo
              caso engana mais — parece configurado.
            */}
            {!tabelaPrecoId ? (
              <Aviso tom="atencao">
                Sem tabela, o portal deste cliente fica vazio: um item sem preço na tabela dele não
                existe para ele.
              </Aviso>
            ) : tabelaEscolhida && tabelaEscolhida.itensComPreco === 0 ? (
              <Aviso tom="atencao" titulo="Esta tabela não tem nenhum preço">
                O cadastro fica vinculado, mas o catálogo continua vazio até alguém preencher os
                preços dela em Produtos.
              </Aviso>
            ) : null}
          </section>

          <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">
              Como a compra dele termina
            </h2>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Modo de checkout
              </span>
              <select
                value={modoCheckout}
                disabled={!podeEditar}
                onChange={(e) => {
                  setModoCheckout(e.target.value);
                  setSalvo(false);
                }}
                className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900"
              >
                {/*
                  "Herdar" é uma opção de verdade, não a ausência de escolha:
                  quem herda acompanha a empresa quando ela muda de política;
                  quem foi configurado, não.
                */}
                <option value="">
                  Seguir a empresa
                  {apoio.data
                    ? ` (${MODOS.find((m) => m.valor === apoio.data.modoCheckoutPadrao)?.rotulo ?? ''})`
                    : ''}
                </option>
                {MODOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.rotulo}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-neutral-500">
                {
                  MODOS.find((m) => m.valor === (modoCheckout || cliente.modoCheckoutEfetivo))
                    ?.ajuda
                }
              </span>
            </label>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={usaCarteira}
                disabled={!podeEditar}
                onChange={(e) => {
                  setUsaCarteira(e.target.checked);
                  setSalvo(false);
                }}
                className="mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13.5px] text-neutral-900">Usa conta corrente</span>
                <span className="text-[12px] leading-[17px] text-neutral-500">
                  Decide onde a dívida vive: na carteira, ou como título em contas a receber. Contar
                  nos dois seria contar duas vezes.
                </span>
              </span>
            </label>

            {(modoCheckout || cliente.modoCheckoutEfetivo) === 'PAGAMENTO_IMEDIATO' &&
            !cliente.temCarteira ? (
              <Aviso tom="perigo" titulo="Pagamento imediato sem carteira">
                Não existe pagamento automático sem uma conta de onde tirar o dinheiro. O checkout
                deste cliente vai ser recusado até ele ter carteira.
              </Aviso>
            ) : null}
          </section>

          <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
            <h2 className="font-display text-[15px] font-semibold text-neutral-900">Dados</h2>

            <Campo
              rotulo="Nome"
              value={nome}
              disabled={!podeEditar}
              onChange={(e) => {
                setNome(e.target.value);
                setSalvo(false);
              }}
            />
            <Campo
              rotulo="Documento"
              value={documento}
              disabled={!podeEditar}
              onChange={(e) => {
                setDocumento(e.target.value);
                setSalvo(false);
              }}
            />
            <Campo
              rotulo="E-mail"
              type="email"
              value={email}
              disabled={!podeEditar}
              onChange={(e) => {
                setEmail(e.target.value);
                setSalvo(false);
              }}
            />
            <Campo
              rotulo="Telefone"
              value={telefone}
              disabled={!podeEditar}
              onChange={(e) => {
                setTelefone(e.target.value);
                setSalvo(false);
              }}
            />

            <p className="text-[12px] text-neutral-500">
              {cliente.acessos > 0
                ? `${String(cliente.acessos)} ${cliente.acessos === 1 ? 'acesso' : 'acessos'} ao portal.`
                : 'Este cadastro ainda não tem acesso ao portal — criar acesso não existe nesta tela.'}
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
