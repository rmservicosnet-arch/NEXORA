import { useSessao } from '../auth/sessao';
import { Aviso } from '../ui/Aviso';

export function Inicio() {
  const { usuario } = useSessao();

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Visão geral</span>
      </header>

      <main className="flex flex-1 flex-col gap-5 p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Olá, {usuario?.nome.split(' ')[0]}
          </h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            Fase 1 concluída: isolamento entre empresas, autenticação e permissões.
          </p>
        </div>

        <Aviso tom="info" titulo="O que já funciona de ponta a ponta">
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            <li>Login com Argon2id e sessão restaurada por cookie httpOnly</li>
            <li>Row-Level Security em 36 tabelas — sem contexto, zero linhas</li>
            <li>Permissões e vínculo de loja verificados no servidor</li>
          </ul>
        </Aviso>

        <section className="rounded-md border border-neutral-100 bg-white p-5 shadow-sm">
          <h2 className="font-display text-[15px] font-semibold text-neutral-900">
            Suas permissões
          </h2>
          <p className="mt-1 text-[13px] text-neutral-500">
            {usuario?.permissoes.length} permissões, vindas dos seus perfis. O menu à esquerda mostra
            apenas o que elas liberam.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {usuario?.permissoes.slice(0, 24).map((p) => (
              <span
                key={p}
                className="rounded bg-neutral-50 px-2 py-1 font-mono text-[11px] text-neutral-600"
              >
                {p}
              </span>
            ))}
            {(usuario?.permissoes.length ?? 0) > 24 ? (
              <span className="px-2 py-1 text-[11px] text-neutral-400">
                e mais {(usuario?.permissoes.length ?? 0) - 24}
              </span>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
