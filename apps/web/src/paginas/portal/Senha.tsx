import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { ErroRequisicao, pedir } from '../../api/cliente';
import { useSessaoPortal } from '../../auth/sessaoPortal';
import { Aviso } from '../../ui/Aviso';
import { Botao } from '../../ui/Botao';
import { Campo } from '../../ui/Campo';

const MINIMO = 10;

/** Chave do recado de uma vez só, lido e apagado pela tela de entrada. */
export const RECADO = 'estoque:portal:recado';

export function PortalSenha() {
  const { sair } = useSessaoPortal();
  const navegar = useNavigate();

  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const trocar = useMutation({
    mutationFn: () =>
      pedir<void>('/portal/auth/senha', {
        method: 'POST',
        body: { senhaAtual: atual, novaSenha: nova },
      }),
    /**
     * A troca derruba todas as sessões, inclusive esta — é o desenho, não um
     * efeito colateral. Em vez de deixar a tela quebrar na próxima
     * requisição, o portal sai por conta própria e manda entrar de novo.
     */
    onSuccess: async () => {
      // O recado vai por `sessionStorage`, não pelo estado da navegação.
      //
      // Quando a sessão cai, o guard do `PortalShell` redireciona para o
      // login com o estado DELE — e sobrescreve o nosso antes de a navegação
      // daqui acontecer. Quem perde a corrida é a mensagem, e a tela parece
      // uma sessão que caiu sozinha.
      try {
        sessionStorage.setItem(RECADO, 'Senha alterada. Entre com a nova.');
      } catch {
        // Armazenamento bloqueado não pode impedir a troca de senha.
      }
      await sair();
      void navegar('/portal/entrar', { replace: true });
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível trocar a senha.');
    },
  });

  const curta = nova.length > 0 && nova.length < MINIMO;
  const diferentes = confirmacao.length > 0 && nova !== confirmacao;
  const pronto = atual.length > 0 && nova.length >= MINIMO && nova === confirmacao;

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    trocar.mutate();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/portal" className="text-[13px] text-neutral-500 no-underline hover:underline">
          Portal
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-[13.5px] font-medium text-neutral-900">Minha senha</span>
      </div>

      <section className="flex max-w-[460px] flex-col gap-4 rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-[18px] font-bold text-neutral-900">Trocar a senha</h1>
          <p className="text-[12.5px] leading-[18px] text-neutral-500">
            Você precisa da senha atual mesmo já estando dentro — é o que impede alguém de trocá-la
            numa aba esquecida aberta no balcão.
          </p>
        </div>

        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível trocar">
            {erro}
          </Aviso>
        ) : null}

        <form onSubmit={aoEnviar} className="flex flex-col gap-3.5">
          <Campo
            rotulo="Senha atual"
            type="password"
            autoComplete="current-password"
            required
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
          />

          <Campo
            rotulo="Nova senha"
            type="password"
            autoComplete="new-password"
            required
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            ajuda={`Ao menos ${String(MINIMO)} caracteres. Comprimento importa mais que símbolo.`}
            {...(curta ? { erro: `Faltam ${String(MINIMO - nova.length)} caracteres` } : {})}
          />

          <Campo
            rotulo="Repita a nova senha"
            type="password"
            autoComplete="new-password"
            required
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            {...(diferentes ? { erro: 'As duas não são iguais' } : {})}
          />

          <Botao
            type="submit"
            variante="primario"
            tamanho="pdv"
            disabled={!pronto}
            carregando={trocar.isPending}
          >
            Trocar senha
          </Botao>
        </form>

        <p className="text-[12px] leading-[17px] text-neutral-500">
          Ao trocar, todos os aparelhos conectados a esta conta são desconectados — inclusive este.
        </p>
      </section>
    </>
  );
}
