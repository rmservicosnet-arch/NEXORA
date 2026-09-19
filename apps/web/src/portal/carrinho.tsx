import type { ItemCatalogo } from '@estoque/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * O que o carrinho guarda de cada item.
 *
 * O preço e a disponibilidade aqui são **retrato do momento em que o item foi
 * escolhido**, para a lista não ficar muda. Nenhuma decisão se apoia neles: a
 * tela do carrinho relê os dois do servidor, e quem dá o preço final é o
 * checkout, contra a tabela do cliente. Guardar e reusar foi a armadilha que
 * já mordeu este repositório — ver a tabela do CLAUDE.md.
 */
export interface ItemCarrinho {
  readonly variacaoId: string;
  readonly sku: string;
  readonly produto: string;
  readonly descricaoVariacao: string;
  readonly imagemPrincipalId: string | null;
  readonly precoVisto: string;
  readonly quantidade: number;
}

interface ValorCarrinho {
  readonly itens: readonly ItemCarrinho[];
  readonly total: number;
  readonly adicionar: (item: ItemCatalogo, quantidade?: number) => void;
  readonly definirQuantidade: (variacaoId: string, quantidade: number) => void;
  readonly remover: (variacaoId: string) => void;
  readonly esvaziar: () => void;
}

const Contexto = createContext<ValorCarrinho | null>(null);

/**
 * A chave inclui o id do cliente.
 *
 * Sem isso, o carrinho de quem saiu apareceria para quem entrasse depois no
 * mesmo navegador — e num portal B2B "o mesmo navegador" é o computador do
 * balcão da academia, com várias pessoas.
 */
function chave(clienteId: string): string {
  return `estoque:carrinho:${clienteId}`;
}

function ler(clienteId: string): ItemCarrinho[] {
  try {
    const cru = localStorage.getItem(chave(clienteId));
    return cru ? (JSON.parse(cru) as ItemCarrinho[]) : [];
  } catch {
    // Aba anônima, armazenamento bloqueado, JSON corrompido: o carrinho vazio
    // é sempre uma resposta válida. Nada aqui pode derrubar a tela.
    return [];
  }
}

export function ProvedorCarrinho({
  clienteId,
  children,
}: {
  readonly clienteId: string;
  readonly children: ReactNode;
}) {
  const [itens, setItens] = useState<readonly ItemCarrinho[]>(() => ler(clienteId));

  // Trocar de cliente troca o carrinho, sem passar pelo do anterior.
  useEffect(() => {
    setItens(ler(clienteId));
  }, [clienteId]);

  useEffect(() => {
    try {
      localStorage.setItem(chave(clienteId), JSON.stringify(itens));
    } catch {
      // Não poder persistir não pode impedir de comprar.
    }
  }, [clienteId, itens]);

  const adicionar = useCallback((item: ItemCatalogo, quantidade = 1) => {
    setItens((atuais) => {
      const existente = atuais.find((i) => i.variacaoId === item.variacaoId);
      if (existente) {
        return atuais.map((i) =>
          i.variacaoId === item.variacaoId ? { ...i, quantidade: i.quantidade + quantidade } : i,
        );
      }
      return [
        ...atuais,
        {
          variacaoId: item.variacaoId,
          sku: item.sku,
          produto: item.produto,
          descricaoVariacao: item.descricaoVariacao,
          imagemPrincipalId: item.imagemPrincipalId,
          precoVisto: item.preco,
          quantidade,
        },
      ];
    });
  }, []);

  const definirQuantidade = useCallback((variacaoId: string, quantidade: number) => {
    setItens((atuais) =>
      quantidade <= 0
        ? atuais.filter((i) => i.variacaoId !== variacaoId)
        : atuais.map((i) => (i.variacaoId === variacaoId ? { ...i, quantidade } : i)),
    );
  }, []);

  const remover = useCallback((variacaoId: string) => {
    setItens((atuais) => atuais.filter((i) => i.variacaoId !== variacaoId));
  }, []);

  const esvaziar = useCallback(() => {
    setItens([]);
  }, []);

  const total = useMemo(
    () => itens.reduce((soma, i) => soma + Number(i.precoVisto) * i.quantidade, 0),
    [itens],
  );

  const valor = useMemo<ValorCarrinho>(
    () => ({ itens, total, adicionar, definirQuantidade, remover, esvaziar }),
    [itens, total, adicionar, definirQuantidade, remover, esvaziar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useCarrinho(): ValorCarrinho {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error('useCarrinho precisa estar dentro de <ProvedorCarrinho>.');
  }
  return valor;
}
