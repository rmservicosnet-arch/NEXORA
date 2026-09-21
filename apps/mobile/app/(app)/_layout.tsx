import { Redirect, Tabs } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useSessao } from '../../src/auth/sessao';
import { cor, fonte } from '../../src/ui/tema';

/**
 * As quatro abas do artboard: Pedidos, Estoque, Escanear e Conta.
 *
 * A guarda fica aqui e não em cada tela: uma tela nova dentro deste grupo
 * nasce protegida, e esquecer fecha em vez de abrir — a mesma regra dos
 * guards globais da API.
 */
export default function Abas() {
  const { usuario, restaurando } = useSessao();

  if (!restaurando && !usuario) {
    return <Redirect href="/entrar" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: cor.marca,
        tabBarInactiveTintColor: cor.apagado,
        tabBarStyle: e.barra,
        tabBarLabelStyle: e.rotulo,
        // 64 de altura como no desenho: o alvo de toque tem de caber a mão de
        // quem está em pé, segurando mercadoria com a outra.
        tabBarItemStyle: { paddingVertical: 6 },
        sceneStyle: { backgroundColor: cor.fundo },
      }}
    >
      <Tabs.Screen
        name="pedidos"
        options={{
          title: 'Pedidos',
          tabBarIcon: ({ color }) => <IconePedidos cor={color} />,
        }}
      />
      <Tabs.Screen
        name="estoque"
        options={{
          title: 'Estoque',
          tabBarIcon: ({ color }) => <IconeCaixa cor={color} />,
        }}
      />
      <Tabs.Screen
        name="escanear"
        options={{
          title: 'Escanear',
          tabBarIcon: ({ color }) => <IconeLeitor cor={color} />,
        }}
      />
      <Tabs.Screen
        name="conta"
        options={{
          title: 'Conta',
          tabBarIcon: ({ color }) => <IconePessoa cor={color} />,
        }}
      />
    </Tabs>
  );
}

/** Contador sobre o ícone. Zero não aparece: um "0" vermelho chama à toa. */
export function Selo({ quantos }: { readonly quantos: number }) {
  if (quantos <= 0) return null;

  return (
    <View style={e.selo}>
      <Text style={e.seloTexto}>{quantos > 99 ? '99+' : quantos}</Text>
    </View>
  );
}

function IconePedidos({ cor: c }: { readonly cor: ColorValue }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}>
      <Path d="M9 4h6v3H9z" strokeLinejoin="round" />
      <Path d="M15 5.5h3v15H6v-15h3" strokeLinejoin="round" />
      <Path d="m9.5 13.5 1.8 1.8 3.5-3.6" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconeCaixa({ cor: c }: { readonly cor: ColorValue }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
      <Path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" strokeLinejoin="round" />
      <Path d="M3 7.5 12 12l9-4.5" strokeLinejoin="round" />
      <Path d="M12 12v9" strokeLinejoin="round" />
    </Svg>
  );
}

function IconeLeitor({ cor: c }: { readonly cor: ColorValue }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}>
      <Path d="M3 7V5a1 1 0 0 1 1-1h2" strokeLinecap="round" />
      <Path d="M18 4h2a1 1 0 0 1 1 1v2" strokeLinecap="round" />
      <Path d="M21 17v2a1 1 0 0 1-1 1h-2" strokeLinecap="round" />
      <Path d="M6 20H4a1 1 0 0 1-1-1v-2" strokeLinecap="round" />
      <Path d="M7 12h10" strokeLinecap="round" />
    </Svg>
  );
}

function IconePessoa({ cor: c }: { readonly cor: ColorValue }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
      <Circle cx={12} cy={8} r={3.6} />
      <Path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
    </Svg>
  );
}

/** Exportado para a tela de estoque usar o mesmo traço. */
export function IconeGrade({ cor: c }: { readonly cor: ColorValue }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9}>
      <Rect x={3} y={4} width={7} height={7} rx={1.5} />
      <Rect x={14} y={4} width={7} height={7} rx={1.5} />
      <Rect x={3} y={15} width={7} height={5} rx={1.5} />
      <Rect x={14} y={15} width={7} height={5} rx={1.5} />
    </Svg>
  );
}

const e = StyleSheet.create({
  barra: {
    height: 64,
    backgroundColor: cor.papel,
    borderTopWidth: 1,
    borderTopColor: cor.linha,
  },
  rotulo: {
    fontSize: fonte.miudo - 0.5,
    fontWeight: '500',
  },
  selo: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: cor.papel,
    backgroundColor: cor.perigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seloTexto: {
    fontSize: 9.5,
    fontWeight: '600',
    color: cor.papel,
  },
});
