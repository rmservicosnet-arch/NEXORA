import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { pedirBlob } from '../api/cliente';
import { juntar } from './juntar';

/**
 * Imagem servida pela API autenticada.
 *
 * O binário vem por `fetch` com o token e vira um `blob:` local. Trocar isso
 * por `<img src="/api/midia/…">` exigiria abrir a rota — e o id da foto
 * passaria a ser a única coisa entre um estranho e o catálogo da loja.
 */
export function Foto({
  imagemId,
  alt,
  className,
  raiz = '/midia',
  seFalhar,
}: {
  readonly imagemId: string;
  readonly alt: string;
  readonly className?: string;
  /**
   * A rota que serve os bytes. O portal do cliente usa `/portal/midia`: outro
   * domínio de autenticação, outro token, e um recorte a menos — o cliente só
   * alcança imagem de produto publicado.
   */
  readonly raiz?: '/midia' | '/portal/midia';
  /**
   * O que desenhar quando os bytes não vierem.
   *
   * Sem isto, a falha aparece em vermelho — e é assim que deve ser nas telas
   * da equipe: foto quebrada é problema dela, e silêncio seria pior. No
   * catálogo do CLIENTE a mesma caixa vira uma parede de erros numa loja, por
   * um defeito que não é dele; ali o item apenas não tem foto para mostrar.
   */
  readonly seFalhar?: React.ReactNode;
}) {
  const [endereco, setEndereco] = useState<string | null>(null);

  const consulta = useQuery({
    // A raiz entra na chave: as duas rotas têm recortes diferentes, e uma
    // chave comum faria a resposta de um domínio servir o outro.
    queryKey: ['midia', raiz, imagemId],
    queryFn: () => pedirBlob(`${raiz}/${imagemId}`),
    // O binário não muda: a mesma imagem tem sempre o mesmo id.
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });

  useEffect(() => {
    if (!consulta.data) {
      return;
    }

    const url = URL.createObjectURL(consulta.data);
    setEndereco(url);

    // Sem revogar, cada remontagem deixa um blob preso na memória da aba até
    // a página recarregar. Numa listagem que rola, isso cresce rápido.
    return () => {
      URL.revokeObjectURL(url);
      setEndereco(null);
    };
  }, [consulta.data]);

  if (consulta.isError && seFalhar !== undefined) {
    return <>{seFalhar}</>;
  }

  if (consulta.isError) {
    return (
      <div
        className={juntar(
          'flex items-center justify-center bg-[var(--color-perigo-fundo)] text-[var(--color-perigo)]',
          className,
        )}
        title="Não foi possível carregar a imagem"
        role="img"
        aria-label={`Falha ao carregar: ${alt}`}
      >
        <span className="text-[10px] font-semibold">erro</span>
      </div>
    );
  }

  if (!endereco) {
    return <div className={juntar('animate-pulse bg-neutral-100', className)} aria-hidden="true" />;
  }

  return <img src={endereco} alt={alt} className={juntar('object-cover', className)} />;
}
