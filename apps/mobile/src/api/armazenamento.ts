import * as SecureStore from 'expo-secure-store';

/**
 * Onde o refresh token mora no celular.
 *
 * `expo-secure-store` grava no Keystore do Android (e no Keychain do iOS) —
 * não em `AsyncStorage`, que é um arquivo legível por qualquer processo com
 * acesso ao diretório do aplicativo num aparelho com root.
 *
 * É a razão de `docs/MOBILE.md` §4.3 exigir autenticação sem cookie: no web
 * o refresh vive num cookie httpOnly, que o JavaScript da página não lê. No
 * aplicativo não há cookie — o equivalente é o armazenamento do sistema.
 *
 * O token de ACESSO não vem para cá. Ele vive em memória e morre ao fechar o
 * aplicativo, como no web: é curto, e gravá-lo só aumentaria a superfície.
 */

const CHAVE_REFRESH = 'estoque.equipe.refresh';

/**
 * Toda leitura e escrita pode lançar.
 *
 * Aparelho sem tela de bloqueio, perfil de trabalho restrito, Keystore
 * corrompido depois de uma restauração: o armazenamento seguro falha de
 * verdade, e falhar aqui não pode derrubar o aplicativo. Sem ele a sessão
 * simplesmente não sobrevive ao fechamento — que é pior, não fatal.
 */
export async function guardarRefresh(token: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(CHAVE_REFRESH, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
    return true;
  } catch {
    return false;
  }
}

export async function lerRefresh(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CHAVE_REFRESH);
  } catch {
    return null;
  }
}

export async function apagarRefresh(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CHAVE_REFRESH);
  } catch {
    // Sair não pode falhar por causa do armazenamento. O token de acesso já
    // foi descartado da memória, e o servidor revoga a família no `logout`.
  }
}
