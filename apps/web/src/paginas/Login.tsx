import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { ErroRequisicao } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { Marca } from '../layout/Marca';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

function Olho() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OlhoFechado() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6" />
      <path d="M21.5 10.5c.3.5.5 1 .5 1.5 0 0-3.6 7-10 7-1.3 0-2.5-.3-3.5-.7" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

export function Login() {
  const { usuario, restaurando, entrar } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [manterConectado, setManterConectado] = useState(true);
  const [comoRecuperar, setComoRecuperar] = useState(false);

  if (restaurando) {
    return <div className="min-h-dvh bg-neutral-25" />;
  }

  if (usuario) {
    return <Navigate to="/" replace />;
  }

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await entrar(email, senha, manterConectado);
      const destino = (local.state as { de?: string } | null)?.de ?? '/';
      void navegar(destino, { replace: true });
    } catch (falha) {
      if (falha instanceof ErroRequisicao && falha.status === 429) {
        setErro('Muitas tentativas. Aguarde um minuto e tente de novo.');
      } else if (falha instanceof ErroRequisicao) {
        setErro(falha.corpo.mensagem);
      } else {
        setErro('Não foi possível conectar ao servidor.');
      }
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[600px] shrink-0 flex-col justify-between bg-primary-800 p-14 lg:flex">
        <Marca claro />

        <div className="flex max-w-[460px] flex-col gap-5">
          <h1 className="font-display text-[40px] font-bold leading-[46px] text-white">
            Toda a operação da loja em um só lugar.
          </h1>
          <p className="text-[16px] leading-[26px] text-primary-200">
            Estoque multi-loja, PDV, catálogo e financeiro — com rastreabilidade completa de cada
            movimentação.
          </p>
        </div>

        <ul className="flex flex-col gap-3.5">
          {[
            'Multiempresa e multi-loja',
            'Custo médio ponderado auditável',
            'Caixa e comissão por vendedor',
          ].map((item) => (
            <li key={item} className="flex items-center gap-3 text-[14px] text-primary-100">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-primary-300)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex flex-1 items-center justify-center p-8">
        <div className="flex w-[404px] max-w-full flex-col gap-7">
          <div className="lg:hidden">
            <Marca />
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-[27px] font-bold leading-8 text-neutral-900">
              Entrar
            </h2>
            <p className="text-[14px] leading-5 text-neutral-500">
              Use as credenciais fornecidas pelo administrador da sua empresa.
            </p>
          </div>

          {erro ? (
            <Aviso tom="perigo" titulo="Não foi possível entrar">
              {erro}
            </Aviso>
          ) : null}

          <form onSubmit={(e) => void aoEnviar(e)} className="flex flex-col gap-4">
            <Campo
              rotulo="E-mail"
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@suaempresa.com.br"
            />

            <Campo
              rotulo="Senha"
              type={mostrarSenha ? 'text' : 'password'}
              name="senha"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              acessorio={
                <button
                  type="button"
                  onClick={() => setComoRecuperar((v) => !v)}
                  className="text-[13px] font-medium text-primary-600 hover:underline"
                >
                  Esqueci minha senha
                </button>
              }
              sufixo={
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  className="flex size-[34px] items-center justify-center rounded text-neutral-500 hover:text-neutral-900"
                >
                  {mostrarSenha ? <OlhoFechado /> : <Olho />}
                </button>
              }
            />

            {/*
              Não há recuperação por e-mail: quem redefine é o administrador,
              e o servidor mostra a senha nova uma única vez. Dizer isso é
              melhor do que um link que não leva a lugar nenhum.
            */}
            {comoRecuperar ? (
              <Aviso tom="info" titulo="A senha é redefinida pelo administrador">
                Peça a quem administra a sua empresa. Ele gera uma senha nova, que aparece uma vez
                na tela dele — nem ele consegue vê-la de novo depois.
              </Aviso>
            ) : null}

            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-neutral-700">
              <input
                type="checkbox"
                checked={manterConectado}
                onChange={(e) => setManterConectado(e.target.checked)}
                className="size-4 accent-[var(--color-primary-600)]"
              />
              Manter conectado neste dispositivo
            </label>

            <Botao type="submit" variante="primario" tamanho="pdv" carregando={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </Botao>
          </form>

          <Aviso tom="info">
            Sua empresa é identificada automaticamente pelo seu usuário — você não precisa
            informá-la.
          </Aviso>

          <p className="text-center font-mono text-[12px] text-neutral-400">v0.1.0 · Fase 1</p>
        </div>
      </main>
    </div>
  );
}
