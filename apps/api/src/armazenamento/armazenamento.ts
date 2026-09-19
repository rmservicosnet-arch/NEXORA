/**
 * Contrato de armazenamento de objetos.
 *
 * A API **nunca** recebe o binário no corpo de um endpoint de negócio. O fluxo
 * é o de docs/MEDIA.md §4: o servidor autoriza, o cliente envia direto para o
 * armazenamento, o servidor confirma.
 *
 * O driver local existe para desenvolvimento e para quem roda em uma máquina
 * só. Ele imita o mesmo fluxo — inclusive a URL de curta duração — em vez de
 * expor um `POST` multipart mais simples. A razão é dura: se o modo local
 * tiver um contrato diferente, trocar para S3 não é trocar um provedor, é
 * reescrever a tela, o aplicativo e os testes.
 */

export interface DestinoDeEnvio {
  /** Para onde o cliente faz o PUT do arquivo. */
  readonly url: string;
  readonly metodo: 'PUT';
  readonly cabecalhos: Record<string, string>;
  readonly expiraEm: string;
}

export interface OpcoesDeEnvio {
  readonly chave: string;
  readonly tipo: string;
  readonly bytes: number;
  readonly validadeSegundos: number;
}

export abstract class Armazenamento {
  /** Autoriza um envio. Não toca no arquivo. */
  abstract destinoDeEnvio(opcoes: OpcoesDeEnvio): Promise<DestinoDeEnvio>;

  abstract gravar(chave: string, conteudo: Uint8Array, tipo: string): Promise<void>;

  abstract ler(chave: string): Promise<Uint8Array>;

  abstract existe(chave: string): Promise<boolean>;
}

/**
 * Monta a chave do objeto.
 *
 * **Sempre no servidor, a partir do tenant da sessão.** Aceitar a chave do
 * cliente permitiria escrever no prefixo de outra empresa — seria desfazer no
 * armazenamento a separação que o RLS garante no banco. docs/MEDIA.md §1.
 */
export function montarChave(
  tenantId: string,
  produtoId: string,
  imagemId: string,
  variante: string,
  extensao: string,
): string {
  return `tenants/${tenantId}/produtos/${produtoId}/${imagemId}/${variante}.${extensao}`;
}

export const EXTENSAO_POR_TIPO: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
