import type { EmpresaCriada } from '@estoque/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { juntar } from '../ui/juntar';

/** "Dojo Sul Equipamentos" → "dojo-sul-equipamentos". */
function sugerirSlug(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function Campo({
  rotulo,
  valor,
  aoMudar,
  nota,
  mono = false,
  tipo = 'text',
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly nota?: string;
  readonly mono?: boolean;
  readonly tipo?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
        {rotulo}
      </span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className={juntar(
          'h-9 rounded-md border border-neutral-200 px-2.5 text-[13.5px] text-neutral-900 outline-none focus:border-primary-300',
          mono && 'font-mono',
        )}
      />
      {nota ? <span className="text-[11.5px] leading-4 text-neutral-400">{nota}</span> : null}
    </label>
  );
}

function Passo({
  children,
  detalhe,
  marcado = true,
}: {
  readonly children: React.ReactNode;
  readonly detalhe: string;
  readonly marcado?: boolean;
}) {
  return (
    <li className="flex gap-2.5 py-1.5">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={marcado ? 'var(--color-sucesso)' : 'currentColor'}
        strokeWidth={marcado ? 2.6 : 2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={juntar('mt-0.5 shrink-0', !marcado && 'text-neutral-300')}
        aria-hidden="true"
      >
        {marcado ? (
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        ) : (
          <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M8.5 12h7" />
          </>
        )}
      </svg>
      <span
        className={juntar(
          'text-[12.5px] leading-[18px]',
          marcado ? 'text-neutral-900' : 'text-neutral-500',
        )}
      >
        <strong className="font-semibold">{children}</strong>
        <span className="text-neutral-400"> · {detalhe}</span>
      </span>
    </li>
  );
}

/**
 * Nova empresa.
 *
 * Cria a empresa e o administrador dela — mais os oito perfis de sistema e a
 * linha de configuração, que não são opcionais: sem `ADMIN_EMPRESA` não há
 * perfil para atribuir, e sem a configuração a tela de configuração morre.
 *
 * **Sem loja e sem tabela de preço**, e a tela diz isso em voz alta. A
 * empresa nasce no estado que a tela de Equipe chama de *inerte*: quem entra
 * vê telas vazias até a primeira loja existir. O administrador consegue
 * criá-la, porque `loja.criar` é permissão de empresa e não de loja — mas
 * até lá o sistema parece quebrado, e descobrir isso sozinho é pior do que
 * ler aqui.
 */
export function PlataformaEmpresaNova() {
  const navegar = useNavigate();
  const fila = useQueryClient();

  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [documento, setDocumento] = useState('');
  const [adminNome, setAdminNome] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [criada, setCriada] = useState<EmpresaCriada | null>(null);
  const [copiada, setCopiada] = useState(false);

  const slugEfetivo = slugTocado ? slug : sugerirSlug(nome);

  const criar = useMutation({
    mutationFn: () =>
      pedir<EmpresaCriada>('/plataforma/empresas', {
        method: 'POST',
        body: {
          nome: nome.trim(),
          slug: slugEfetivo,
          ...(documento.trim() ? { documento: documento.trim() } : {}),
          admin: { nome: adminNome.trim(), email: adminEmail.trim() },
        },
      }),
    onSuccess: async (resultado) => {
      setErro(null);
      setCriada(resultado);
      await fila.invalidateQueries({ queryKey: ['plataforma'] });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível criar a empresa.');
    },
  });

  const pronto =
    nome.trim().length >= 2 &&
    slugEfetivo.length >= 2 &&
    adminNome.trim().length >= 2 &&
    adminEmail.includes('@');

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Link
          to="/plataforma"
          className="text-[13.5px] text-neutral-500 no-underline hover:underline"
        >
          Empresas
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-[13.5px] font-medium text-neutral-900">Nova empresa</span>
      </div>

      <div>
        <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
          Nova empresa
        </h1>
        <p className="mt-0.5 text-[13.5px] text-neutral-500">
          A empresa e o administrador dela. O resto quem monta é ele, nas telas de dentro.
        </p>
      </div>

      {erro ? (
        <Aviso tom="perigo" titulo="Não foi possível criar">
          {erro}
        </Aviso>
      ) : null}

      <div className="flex flex-col items-stretch gap-3.5 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              A empresa
            </p>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Campo rotulo="Nome" valor={nome} aoMudar={setNome} />
              <Campo
                rotulo="Slug"
                valor={slugEfetivo}
                mono
                aoMudar={(v) => {
                  setSlugTocado(true);
                  setSlug(v);
                }}
                nota="Sugerido a partir do nome. Dá para ajustar antes de criar — depois, não: ele entra na URL e é único na plataforma."
              />
              <Campo
                rotulo="CNPJ"
                valor={documento}
                aoMudar={setDocumento}
                nota="Opcional. A empresa funciona sem."
              />
            </div>
          </section>

          <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              O administrador dela
            </p>
            <p className="mb-3 mt-0.5 text-[12.5px] text-neutral-400">
              Recebe o perfil{' '}
              <strong className="font-semibold text-neutral-600">Administrador da empresa</strong>,
              que é o teto do RBAC daquela empresa — e não alcança esta tela.
            </p>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Campo rotulo="Nome" valor={adminNome} aoMudar={setAdminNome} />
              <Campo
                rotulo="E-mail"
                valor={adminEmail}
                tipo="email"
                aoMudar={setAdminEmail}
                nota="É o login, e é único entre TODAS as empresas do domínio de funcionário."
              />
            </div>
          </section>

          <Aviso tom="atencao" titulo="A empresa nasce sem loja, e isso tem consequência">
            Sem loja as telas vêm vazias — é o estado que a tela de Equipe chama de <em>inerte</em>.
            O administrador consegue criar a primeira, porque{' '}
            <span className="font-mono text-[12px]">loja.criar</span> é permissão de empresa e não
            de loja. Mas até ele criar, o sistema parece quebrado para quem entra.
          </Aviso>

          {criada ? null : (
            <div className="flex items-center gap-2.5">
              <Botao
                variante="primario"
                carregando={criar.isPending}
                disabled={!pronto}
                onClick={() => {
                  criar.mutate();
                }}
              >
                Criar empresa
              </Botao>
              <Link
                to="/plataforma"
                className="inline-flex h-9 items-center rounded-md border border-neutral-200 px-3.5 text-[13px] text-neutral-700 no-underline"
              >
                Cancelar
              </Link>
            </div>
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[352px]">
          <section className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
              O que vai ser criado
            </p>
            <ul className="m-0 list-none p-0">
              <Passo detalhe="nome, slug e documento">A empresa</Passo>
              <Passo detalhe="uma linha com os padrões — sem ela a tela de configuração morre">
                As configurações
              </Passo>
              <Passo detalhe="com as permissões de docs/, uma a uma">8 perfis de sistema</Passo>
              <Passo detalhe="nome, e-mail e o hash da senha">O administrador</Passo>
              <Passo detalhe="sem ela a senha não autentica">A credencial de login</Passo>
              <Passo detalhe="quem cria a primeira é o administrador" marcado={false}>
                Nenhuma loja
              </Passo>
              <Passo detalhe="idem — e sem ela não há venda" marcado={false}>
                Nenhuma tabela de preço
              </Passo>
            </ul>
            <p className="mt-3 border-t border-neutral-50 pt-2.5 text-[12px] leading-4 text-neutral-400">
              Tudo numa transação só. Empresa gravada sem credencial é empresa em que ninguém entra.
            </p>
          </section>

          {criada ? (
            <section className="rounded-md border border-primary-100 bg-primary-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-primary-800">
                A senha do administrador
              </p>
              <p className="mb-2.5 mt-1 text-[12.5px] leading-[18px] text-primary-800">
                Aparece <strong className="font-semibold">uma vez</strong>. O servidor guarda só o
                hash — poder mostrar de novo significaria ter guardado.
              </p>
              <div className="flex items-center gap-2 rounded-md border border-dashed border-primary-200 bg-white px-2.5 py-2">
                <span className="flex-1 select-all font-mono text-[14px] tracking-[0.02em] text-neutral-900">
                  {criada.senhaProvisoria}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(criada.senhaProvisoria).then(() => {
                      setCopiada(true);
                    });
                  }}
                  className="h-7 shrink-0 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-700"
                >
                  {copiada ? 'Copiada' : 'Copiar'}
                </button>
              </div>
              <p className="mt-2.5 text-[12px] leading-4 text-primary-800">
                Entrega para <strong className="font-semibold">{criada.admin.nome}</strong> (
                {criada.admin.email}). Ao entrar, a primeira coisa dele é criar uma loja.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Botao
                  variante="primario"
                  onClick={() => {
                    navegar(`/plataforma/empresas/${criada.empresa.id}`);
                  }}
                >
                  Abrir a empresa
                </Botao>
                <Link
                  to="/plataforma"
                  className="inline-flex h-9 items-center rounded-md border border-neutral-200 bg-white px-3.5 text-[13px] text-neutral-700 no-underline"
                >
                  Voltar à lista
                </Link>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
