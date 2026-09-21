import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { definirBaseUrl } from '../src/api/cliente';
import { urlDaApi } from '../src/api/configuracao';
import { ProvedorSessao } from '../src/auth/sessao';
import { cor } from '../src/ui/tema';

/*
  A base da API é definida uma vez, no carregamento do módulo. Resolvê-la por
  requisição consultaria o Expo a cada chamada, e a resposta não muda.
*/
definirBaseUrl(urlDaApi());

/**
 * O cliente de consultas.
 *
 * `retry: 1`, não os três padrão: no balcão, três tentativas com espera
 * exponencial deixam a tela parada por segundos antes de dizer o que houve.
 * Errar rápido e deixar a pessoa decidir é melhor do que insistir em silêncio.
 *
 * `mutations.retry: 0` é a regra que não se negocia: escrita nunca repete
 * sozinha. Quem decide reenviar é a tela, com a MESMA `Idempotency-Key` —
 * repetir com chave nova é o que cria duas vendas.
 */
function criarCliente(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

export default function Raiz() {
  const [cliente] = useState(criarCliente);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={cliente}>
        <ProvedorSessao>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: cor.fundo },
            }}
          />
        </ProvedorSessao>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
