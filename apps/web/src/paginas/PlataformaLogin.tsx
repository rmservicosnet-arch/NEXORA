import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';

import { ErroRequisicao } from '../api/cliente';
import { useSessaoPlataforma } from '../auth/sessaoPlataforma';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';

/**
 * A porta da plataforma.
 *
 * Deliberadamente diferente da tela de funcionário: fundo escuro, sem a
 * coluna de propaganda, com o selo "Plataforma" ao lado da marca. Duas telas
 * de login parecidas, uma recusando a senha da outra, mandariam quem erra a
 * porta desconfiar da própria senha — e foi exatamente o que aconteceu antes
 * desta tela existir.
 *
 * A recusa também não distingue e-mail inexistente de senha errada. Quem
 * administra a plataforma é um alvo melhor do que qualquer usuário de
 * empresa: o diretório dela não ajuda ninguém a descobrir quem existe.
 */
export function PlataformaLogin() {
  const { admin, restaurando, entrar } = useSessaoPlataforma();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (restaurando) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#151C40]">
        <p className="text-[13.5px] text-[#B9C1E6]">Carregando…</p>
      </main>
    );
  }

  if (admin) {
    return <Navigate to="/plataforma" replace />;
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
    } catch (e) {
      setErro(
        e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível entrar. Tente de novo.',
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#151C40] px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 34 34" fill="none" aria-hidden="true">
            <rect
              x="1.25"
              y="1.25"
              width="31.5"
              height="31.5"
              rx="7"
              stroke="#FFFFFF"
              strokeWidth="2.6"
            />
            <path
              d="M9 12.5 L17 8 L25 12.5 L25 21.5 L17 26 L9 21.5 Z"
              stroke="#FFFFFF"
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-[17px] font-bold text-white">Estoque</span>
          <span className="inline-flex h-[22px] items-center rounded-full bg-[#3A4784] px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-white">
            Plataforma
          </span>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-lg">
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Administração da plataforma
          </h1>
          <p className="mt-1 text-[13.5px] leading-5 text-neutral-500">
            Este acesso é de quem administra <strong className="font-semibold">todas</strong> as
            empresas. Se você trabalha em uma delas, sua entrada é a outra — a senha daqui não serve
            lá, e a de lá não serve aqui.
          </p>

          {erro ? (
            <div className="mt-4">
              <Aviso tom="perigo" titulo="Não foi possível entrar">
                {erro}
              </Aviso>
            </div>
          ) : null}

          <form onSubmit={(e) => void enviar(e)} className="mt-5 flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                E-mail
              </span>
              <input
                type="email"
                value={email}
                autoFocus
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 rounded-md border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none focus:border-primary-400"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-neutral-600">
                Senha
              </span>
              <input
                type="password"
                value={senha}
                autoComplete="current-password"
                onChange={(e) => setSenha(e.target.value)}
                className="h-10 rounded-md border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none focus:border-primary-400"
              />
            </label>

            <Botao
              type="submit"
              variante="primario"
              carregando={enviando}
              disabled={email.trim().length < 3 || senha.length === 0}
            >
              Entrar
            </Botao>
          </form>
        </div>

        <p className="mt-4 text-center text-[12px] leading-4 text-[#8B98D4]">
          O primeiro administrador é criado pelo servidor, com{' '}
          <code className="font-mono">npm run plataforma:admin</code>. A senha aparece uma vez e só
          o hash fica guardado.
        </p>
      </div>
    </main>
  );
}
