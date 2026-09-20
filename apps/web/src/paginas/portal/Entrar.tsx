import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { ErroRequisicao } from '../../api/cliente';
import { useSessaoPortal } from '../../auth/sessaoPortal';
import { Marca } from '../../layout/Marca';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { Campo } from '../../ui/Campo';
import { RECADO } from './Senha';

export function PortalEntrar() {
  const { cliente, restaurando, entrar } = useSessaoPortal();
  const navegar = useNavigate();
  const local = useLocation();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  // Quem acabou de trocar a senha chega aqui deslogado de propósito; sem
  // isto a tela parece uma sessão que caiu sozinha. Lido uma vez e apagado.
  const [recado] = useState(() => {
    try {
      const guardado = sessionStorage.getItem(RECADO);
      sessionStorage.removeItem(RECADO);
      return guardado;
    } catch {
      return null;
    }
  });
  const [enviando, setEnviando] = useState(false);

  if (restaurando) {
    return <div className="min-h-dvh bg-neutral-25" />;
  }

  if (cliente) {
    return <Navigate to="/portal" replace />;
  }

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await entrar(email, senha);
      const destino = (local.state as { de?: string } | null)?.de ?? '/portal';
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
    <main className="flex min-h-dvh items-center justify-center bg-neutral-25 p-5">
      <div className="flex w-[404px] max-w-full flex-col gap-7">
        <Marca />

        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[27px] font-bold leading-8 text-neutral-900">
            Portal do cliente
          </h1>
          <p className="text-[14px] leading-5 text-neutral-500">
            Monte seu pedido e acompanhe a confirmação da loja.
          </p>
        </div>

        {recado ? <Aviso tom="sucesso">{recado}</Aviso> : null}

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
            type="password"
            name="senha"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />

          <Botao type="submit" variante="primario" tamanho="pdv" carregando={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>

        <Aviso tom="info">
          Este acesso é o do seu cadastro na loja. Ele é diferente do acesso da equipe.
        </Aviso>
      </div>
    </main>
  );
}
