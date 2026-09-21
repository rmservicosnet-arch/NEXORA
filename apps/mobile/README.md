# Aplicativo da equipe — Android

PDV com leitor de código de barras, fila de pedidos e conferência.
React Native 0.87.1 com Expo 57 (ADR-007, `docs/MOBILE.md`).

> **Nada de WebView.** A restrição é inegociável e está em `docs/MOBILE.md`
> §1: o leitor depende de ML Kit nativo, com autofoco e leitura contínua.
> Em `WebView` seria `getUserMedia` mais decodificação em JavaScript — a
> diferença entre um leitor que funciona e um que o vendedor abandona no
> segundo dia.

## O que já funciona

| Tela | O que faz |
|---|---|
| Entrar | Domínio de FUNCIONÁRIO, `canal: 'app'`. O refresh vai para o Keystore |
| Pedidos | A fila, com abas que contam o CONJUNTO, não a página |
| Pedido | Conferência item a item, com justificativa obrigatória acima do disponível |
| Escanear | PDV: leitor, carrinho, avisos de saldo e preço |
| Estoque | "Tem?" por leitura, com saldo POR LOCAL |
| Conta | Quem, onde, e a saída que revoga no servidor |

**O pagamento ainda não.** O carrinho está pronto e a tela diz isso em voz
alta, em vez de oferecer um botão que não leva a lugar nenhum.

## Para compilar nesta máquina

Hoje **não dá**: falta a toolchain. O código está pronto e o `expo prebuild`
está configurado; o que falta é o ambiente.

1. **JDK 17** (o Android Gradle Plugin da RN 0.87 exige 17, não 21)

   ```
   winget install Microsoft.OpenJDK.17
   ```

2. **Android SDK** — pelo Android Studio, ou só as command line tools.
   Depois, com `sdkmanager`:

   ```
   sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
   ```

3. **Variáveis de ambiente**

   ```
   ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
   PATH=%PATH%;%ANDROID_HOME%\platform-tools
   ```

4. **Gerar o projeto nativo e compilar**

   ```
   npm run prebuild -w @estoque/mobile
   npm run android  -w @estoque/mobile
   ```

`android/` e `ios/` são **gerados** e estão no `.gitignore`: o que vale é o
`app.json`. Editar o projeto nativo à mão faz o próximo `prebuild` apagar a
edição — configuração de plugin vai no `app.json`.

## Onde a API mora

O celular **não** alcança `localhost`: ali é o próprio aparelho. Em
desenvolvimento o aplicativo descobre o IP da máquina pelo `hostUri` do Expo
e monta `http://<ip>:3333/api`.

No APK autônomo não há `hostUri`, e aí `EXPO_PUBLIC_API_URL` é obrigatória:

```
EXPO_PUBLIC_API_URL=https://api.suaempresa.com.br/api
```

Sem ela o aplicativo falha alto na abertura, em vez de tentar `localhost` e
deixar alguém meia hora olhando "sem conexão" num aparelho perfeitamente
conectado. A tela de login mostra o endereço em uso — é o que costuma estar
errado na instalação.

## Idempotência

Toda escrita do aplicativo manda `Idempotency-Key`. A chave nasce com a TELA
e **não muda entre tentativas**: é isso que faz o reenvio depois de uma queda
de conexão ser reconhecido como a mesma operação, em vez de virar uma segunda
venda.

`mutations.retry` é `0` de propósito. Quem decide reenviar é a pessoa, com a
mesma chave — repetir automaticamente com chave nova é o defeito que a chave
existe para impedir.

## O que este aplicativo não calcula

**Dinheiro.** O total do carrinho é soma de apoio, para conferir com o
cliente; quem calcula a venda é o servidor, com `Decimal`. Somar `number` no
celular reintroduziria o ponto flutuante que o projeto inteiro evita — e o
número da tela divergiria do gravado.

## Contratos

`@estoque/contracts` é o MESMO pacote que a API e o web usam. O `metro.config.js`
observa a raiz do monorepo para isso funcionar. Copiar os tipos para cá criaria
a terceira cópia do contrato, e a terceira envelheceria sozinha.
