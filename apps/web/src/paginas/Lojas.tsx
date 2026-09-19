import type { LojaResumo } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';

import { ErroRequisicao, pedir } from '../api/cliente';
import { useSessao } from '../auth/sessao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';

export function Lojas() {
  const { usuario } = useSessao();

  const consulta = useQuery({
    queryKey: ['lojas'],
    queryFn: () => pedir<LojaResumo[]>('/lojas'),
  });

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-neutral-100 bg-white px-6">
        <span className="text-[13.5px] font-medium text-neutral-900">Lojas</span>
        <div className="flex-1" />
        <span className="text-[12.5px] text-neutral-500">
          {usuario?.lojaIds.length === 1
            ? 'Você tem vínculo com 1 loja'
            : `Você tem vínculo com ${usuario?.lojaIds.length ?? 0} lojas`}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">Lojas</h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            Apenas as lojas às quais você tem vínculo. Permissão diz o que você pode fazer; vínculo
            diz onde.
          </p>
        </div>

        <section className="min-h-0 flex-1 overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          {consulta.isPending ? <EstadoCarregando titulo="Carregando lojas…" /> : null}

          {consulta.isError ? (
            <EstadoErro
              titulo="Não foi possível carregar as lojas"
              descricao={
                consulta.error instanceof ErroRequisicao
                  ? consulta.error.corpo.mensagem
                  : 'Verifique se a API está no ar.'
              }
              aoTentarNovamente={() => void consulta.refetch()}
            />
          ) : null}

          {consulta.isSuccess && consulta.data.length === 0 ? (
            <EstadoVazio
              titulo="Nenhuma loja vinculada"
              descricao="Peça ao administrador da empresa para vincular seu usuário a uma loja."
            />
          ) : null}

          {consulta.isSuccess && consulta.data.length > 0 ? (
            <>
              <div className="grid h-9 grid-cols-[120px_minmax(0,1fr)_100px] items-center gap-3 border-b border-neutral-100 bg-neutral-25 px-4">
                {['Código', 'Nome', 'Locais'].map((titulo, i) => (
                  <span
                    key={titulo}
                    className={`text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 ${
                      i === 2 ? 'text-right' : ''
                    }`}
                  >
                    {titulo}
                  </span>
                ))}
              </div>

              {consulta.data.map((loja) => (
                <div
                  key={loja.id}
                  className="grid h-11 grid-cols-[120px_minmax(0,1fr)_100px] items-center gap-3 border-b border-neutral-50 px-4"
                >
                  <span className="font-mono text-[12.5px] text-neutral-600">{loja.codigo}</span>
                  <span className="truncate text-[13.5px] text-neutral-900">{loja.nome}</span>
                  <span className="tabular text-right font-mono text-[13px] text-neutral-900">
                    {loja.locais}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </section>
      </main>
    </>
  );
}
