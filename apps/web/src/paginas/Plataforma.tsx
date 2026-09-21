import type { EmpresaResumo, PaginaEmpresas } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { ErroRequisicao, pedir } from '../api/cliente';
import { Aviso } from '../ui/Aviso';
import { Botao } from '../ui/Botao';
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../ui/Estados';
import { juntar } from '../ui/juntar';

/** `1284930.5` → `1.284.930,50`. */
function brl(valor: string): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1 empresa ativa", "3 empresas ativas". O plural segue o numero. */
function contagem(n: number, singular: string, plural: string): string {
  return `${String(n)} ${n === 1 ? singular : plural}`;
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Indicador({
  rotulo,
  valor,
  nota,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-md border border-neutral-100 bg-white p-3.5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {rotulo}
      </p>
      <p className="mt-1 font-display text-[23px] font-bold leading-7 text-neutral-900">{valor}</p>
      <p className="mt-0.5 text-[11.5px] text-neutral-400">{nota}</p>
    </div>
  );
}

const GRADE = 'lg:grid-cols-[minmax(0,1fr)_148px_76px_86px_108px_104px_92px]';

/**
 * As empresas da plataforma.
 *
 * Tudo aqui cruza empresas — é a única parte do sistema que lê fora do RLS, e
 * por isso a leitura passa por funções `SECURITY DEFINER` que devolvem só
 * nome, contagem e situação. Nenhum dado de negócio: quem precisa ver a venda
 * de uma empresa entra pelo suporte, e essa entrada vira linha na auditoria
 * DELA.
 */
export function Plataforma() {
  const consulta = useQuery({
    queryKey: ['plataforma', 'empresas'],
    queryFn: () => pedir<PaginaEmpresas>('/plataforma/empresas'),
  });

  const dados = consulta.data;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[22px] font-bold leading-7 text-neutral-900">
            Empresas
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            Quem existe na plataforma. Suspender bloqueia o login de todo mundo da empresa — não
            apaga nada.
          </p>
        </div>
        <Botao variante="primario" comoFilho>
          <Link to="/plataforma/nova">Nova empresa</Link>
        </Botao>
      </div>

      {dados ? (
        <div className="flex flex-wrap gap-3">
          <Indicador
            rotulo="Empresas"
            valor={String(dados.resumo.empresas)}
            nota={`${contagem(dados.resumo.ativas, 'ativa', 'ativas')}, ${contagem(dados.resumo.suspensas, 'suspensa', 'suspensas')}`}
          />
          <Indicador
            rotulo="Usuários"
            valor={String(dados.resumo.usuariosAtivos)}
            nota={`${dados.resumo.ativas === 1 ? 'na' : 'nas'} ${contagem(dados.resumo.ativas, 'empresa ativa', 'empresas ativas')}`}
          />
          <Indicador
            rotulo="Lojas"
            valor={String(dados.resumo.lojasAtivas)}
            nota={`${dados.resumo.ativas === 1 ? 'na' : 'nas'} ${contagem(dados.resumo.ativas, 'empresa ativa', 'empresas ativas')}`}
          />
          <Indicador
            rotulo="Vendas em 30 dias"
            valor={`R$ ${brl(dados.resumo.vendido30d)}`}
            nota={`${dados.resumo.ativas === 1 ? 'na' : 'nas'} ${contagem(dados.resumo.ativas, 'empresa ativa', 'empresas ativas')}`}
          />
        </div>
      ) : null}

      <Aviso tom="atencao" titulo="Tudo nesta tela cruza empresas">
        É a única parte do sistema que lê fora do RLS, e por isso cada ação vira registro em{' '}
        <span className="font-mono text-[12px]">audit_log</span> da empresa afetada — visível para
        ela, não só para quem entrou.
      </Aviso>

      {consulta.isPending ? <EstadoCarregando titulo="Carregando as empresas…" /> : null}

      {consulta.isError ? (
        <EstadoErro
          titulo="Não foi possível listar as empresas"
          descricao={
            consulta.error instanceof ErroRequisicao
              ? consulta.error.corpo.mensagem
              : 'Tente novamente em instantes.'
          }
          aoTentarNovamente={() => void consulta.refetch()}
        />
      ) : null}

      {dados && dados.itens.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma empresa ainda"
          descricao="Crie a primeira. Ela nasce com o administrador dela e a senha aparece uma vez."
        />
      ) : null}

      {dados && dados.itens.length > 0 ? (
        <section className="flex flex-col overflow-hidden rounded-md border border-neutral-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-full lg:min-w-[900px]">
              <div
                className={juntar(
                  'hidden gap-3 border-b border-neutral-100 bg-neutral-25 px-4 py-2.5 lg:grid',
                  GRADE,
                )}
              >
                {['Empresa', 'Documento', 'Lojas', 'Usuários', 'Criada em', 'Situação', ''].map(
                  (c, i) => (
                    <span
                      key={`${c}-${String(i)}`}
                      className={juntar(
                        'text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500',
                        (c === 'Lojas' || c === 'Usuários') && 'text-right',
                      )}
                    >
                      {c}
                    </span>
                  ),
                )}
              </div>

              {dados.itens.map((e) => (
                <Linha key={e.id} empresa={e} />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t-2 border-neutral-200 bg-neutral-25 px-4 py-3">
            <span className="text-[12.5px] font-semibold text-neutral-700">
              {contagem(dados.itens.length, 'empresa', 'empresas')}
            </span>
            <span className="text-[12.5px] text-neutral-400">
              · {contagem(dados.resumo.ativas, 'ativa', 'ativas')},{' '}
              {contagem(dados.resumo.suspensas, 'suspensa', 'suspensas')}
            </span>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Linha({ empresa }: { readonly empresa: EmpresaResumo }) {
  const ativa = empresa.status === 'ATIVO';

  return (
    <div
      className={juntar(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-50 px-4 py-2.5 lg:grid',
        GRADE,
        !ativa && 'bg-[#fdf5f5]',
      )}
    >
      <span className="min-w-0 flex-1 lg:flex-none">
        <span className="block truncate text-[13px] text-neutral-900">{empresa.nome}</span>
        <span className="block truncate font-mono text-[11px] text-neutral-400">
          {empresa.slug}
        </span>
      </span>

      <span className="font-mono text-[12px] text-neutral-500">{empresa.documento ?? '—'}</span>

      {/*
        Zero loja não é só um número: a empresa entra e as telas vêm vazias.
        É o estado que a tela de Equipe chama de inerte, visto de fora.
      */}
      <span
        className={juntar(
          'text-right font-mono text-[13px]',
          empresa.lojas === 0 ? 'text-[var(--color-perigo)]' : 'text-neutral-900',
        )}
        title={empresa.lojas === 0 ? 'Sem loja, as telas desta empresa vêm vazias' : undefined}
      >
        {empresa.lojas}
      </span>

      <span className="text-right font-mono text-[13px] text-neutral-900">{empresa.usuarios}</span>

      <span className="text-[12.5px] text-neutral-500">{data(empresa.criadoEm)}</span>

      <span>
        <span
          className={juntar(
            'inline-flex h-5 items-center rounded-full px-2.5 text-[11px] font-semibold',
            ativa ? 'bg-[#e6f1eb] text-[#155537]' : 'bg-[#fdf5f5] text-[var(--color-perigo)]',
          )}
        >
          {ativa ? 'Ativa' : 'Suspensa'}
        </span>
      </span>

      <span className="ml-auto lg:ml-0 lg:text-right">
        <Link
          to={`/plataforma/empresas/${empresa.id}`}
          className="inline-flex h-7 items-center rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-700 no-underline hover:border-neutral-300"
        >
          Abrir
        </Link>
      </span>
    </div>
  );
}
