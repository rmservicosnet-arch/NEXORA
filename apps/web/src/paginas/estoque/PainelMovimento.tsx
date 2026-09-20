import {
  PERM,
  type LocalResumo,
  type ResultadoMovimento,
  type ResultadoTransferencia,
  type VariacaoParaMovimento,
} from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { useSessao } from '../../auth/sessao';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { Foto } from '../../ui/Foto';
import { juntar } from '../../ui/juntar';

type Operacao = 'entrada' | 'saida' | 'transferencia' | 'contagem';

const OPERACOES: { chave: Operacao; rotulo: string; permissao: string }[] = [
  { chave: 'entrada', rotulo: 'Entrada', permissao: PERM.estoque.entradaManual },
  { chave: 'saida', rotulo: 'Saída', permissao: PERM.estoque.ajustar },
  { chave: 'transferencia', rotulo: 'Transferência', permissao: PERM.estoque.transferir },
  { chave: 'contagem', rotulo: 'Contagem', permissao: PERM.estoque.inventariar },
];

const TIPOS_SAIDA = [
  { valor: 'SAIDA_PERDA', rotulo: 'Perda' },
  { valor: 'SAIDA_AVARIA', rotulo: 'Avaria' },
  { valor: 'SAIDA_CONSUMO', rotulo: 'Consumo interno' },
  { valor: 'SAIDA_DEVOLUCAO_FORNECEDOR', rotulo: 'Devolução a fornecedor' },
  { valor: 'SAIDA_AJUSTE', rotulo: 'Ajuste' },
];

const TIPOS_ENTRADA = [
  { valor: 'ENTRADA_COMPRA', rotulo: 'Compra' },
  { valor: 'ENTRADA_DEVOLUCAO_CLIENTE', rotulo: 'Devolução de cliente' },
  { valor: 'ENTRADA_AJUSTE', rotulo: 'Ajuste' },
];

interface Sucesso {
  readonly titulo: string;
  readonly detalhe: string;
  readonly avisos: { codigo: string; mensagem: string }[];
}

