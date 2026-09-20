import {
  PERM,
  type PaginaTitulos,
  type SituacaoTitulo,
  type TipoTitulo,
  type Titulo,
} from '@estoque/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

function brl(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function data(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');
}

/**
 * O quando, em palavras.
 *
 * "venceu há 9 dias" cobra sozinho; "11/09/2026" exige que quem lê faça a
 * conta de cabeça, toda vez, em cada linha.
 */
function prazo(t: Titulo): string {
  if (t.situacao === 'PAGO') return 'quitado';
  if (t.situacao === 'CANCELADO') return 'cancelado';
  if (t.diasDeAtraso === 0) return 'vence hoje';
  if (t.diasDeAtraso > 0) {
    return t.diasDeAtraso === 1 ? 'venceu ontem' : `venceu há ${String(t.diasDeAtraso)} dias`;
  }
  const faltam = -t.diasDeAtraso;
  return faltam === 1 ? 'vence amanhã' : `em ${String(faltam)} dias`;
}

const TOM: Record<SituacaoTitulo, { texto: string; linha: string; borda: string }> = {
  VENCIDO: {
    texto: 'text-[var(--color-perigo)]',
    linha: 'bg-[#fdf5f5]',
    borda: 'border-l-[3px] border-l-[var(--color-perigo)]',
  },
  VENCE_HOJE: {
    texto: 'text-[var(--color-atencao)]',
    linha: 'bg-[#fdf6ec]',
    borda: 'border-l-[3px] border-l-[var(--color-atencao)]',
  },
  A_VENCER: { texto: 'text-neutral-600', linha: '', borda: '' },
  PAGO: { texto: 'text-[var(--color-sucesso)]', linha: '', borda: '' },
  CANCELADO: { texto: 'text-neutral-400', linha: '', borda: '' },
};

const RECORTES = [
  { chave: 'abertos', rotulo: 'Em aberto', contagem: 'abertos' },
  { chave: 'vencidos', rotulo: 'Vencidos', contagem: 'vencidos' },
  { chave: 'pagos', rotulo: 'Pagos', contagem: 'pagos' },
  { chave: 'todos', rotulo: 'Todos', contagem: 'todos' },
] as const;

type Recorte = (typeof RECORTES)[number]['chave'];

export function Contas() {
  const { pode } = useSessao();

  const [tipo, setTipo] = useState<TipoTitulo>('PAGAR');
  const [recorte, setRecorte] = useState<Recorte>('abertos');
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState('');
  const [baixando, setBaixando] = useState<Titulo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 350);
    return () => clearTimeout(id);
  }, [termo]);

  const lista = useQuery({
    queryKey: ['contas', tipo, recorte, busca],
    queryFn: () => {
      const p = new URLSearchParams({ tipo, recorte, limite: '40' });
      if (busca) p.set('termo', busca);
      return pedir<PaginaTitulos>(`/financeiro/titulos?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const podeBaixar = pode(PERM.financeiro.baixar);

  return (
    <>
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2 sm:gap-3 sm:px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Contas</span>
        <div className="flex-1" />
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex w-full flex-col gap-3.5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
                Contas
              </h1>
              <p className="mt-1 text-[13.5px] text-neutral-500">
                Títulos com <strong className="font-semibold text-neutral-700">vencimento</strong> —
                o que a loja deve e o que têm a receber dela.
              </p>
            </div>

            <div className="flex gap-1 rounded-lg border border-neutral-100 bg-neutral-50 p-[3px]">
              {(['PAGAR', 'RECEBER'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTipo(t);
                    setBaixando(null);
                  }}
                  className={juntar(
                    'flex h-8 items-center gap-1.5 rounded-md border px-4 text-[13px]',
                    tipo === t
                      ? 'border-neutral-200 bg-white font-semibold text-neutral-900 shadow-sm'
                      : 'border-transparent font-medium text-neutral-500',
                  )}
                >
                  {t === 'PAGAR' ? 'A pagar' : 'A receber'}
                  <span
                    className={juntar(
                      'flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-medium',
                      lista.data &&
                        (t === 'PAGAR'
                          ? lista.data.contagens.aPagar
                          : lista.data.contagens.aReceber) > 0 &&
                        tipo === t
                        ? 'bg-[var(--color-perigo)] text-white'
                        : 'bg-neutral-100 text-neutral-500',
                    )}
                  >
                    {lista.data
                      ? t === 'PAGAR'
                        ? lista.data.contagens.aPagar
                        : lista.data.contagens.aReceber
                      : '—'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {/*
            A fronteira com a carteira, escrita na tela.
            Sem isso, o mesmo débito aparece nos dois lugares com números
            diferentes e ninguém sabe qual obedecer.
          */}
          {tipo === 'RECEBER' ? (
            <div className="flex gap-2.5 rounded-lg border border-primary-100 bg-primary-50 px-3.5 py-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                className="mt-px shrink-0 text-primary-600"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
              <p className="text-[12.5px] leading-[18px] text-primary-800">
                O saldo do revendedor continua sendo o da{' '}
                <Link to="/carteiras" className="font-semibold">
                  Carteira
                </Link>{' '}
                — este módulo não cria um segundo saldo. O título acrescenta o que a carteira não
                tem: <strong className="font-semibold">vencimento</strong>. Dar baixa aqui lança a
                quitação NA carteira, e é ela que continua mandando no limite de crédito.
              </p>
            </div>
          ) : null}

          {lista.data ? <Indicadores resumo={lista.data.resumo} /> : null}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <section className="w-full min-w-0 flex-1 overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
                {RECORTES.map((r) => (
                  <button
                    key={r.chave}
                    type="button"
                    onClick={() => setRecorte(r.chave)}
                    className={juntar(
                      'flex h-[29px] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px]',
                      recorte === r.chave
                        ? 'border-primary-600 bg-primary-600 font-semibold text-white'
                        : r.chave === 'vencidos'
                          ? 'border-[#f0c9cb] bg-white text-[var(--color-perigo)]'
                          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300',
                    )}
                  >
                    {r.rotulo}
                    <span className="font-mono text-[11.5px] font-normal">
                      {lista.data ? lista.data.contagens[r.contagem] : '—'}
                    </span>
                  </button>
                ))}

                <div className="flex-1" />

                <span className="hidden text-[11.5px] text-neutral-400 sm:block">
                  do vencimento mais antigo
                </span>

                <input
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder={
                    tipo === 'PAGAR' ? 'Fornecedor ou descrição' : 'Cliente ou descrição'
                  }
                  aria-label="Buscar título"
                  className="h-8 w-[200px] rounded-md border border-neutral-200 px-2.5 text-[12.5px]"
                />
              </div>

              <div className="hidden grid-cols-[112px_minmax(0,1fr)_104px_104px_104px_92px] items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2 lg:grid">
                <Coluna>Vencimento</Coluna>
                <Coluna>{tipo === 'PAGAR' ? 'Fornecedor · origem' : 'Cliente · origem'}</Coluna>
                <Coluna direita>Valor</Coluna>
                <Coluna direita>Pago</Coluna>
                <Coluna direita>Em aberto</Coluna>
                <span />
              </div>

              {lista.isPending ? <EstadoCarregando titulo="Carregando títulos…" /> : null}

              {lista.data?.itens.length === 0 ? (
                <EstadoVazio
                  titulo={busca ? 'Nada encontrado' : 'Nenhum título neste recorte'}
                  descricao={
                    busca
                      ? 'Tente outro nome ou outra descrição.'
                      : tipo === 'PAGAR'
                        ? 'Títulos a pagar nascem ao receber uma nota de fornecedor, ou lançados à mão.'
                        : 'Títulos a receber nascem de venda a prazo, ou lançados à mão.'
                  }
                />
              ) : null}

              {(lista.data?.itens ?? []).map((t) => (
                <LinhaTitulo
                  key={t.id}
                  titulo={t}
                  podeBaixar={podeBaixar}
                  ativo={baixando?.id === t.id}
                  aoBaixar={() => {
                    setErro(null);
                    setBaixando(t);
                  }}
                />
              ))}
            </section>

            {baixando ? (
              <PainelBaixa
                titulo={baixando}
                aoFechar={() => setBaixando(null)}
                aoFalhar={setErro}
              />
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

function Coluna({
  children,
  direita,
}: {
  readonly children: React.ReactNode;
  readonly direita?: boolean;
}) {
  return (
    <span
      className={juntar(
        'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
        direita && 'text-right',
      )}
    >
      {children}
    </span>
  );
}

function Indicadores({ resumo }: { readonly resumo: PaginaTitulos['resumo'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Cartao
        rotulo="Vencido"
        valor={resumo.vencido}
        nota={
          resumo.titulosVencidos === 0
            ? 'nada em atraso'
            : `${String(resumo.titulosVencidos)} ${resumo.titulosVencidos === 1 ? 'título' : 'títulos'}${
                resumo.atrasoMaisAntigo === null
                  ? ''
                  : ` · o mais antigo há ${String(resumo.atrasoMaisAntigo)} dias`
              }`
        }
        tom={resumo.titulosVencidos > 0 ? 'perigo' : undefined}
      />
      <Cartao
        rotulo="Vence hoje"
        valor={resumo.venceHoje}
        nota={`${String(resumo.titulosHoje)} ${resumo.titulosHoje === 1 ? 'título' : 'títulos'}`}
        tom={resumo.titulosHoje > 0 ? 'atencao' : undefined}
      />
      <Cartao
        rotulo="Próximos 7 dias"
        valor={resumo.proximos7}
        nota={`${String(resumo.titulosProximos7)} ${resumo.titulosProximos7 === 1 ? 'título' : 'títulos'}`}
      />
      {/*
        "Em aberto" soma `valor − pago`, não `valor`: um título de 9.600 com
        4.743 já pagos pesa 4.856 no que ainda falta. Somar o valor cheio
        mostraria uma dívida que não existe mais.
      */}
      <Cartao
        rotulo="Em aberto"
        valor={resumo.emAberto}
        nota={`${String(resumo.titulosEmAberto)} ${resumo.titulosEmAberto === 1 ? 'título' : 'títulos'} · já descontado o que foi pago`}
      />
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  nota,
  tom,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  readonly tom?: 'atencao' | 'perigo';
}) {
  return (
    <div
      className={juntar(
        'rounded-md border bg-white px-4 py-3',
        tom === 'perigo'
          ? 'border-[#f0c9cb]'
          : tom === 'atencao'
            ? 'border-[#ebd6a8]'
            : 'border-neutral-100',
      )}
    >
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p
        className={juntar(
          'mt-1 font-display text-[26px] font-bold leading-[30px] tabular-nums',
          tom === 'perigo'
            ? 'text-[var(--color-perigo)]'
            : tom === 'atencao'
              ? 'text-[var(--color-atencao)]'
              : 'text-neutral-900',
        )}
      >
        R$ {brl(valor)}
      </p>
      <p className="mt-0.5 text-[11.5px] leading-4 text-neutral-500">{nota}</p>
    </div>
  );
}

function LinhaTitulo({
  titulo,
  podeBaixar,
  ativo,
  aoBaixar,
}: {
  readonly titulo: Titulo;
  readonly podeBaixar: boolean;
  readonly ativo: boolean;
  readonly aoBaixar: () => void;
}) {
  const tom = TOM[titulo.situacao];
  const aberto = titulo.status === 'ABERTO';

  return (
    <div
      className={juntar(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 last:border-0 lg:grid-cols-[112px_minmax(0,1fr)_104px_104px_104px_92px]',
        tom.linha,
        tom.borda,
        ativo && 'bg-primary-50',
      )}
    >
      <span className="col-start-1 row-start-1 lg:col-start-auto lg:row-start-auto">
        <span className={juntar('block font-mono text-[12.5px] font-medium', tom.texto)}>
          {data(titulo.vencimento)}
        </span>
        <span className={juntar('block text-[11px] font-semibold', tom.texto)}>
          {prazo(titulo)}
        </span>
      </span>

      <span className="col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:col-start-auto lg:row-start-auto">
        <span className="block truncate text-[13px] text-neutral-900">{titulo.contraparte}</span>
        <span className="block truncate text-[11.5px] text-neutral-500">
          {titulo.descricao}
          {titulo.parcelas > 1
            ? ` · parcela ${String(titulo.parcela)}/${String(titulo.parcelas)}`
            : ''}
          {titulo.origem === 'MANUAL' ? ' · lançado à mão' : ''}
        </span>
      </span>

      <span className="hidden text-right font-mono text-[13px] tabular-nums text-neutral-700 lg:block">
        R$ {brl(titulo.valor)}
      </span>

      {/*
        Baixa PARCIAL fica visível: o título continua vivo pelo saldo, e
        marcar como pago o que foi pago pela metade é perder a cobrança do
        resto.
      */}
      <span className="hidden text-right font-mono text-[13px] tabular-nums lg:block">
        {Number(titulo.valorPago) > 0 ? (
          <span className="text-[var(--color-sucesso)]">R$ {brl(titulo.valorPago)}</span>
        ) : (
          <span className="text-neutral-300">—</span>
        )}
      </span>

      <span
        className={juntar(
          'col-start-2 row-start-1 text-right font-mono text-[13.5px] font-medium tabular-nums lg:col-start-auto lg:row-start-auto',
          aberto ? tom.texto : 'text-neutral-400',
        )}
      >
        R$ {brl(titulo.emAberto)}
      </span>

      <span className="col-span-2 row-start-3 lg:col-span-1 lg:col-start-auto lg:row-start-auto">
        {aberto && podeBaixar ? (
          <button
            type="button"
            onClick={aoBaixar}
            className={juntar(
              'h-[30px] w-full rounded-md text-[12.5px] font-semibold',
              titulo.situacao === 'A_VENCER'
                ? 'border border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300'
                : 'bg-primary-600 text-white hover:bg-primary-700',
            )}
          >
            Baixar
          </button>
        ) : titulo.status === 'PAGO' ? (
          <span className="block text-center text-[11.5px] font-medium text-[var(--color-sucesso)]">
            quitado
          </span>
        ) : titulo.status === 'CANCELADO' ? (
          <span className="block text-center text-[11.5px] text-neutral-400">cancelado</span>
        ) : null}
      </span>
    </div>
  );
}

const FORMAS = [
  { chave: 'TRANSFERENCIA', rotulo: 'Transferência' },
  { chave: 'BOLETO', rotulo: 'Boleto' },
  { chave: 'PIX', rotulo: 'PIX' },
  { chave: 'DINHEIRO', rotulo: 'Dinheiro' },
] as const;

function PainelBaixa({
  titulo,
  aoFechar,
  aoFalhar,
}: {
  readonly titulo: Titulo;
  readonly aoFechar: () => void;
  readonly aoFalhar: (mensagem: string) => void;
}) {
  const fila = useQueryClient();

  const [valor, setValor] = useState(titulo.emAberto);
  const [pagoEm, setPagoEm] = useState(new Date().toISOString().slice(0, 10));
  const [forma, setForma] = useState<(typeof FORMAS)[number]['chave']>('TRANSFERENCIA');
  const [observacao, setObservacao] = useState('');

  /* Qual baixa está sendo desfeita, e por quê. O id do dono mora no estado:
     o painel não remonta ao trocar de título. */
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [motivoEstorno, setMotivoEstorno] = useState('');

  // O painel não remonta ao trocar de título: a rota é a mesma, muda o
  // objeto. Sem isto, o valor digitado para um título ficaria no seguinte.
  useEffect(() => {
    setValor(titulo.emAberto);
    setObservacao('');
    setDesfazendo(null);
    setMotivoEstorno('');
  }, [titulo.id, titulo.emAberto]);

  const baixar = useMutation({
    mutationFn: () =>
      pedir<Titulo>(`/financeiro/titulos/${titulo.id}/baixar`, {
        method: 'POST',
        body: {
          valor,
          pagoEm,
          forma,
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      aoFechar();
      await fila.invalidateQueries({ queryKey: ['contas'] });
      await fila.invalidateQueries({ queryKey: ['carteiras'] });
      await fila.invalidateQueries({ queryKey: ['caixa'] });
    },
    onError: (e) => {
      aoFalhar(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível dar baixa.');
    },
  });

  /*
    Desfazer uma baixa.

    A rota nasceu junto com este botão: baixa errada digitada pela equipe não
    tinha como ser desfeita, e a recusa de cancelar uma venda mandava
    "estorne a baixa antes" — um botão que não existia.

    O motivo é obrigatório e é pedido aqui, não no servidor: desfazer dinheiro
    sem dizer por que é o mesmo que não registrar.
  */
  const estornar = useMutation({
    mutationFn: (alvo: { id: string; motivo: string }) =>
      pedir<Titulo>(`/financeiro/titulos/${titulo.id}/baixas/${alvo.id}/estornar`, {
        method: 'POST',
        body: { motivo: alvo.motivo },
      }),
    onSuccess: async () => {
      setDesfazendo(null);
      setMotivoEstorno('');
      await fila.invalidateQueries({ queryKey: ['contas'] });
      await fila.invalidateQueries({ queryKey: ['carteiras'] });
      await fila.invalidateQueries({ queryKey: ['caixa'] });
    },
    onError: (e) => {
      aoFalhar(
        e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível estornar a baixa.',
      );
    },
  });

  const parcial = Number(valor) > 0 && Number(valor) < Number(titulo.emAberto);
  const acimaDoSaldo = Number(valor) > Number(titulo.emAberto);

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm lg:w-[352px]">
      <div className="border-b border-neutral-100 px-4 py-3">
        <h2 className="font-display text-[15px] font-bold text-neutral-900">Dar baixa</h2>
        <p className="mt-0.5 text-[12.5px] text-neutral-500">
          {titulo.contraparte} · {titulo.descricao}
        </p>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex items-baseline justify-between border-b border-neutral-50 pb-2.5">
          <span className="text-[12.5px] text-neutral-500">Em aberto</span>
          <span className="font-mono text-[17px] font-medium tabular-nums text-[var(--color-perigo)]">
            R$ {brl(titulo.emAberto)}
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Valor pago
          </span>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/[^\d.]/g, ''))}
            autoFocus
            className="h-10 rounded-md border border-neutral-200 px-2.5 text-right font-mono text-[16px]"
          />
          {acimaDoSaldo ? (
            <span className="text-[11.5px] font-medium text-[var(--color-perigo)]">
              Acima do que se deve. Baixar mais do que o saldo é erro de digitação.
            </span>
          ) : parcial ? (
            <span className="text-[11.5px] text-neutral-500">
              Baixa parcial: o título continua aberto por R${' '}
              {brl(Number(titulo.emAberto) - Number(valor))}.
            </span>
          ) : (
            <span className="text-[11.5px] text-neutral-400">
              Menos do que o total deixa o título aberto pelo saldo.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Data do pagamento
          </span>
          <input
            type="date"
            value={pagoEm}
            onChange={(e) => setPagoEm(e.target.value)}
            className="h-9 rounded-md border border-neutral-200 px-2.5 text-[13.5px]"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Forma
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {FORMAS.map((f) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => setForma(f.chave)}
                className={juntar(
                  'h-[34px] rounded-md border text-[12.5px]',
                  forma === f.chave
                    ? 'border-primary-600 bg-primary-600 font-semibold text-white'
                    : 'border-neutral-200 bg-white text-neutral-700',
                )}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
          {/*
            Dinheiro sai da GAVETA: a baixa em espécie vira sangria e exige
            caixa aberto. Dizer isso antes evita a recusa com o formulário
            preenchido.
          */}
          {forma === 'DINHEIRO' ? (
            <span className="text-[11.5px] text-[var(--color-atencao)]">
              Em dinheiro, a baixa registra{' '}
              {titulo.tipo === 'PAGAR' ? 'uma sangria' : 'um suprimento'} no seu caixa aberto — sem
              caixa, o servidor recusa.
            </span>
          ) : null}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
            Observação
          </span>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="Comprovante, quem autorizou…"
            className="resize-none rounded-md border border-neutral-200 px-2.5 py-2 text-[12.5px]"
          />
        </label>
      </div>

      {titulo.baixas.length > 0 ? (
        <div className="border-t border-neutral-100 px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
            Baixas anteriores
          </p>
          {titulo.baixas.map((b) => (
            <div key={b.id} className="mt-1.5">
              <p className="flex items-center justify-between gap-2 text-[12px] text-neutral-600">
                <span className={b.estornadaEm ? 'text-neutral-400 line-through' : undefined}>
                  {data(b.pagoEm)} · {b.forma.toLowerCase()}
                  {b.ator ? ` · ${b.ator}` : ''}
                </span>
                <span
                  className={juntar(
                    'shrink-0 font-mono tabular-nums',
                    b.estornadaEm && 'text-neutral-400 line-through',
                  )}
                >
                  R$ {brl(b.valor)}
                </span>
              </p>

              {/*
                Estornada NÃO some da lista: sumir diria que o dinheiro nunca
                se moveu, e ele se moveu. Fica riscada, com o motivo.
              */}
              {b.estornadaEm ? (
                <p className="text-[11.5px] leading-4 text-[var(--color-atencao)]">
                  Estornada em {data(b.estornadaEm.slice(0, 10))}
                  {b.estornoMotivo ? ` — ${b.estornoMotivo}` : ''}
                </p>
              ) : desfazendo === b.id ? (
                <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-neutral-100 bg-neutral-25 p-2">
                  <input
                    value={motivoEstorno}
                    onChange={(e) => setMotivoEstorno(e.target.value)}
                    autoFocus
                    placeholder="Por que esta baixa está sendo desfeita?"
                    className="h-8 rounded border border-neutral-200 bg-white px-2 text-[12px]"
                  />
                  <p className="text-[11px] leading-4 text-neutral-500">
                    O motivo fica no título e na auditoria. O contrário entra no caixa e na
                    carteira.
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={motivoEstorno.trim().length < 5 || estornar.isPending}
                      onClick={() => estornar.mutate({ id: b.id, motivo: motivoEstorno.trim() })}
                      className="h-7 rounded border border-[var(--color-perigo)] px-2.5 text-[11.5px] font-medium text-[var(--color-perigo)] disabled:border-neutral-200 disabled:text-neutral-400"
                    >
                      Estornar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesfazendo(null)}
                      className="h-7 rounded border border-neutral-200 px-2.5 text-[11.5px] text-neutral-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDesfazendo(b.id);
                    setMotivoEstorno('');
                  }}
                  className="text-[11.5px] text-neutral-500 underline underline-offset-2 hover:text-[var(--color-perigo)]"
                >
                  Estornar esta baixa
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-auto border-t border-neutral-100 px-4 py-3">
        <div className="mb-2.5 flex gap-2 rounded-md border border-neutral-100 bg-neutral-25 px-3 py-2">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            className="mt-px shrink-0 text-neutral-400"
            aria-hidden="true"
          >
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h10" />
          </svg>
          <p className="text-[11.5px] leading-4 text-neutral-500">
            A baixa é um lançamento, não uma edição: o título guarda o histórico e corrigir é lançar
            o contrário.
            {titulo.tipo === 'RECEBER' ? ' A quitação vai para a carteira do cliente.' : ''}
          </p>
        </div>

        <div className="flex gap-2">
          <Botao
            variante="primario"
            carregando={baixar.isPending}
            disabled={!valor || Number(valor) <= 0 || acimaDoSaldo}
            onClick={() => baixar.mutate()}
          >
            Confirmar baixa de R$ {brl(valor || '0')}
          </Botao>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </div>
    </aside>
  );
}
