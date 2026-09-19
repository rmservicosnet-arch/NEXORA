import { PERM, type AcessoCliente, type AcessoCriado } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { juntar } from '../ui/juntar';

/**
 * O login do cliente no portal.
 *
 * Um cadastro e um acesso são coisas diferentes: quem compra no balcão nunca
 * precisa entrar. Por isso esta seção existe à parte — e atrás de
 * `cliente.gerenciar_acesso`, que não acompanha `cliente.editar`.
 */
export function AcessosDoCliente({ clienteId }: { readonly clienteId: string }) {
  const { pode } = useSessao();
  const fila = useQueryClient();

  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [revelada, setRevelada] = useState<AcessoCriado | null>(null);
  const [copiada, setCopiada] = useState(false);

  const podeGerenciar = pode(PERM.cliente.gerenciarAcesso);

  const consulta = useQuery({
    queryKey: ['clientes', clienteId, 'acessos'],
    queryFn: () => pedir<AcessoCliente[]>(`/clientes/${clienteId}/acessos`),
    enabled: podeGerenciar,
  });

  function aoFalhar(e: unknown) {
    setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível concluir.');
  }

  async function recarregar() {
    await fila.invalidateQueries({ queryKey: ['clientes'] });
  }

  const criar = useMutation({
    mutationFn: () =>
      pedir<AcessoCriado>(`/clientes/${clienteId}/acessos`, {
        method: 'POST',
        body: { nome: nome.trim(), email: email.trim() },
      }),
    onSuccess: async (r) => {
      setErro(null);
      setCriando(false);
      setNome('');
      setEmail('');
      setCopiada(false);
      setRevelada(r);
      await recarregar();
    },
    onError: aoFalhar,
  });

  const redefinir = useMutation({
    mutationFn: (acessoId: string) =>
      pedir<AcessoCriado>(`/clientes/${clienteId}/acessos/${acessoId}/senha`, { method: 'POST' }),
    onSuccess: async (r) => {
      setErro(null);
      setCopiada(false);
      setRevelada(r);
      await recarregar();
    },
    onError: aoFalhar,
  });

  const alternar = useMutation({
    mutationFn: (a: AcessoCliente) =>
      pedir<AcessoCliente>(`/clientes/${clienteId}/acessos/${a.id}`, {
        method: 'PATCH',
        body: { status: a.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' },
      }),
    onSuccess: async () => {
      setErro(null);
      await recarregar();
    },
    onError: aoFalhar,
  });

  if (!podeGerenciar) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-[15px] font-semibold text-neutral-900">
          Acesso ao portal
        </h2>
        <p className="text-[12px] text-neutral-500">
          Com acesso, o cliente monta o pedido sozinho.
        </p>
      </div>

      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível concluir">
          {erro}
        </Aviso>
      ) : null}

      {/*
        A senha aparece UMA vez.

        Guardá-la em algum lugar para poder mostrar de novo trocaria uma
        inconveniência por um vazamento: o que existe no banco é o hash
        argon2id, e ele não volta. Quem fechar sem copiar gera outra.
      */}
      {revelada ? (
        <div className="flex flex-col gap-2.5 rounded-md border border-[--color-atencao] bg-[--color-atencao-fundo] p-3.5">
          <p className="text-[13px] font-semibold text-neutral-900">
            Senha provisória de {revelada.acesso.nome}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="select-all rounded border border-neutral-200 bg-white px-3 py-2 font-mono text-[16px] tracking-[0.06em] text-neutral-900">
              {revelada.senhaProvisoria}
            </code>
            <Botao
              variante="secundario"
              tamanho="compacto"
              onClick={() => {
                void navigator.clipboard
                  .writeText(revelada.senhaProvisoria)
                  .then(() => setCopiada(true))
                  // Área de transferência bloqueada não pode virar erro: a
                  // senha está na tela, dá para copiar à mão.
                  .catch(() => setCopiada(false));
              }}
            >
              {copiada ? 'Copiada' : 'Copiar'}
            </Botao>
            <Botao variante="fantasma" tamanho="compacto" onClick={() => setRevelada(null)}>
              Já anotei
            </Botao>
          </div>
          <p className="text-[12px] leading-[17px] text-neutral-600">
            Ela não aparece de novo. Entregue ao cliente por um caminho seguro e peça que ele troque
            depois de entrar.
          </p>
        </div>
      ) : null}

      {consulta.data?.length === 0 && !criando ? (
        <p className="text-[13px] text-neutral-500">Este cadastro ainda não entra no portal.</p>
      ) : null}

      {consulta.data && consulta.data.length > 0 ? (
        <div className="flex flex-col">
          {consulta.data.map((a) => (
            <div
              key={a.id}
              className={juntar(
                'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 py-2.5 last:border-0',
                a.status === 'INATIVO' && 'opacity-60',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-neutral-900">{a.nome}</p>
                <p className="truncate text-[11.5px] text-neutral-500">{a.email}</p>
                <p className="text-[11px] text-neutral-400">
                  {a.ultimoLoginEm
                    ? `último acesso em ${new Date(a.ultimoLoginEm).toLocaleDateString('pt-BR')}`
                    : 'nunca entrou'}
                </p>
              </div>

              {a.status === 'INATIVO' ? (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-neutral-600">
                  desligado
                </span>
              ) : null}

              <div className="ml-auto flex gap-2">
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  carregando={redefinir.isPending}
                  onClick={() => redefinir.mutate(a.id)}
                >
                  Nova senha
                </Botao>
                <Botao
                  variante={a.status === 'ATIVO' ? 'perigo' : 'secundario'}
                  tamanho="compacto"
                  onClick={() => alternar.mutate(a)}
                >
                  {a.status === 'ATIVO' ? 'Desligar' : 'Religar'}
                </Botao>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {criando ? (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-neutral-25 p-3.5">
          <Campo
            rotulo="Nome de quem vai entrar"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Prof. Carlos Tanaka"
          />
          <Campo
            rotulo="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="carlos@academia.com.br"
            ajuda="É o login. A senha é gerada pelo sistema — ninguém a escolhe por ele."
          />
          <div className="flex flex-wrap gap-2">
            <Botao
              variante="primario"
              carregando={criar.isPending}
              disabled={nome.trim().length < 2 || !email.includes('@')}
              onClick={() => {
                setErro(null);
                criar.mutate();
              }}
            >
              Criar acesso
            </Botao>
            <Botao variante="secundario" onClick={() => setCriando(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <Botao variante="secundario" onClick={() => setCriando(true)}>
          Criar acesso
        </Botao>
      )}
    </section>
  );
}