export function PainelMovimento({ aoFechar }: { readonly aoFechar: () => void }) {
  const { pode } = useSessao();
  const fila = useQueryClient();
  const campoBusca = useRef<HTMLInputElement>(null);

  const disponiveis = OPERACOES.filter((o) => pode(o.permissao));
  const [operacao, setOperacao] = useState<Operacao>(disponiveis[0]?.chave ?? 'entrada');

  const [termo, setTermo] = useState('');
  const [selecionada, setSelecionada] = useState<VariacaoParaMovimento | null>(null);

  const [localId, setLocalId] = useState('');
  const [localDestinoId, setLocalDestinoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [custoUnitario, setCustoUnitario] = useState('');
  const [tipo, setTipo] = useState('ENTRADA_COMPRA');
  const [justificativa, setJustificativa] = useState('');
  const [documentoNumero, setDocumentoNumero] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<Sucesso | null>(null);

  // O leitor de código de barras digita e dá Enter. O campo precisa estar
  // focado desde a abertura, senão a primeira leitura se perde.
  useEffect(() => {
    campoBusca.current?.focus();
  }, []);

  useEffect(() => {
    setTipo(operacao === 'saida' ? 'SAIDA_PERDA' : 'ENTRADA_COMPRA');
    setErro(null);
  }, [operacao]);

  const locais = useQuery({
    queryKey: ['estoque', 'locais'],
    queryFn: () => pedir<LocalResumo[]>('/estoque/locais'),
    staleTime: 5 * 60_000,
  });

  const busca = useQuery({
    queryKey: ['estoque', 'variacoes', termo],
    queryFn: () =>
      pedir<VariacaoParaMovimento[]>(`/estoque/variacoes?termo=${encodeURIComponent(termo)}`),
    enabled: termo.trim().length >= 2,
  });

  // Código de barras casou exatamente: seleciona sozinho, sem clique. É o que
  // torna o leitor útil — parar para escolher numa lista de um item só anula
  // o ganho de ter lido o código.
  useEffect(() => {
    const unico = busca.data;
    if (unico?.length === 1 && unico[0]?.casouCodigoBarras) {
      setSelecionada(unico[0]);
      setTermo('');
    }
  }, [busca.data]);

  /**
   * O item selecionado, relido do servidor.
   *
   * `selecionada` é a foto do momento da busca. Quem lança três entradas
   * seguidas veria "saldo atual" congelado no valor de antes da primeira — e
   * decidiria a próxima quantidade por um número errado. Esta consulta entra
   * na mesma chave `['estoque', …]` que a gravação invalida, então o saldo se
   * atualiza sozinho depois de cada lançamento, inclusive os de outra pessoa.
   */
  const atualizada = useQuery({
    queryKey: ['estoque', 'variacoes', selecionada?.sku ?? ''],
    queryFn: () =>
      pedir<VariacaoParaMovimento[]>(
        `/estoque/variacoes?termo=${encodeURIComponent(selecionada?.sku ?? '')}`,
      ),
    enabled: Boolean(selecionada),
    select: (lista) => lista.find((v) => v.id === selecionada?.id) ?? null,
  });

  const item = atualizada.data ?? selecionada;

  const enviar = useMutation({
    mutationFn: async () => {
      if (!selecionada) throw new Error('sem item');

      const local = locais.data?.find((l) => l.id === localId);
      if (!local) throw new Error('sem local');

      const comum = { variacaoId: selecionada.id, lojaId: local.lojaId, localId: local.id };

      if (operacao === 'entrada') {
        return pedir<ResultadoMovimento>('/estoque/entrada', {
          method: 'POST',
          body: {
            ...comum,
            quantidade,
            custoUnitario: custoUnitario || '0',
            tipo,
            ...(documentoNumero ? { documentoNumero } : {}),
            ...(justificativa ? { justificativa } : {}),
          },
        });
      }

      if (operacao === 'saida') {
        return pedir<ResultadoMovimento>('/estoque/saida', {
          method: 'POST',
          body: { ...comum, quantidade, tipo, justificativa },
        });
      }

      if (operacao === 'contagem') {
        return pedir<ResultadoMovimento | { semDiferenca: true }>('/estoque/contagem', {
          method: 'POST',
          body: {
            ...comum,
            quantidadeContada: quantidade,
            ...(justificativa ? { justificativa } : {}),
          },
        });
      }

      const destino = locais.data?.find((l) => l.id === localDestinoId);
      if (!destino) throw new Error('sem destino');

      return pedir<ResultadoTransferencia>('/estoque/transferencia', {
        method: 'POST',
        body: {
          variacaoId: selecionada.id,
          lojaOrigemId: local.lojaId,
          localOrigemId: local.id,
          lojaDestinoId: destino.lojaId,
          localDestinoId: destino.id,
          quantidade,
          ...(justificativa ? { justificativa } : {}),
        },
      });
    },
    onSuccess: async (resposta) => {
      setErro(null);

      if (resposta && 'semDiferenca' in resposta) {
        setSucesso({
          titulo: 'Contagem confere',
          detalhe: 'O sistema já estava com essa quantidade. Nenhum movimento foi gerado.',
          avisos: [],
        });
      } else if (resposta && 'saida' in resposta) {
        setSucesso({
          titulo: 'Transferência registrada',
          detalhe: `${resposta.saida.local} ficou com ${Number(resposta.saida.saldoPosterior)} · ${resposta.entrada.local} ficou com ${Number(resposta.entrada.saldoPosterior)}`,
          avisos: resposta.avisos,
        });
      } else if (resposta) {
        setSucesso({
          titulo: 'Movimento registrado',
          detalhe: `O saldo do local ficou em ${Number(resposta.saldoPosterior)}.`,
          avisos: resposta.avisos,
        });
      }

      setQuantidade('');
      setCustoUnitario('');
      setJustificativa('');
      setDocumentoNumero('');

      await Promise.all([
        fila.invalidateQueries({ queryKey: ['estoque'] }),
        fila.invalidateQueries({ queryKey: ['produtos'] }),
      ]);
    },
    onError: (e) => {
      setSucesso(null);
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
    },
  });

  const local = locais.data?.find((l) => l.id === localId);
  const saldoNoLocal = item?.saldosPorLocal.find((s) => s.localId === localId);

  const podeEnviar =
    Boolean(selecionada) &&
    Boolean(localId) &&
    quantidade.trim().length > 0 &&
    (operacao !== 'saida' || justificativa.trim().length >= 5) &&
    (operacao !== 'transferencia' || (Boolean(localDestinoId) && localDestinoId !== localId));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-neutral-900/30">
      <button
        type="button"
        aria-label="Fechar"
        className="flex-1 cursor-default"
        onClick={aoFechar}
      />

      <div
        role="dialog"
        aria-label="Movimentar estoque"
        className="flex h-full w-[520px] flex-col bg-white shadow-2xl"
      >
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-neutral-100 px-5">
          <h2 className="font-display text-[16px] font-semibold text-neutral-900">
            Movimentar estoque
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar painel"
            className="flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-50"
          >
            ✕
          </button>
        </header>

        <div className="flex gap-1 border-b border-neutral-100 px-5 py-2.5">
          {disponiveis.map((o) => (
            <button
              key={o.chave}
              type="button"
              aria-pressed={operacao === o.chave}
              onClick={() => setOperacao(o.chave)}
              className={juntar(
                'h-[32px] rounded-full px-3 text-[12.5px] font-medium',
                operacao === o.chave
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100',
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
          {sucesso ? (
            <Aviso tom="sucesso" titulo={sucesso.titulo}>
              {sucesso.detalhe}
              {sucesso.avisos.length > 0 ? (
                <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4">
                  {sucesso.avisos.map((a) => (
                    <li key={a.codigo}>{a.mensagem}</li>
                  ))}
                </ul>
              ) : null}
            </Aviso>
          ) : null}

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível concluir">
              {erro}
            </Aviso>
          ) : null}

          {/* Item */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
              Item
            </span>

            {item ? (
              <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-25 p-2.5">
                <div className="size-11 shrink-0 overflow-hidden rounded bg-primary-50">
                  {item.imagemPrincipalId ? (
                    <Foto
                      imagemId={item.imagemPrincipalId}
                      alt={item.produto}
                      className="size-full"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-neutral-900">
                    {item.produto}
                  </p>
                  <p className="truncate font-mono text-[11.5px] text-neutral-500">
                    {item.sku} · {item.descricao}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelecionada(null);
                    setTimeout(() => campoBusca.current?.focus(), 0);
                  }}
                  className="shrink-0 text-[11.5px] font-medium text-neutral-500 underline"
                >
                  trocar
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={campoBusca}
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Leia o código de barras ou digite SKU / nome"
                  aria-label="Buscar item"
                  className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px] placeholder:text-neutral-400"
                />

                {busca.data && busca.data.length > 0 ? (
                  <div className="max-h-[210px] overflow-auto rounded-md border border-neutral-100">
                    {busca.data.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelecionada(v);
                          setTermo('');
                        }}
                        className="flex w-full items-center gap-2.5 border-b border-neutral-50 px-2.5 py-2 text-left last:border-0 hover:bg-neutral-25"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-neutral-900">
                            {v.produto}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-neutral-500">
                            {v.sku} · {v.descricao}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-neutral-500">
                          {v.saldoTotal}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {termo.trim().length >= 2 && busca.isSuccess && busca.data.length === 0 ? (
                  <p className="text-[12.5px] text-neutral-500">Nenhum item encontrado.</p>
                ) : null}
              </>
            )}
          </div>

          {/* Locais */}
          <div className="grid grid-cols-2 gap-3">
            <Selecao
              rotulo={operacao === 'transferencia' ? 'De' : 'Local'}
              valor={localId}
              aoMudar={setLocalId}
              locais={locais.data ?? []}
            />
            {operacao === 'transferencia' ? (
              <Selecao
                rotulo="Para"
                valor={localDestinoId}
                aoMudar={setLocalDestinoId}
                locais={(locais.data ?? []).filter((l) => l.id !== localId)}
              />
            ) : null}
          </div>

          {item && local ? (
            <p className="-mt-2 text-[12.5px] text-neutral-500">
              Saldo atual em {local.loja} · {local.nome}:{' '}
              <strong
                className={juntar(
                  'font-mono',
                  Number(saldoNoLocal?.quantidade ?? 0) < 0
                    ? 'text-[var(--color-perigo)]'
                    : 'text-neutral-900',
                )}
              >
                {saldoNoLocal?.quantidade ?? '0'}
              </strong>
            </p>
          ) : null}

          {/* Quantidade e custo */}
          <div className="grid grid-cols-2 gap-3">
            <Entrada
              rotulo={operacao === 'contagem' ? 'Quantidade contada' : 'Quantidade'}
              valor={quantidade}
              aoMudar={setQuantidade}
              placeholder="0"
              mono
            />
            {operacao === 'entrada' ? (
              <Entrada
                rotulo="Custo unitário"
                valor={custoUnitario}
                aoMudar={setCustoUnitario}
                placeholder="0.00"
                mono
                ajuda="Zero é válido: bonificação"
              />
            ) : null}
          </div>

          {operacao === 'contagem' ? (
            <Aviso tom="info">
              Informe o que foi <strong>contado na prateleira</strong>, não a diferença. O sistema
              calcula o ajuste. Se bater com o saldo, nenhum movimento é gerado.
            </Aviso>
          ) : null}

          {/* Tipo */}
          {operacao === 'entrada' || operacao === 'saida' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Motivo
              </span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
              >
                {(operacao === 'entrada' ? TIPOS_ENTRADA : TIPOS_SAIDA).map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {operacao === 'entrada' ? (
            <Entrada
              rotulo="Documento (opcional)"
              valor={documentoNumero}
              aoMudar={setDocumentoNumero}
              placeholder="NF 12345"
            />
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
              Justificativa{operacao === 'saida' ? '' : ' (opcional)'}
            </span>
            <textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={2}
              placeholder={
                operacao === 'saida'
                  ? 'Obrigatória: por que a mercadoria está saindo sem venda?'
                  : 'Contexto para quem auditar depois'
              }
              className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13.5px] placeholder:text-neutral-400"
            />
            {operacao === 'saida' &&
            justificativa.trim().length > 0 &&
            justificativa.trim().length < 5 ? (
              <span className="text-[11.5px] text-[var(--color-perigo)]">
                Descreva o motivo com ao menos 5 caracteres.
              </span>
            ) : null}
          </label>
        </div>

        <footer className="flex h-[68px] shrink-0 items-center justify-end gap-2 border-t border-neutral-100 px-5">
          <Botao variante="secundario" onClick={aoFechar}>
            Fechar
          </Botao>
          <Botao
            variante="primario"
            disabled={!podeEnviar}
            carregando={enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            Registrar
          </Botao>
        </footer>
      </div>
    </div>
  );
}

function Selecao({
  rotulo,
  valor,
  aoMudar,
  locais,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly locais: readonly LocalResumo[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
        {rotulo}
      </span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px]"
      >
        <option value="">Selecione</option>
        {locais.map((l) => (
          <option key={l.id} value={l.id}>
            {l.loja} · {l.nome}
          </option>
        ))}
      </select>
    </label>
  );
}

function Entrada({
  rotulo,
  valor,
  aoMudar,
  placeholder,
  mono,
  ajuda,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly placeholder?: string;
  readonly mono?: boolean;
  readonly ajuda?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
        {rotulo}
      </span>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        className={juntar(
          'h-[42px] rounded-md border border-neutral-200 bg-white px-3 text-[14px] placeholder:text-neutral-400',
          mono && 'font-mono',
        )}
      />
      {ajuda ? <span className="text-[11.5px] text-neutral-400">{ajuda}</span> : null}
    </label>
  );
}
