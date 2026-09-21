import Constants from 'expo-constants';

/**
 * Onde a API mora, do ponto de vista do CELULAR.
 *
 * `localhost` aqui é o próprio aparelho — a armadilha que já mordeu o
 * contêiner: dentro dele, `localhost` era o contêiner. O celular precisa do
 * IP da máquina na rede, e o Expo já o conhece: `hostUri` é o endereço pelo
 * qual o aplicativo carregou o pacote.
 *
 * Em produção vem de `EXPO_PUBLIC_API_URL`, embutido na compilação.
 */
const PORTA_API = 3333;

export function urlDaApi(): string {
  const doAmbiente = process.env['EXPO_PUBLIC_API_URL'];
  if (doAmbiente) {
    return doAmbiente.replace(/\/+$/, '');
  }

  // "192.168.0.14:8081" → "192.168.0.14"
  const host = Constants.expoConfig?.hostUri?.split(':')[0];

  if (!host) {
    /*
      Sem `hostUri` não há como adivinhar: acontece no APK autônomo, que é
      exatamente onde `EXPO_PUBLIC_API_URL` tem de estar definida. Falhar
      alto aqui é melhor do que tentar `localhost` e passar meia hora
      olhando "sem conexão" num aparelho que está perfeitamente conectado.
    */
    throw new Error(
      'Sem EXPO_PUBLIC_API_URL e sem hostUri do Expo: o aplicativo não sabe onde a API está.',
    );
  }

  return `http://${host}:${String(PORTA_API)}/api`;
}
