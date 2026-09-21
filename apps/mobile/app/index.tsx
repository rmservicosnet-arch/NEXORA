import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSessao } from '../src/auth/sessao';
import { cor } from '../src/ui/tema';

/**
 * A porta: decide entre o login e o aplicativo.
 *
 * Espera a restauração terminar antes de decidir. Sem isso, quem já tinha
 * sessão veria a tela de login piscar por um instante — e alguém digitaria
 * a senha por reflexo.
 */
export default function Inicio() {
  const { usuario, restaurando } = useSessao();

  if (restaurando) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={cor.marca} size="large" />
      </View>
    );
  }

  return <Redirect href={usuario ? '/(app)/pedidos' : '/entrar'} />;
}

const e = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cor.fundo },
});
