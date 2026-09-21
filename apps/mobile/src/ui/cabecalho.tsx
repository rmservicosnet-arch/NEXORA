import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cor, espaco, fonte, raio } from './tema';

/**
 * O topo azul-escuro do aplicativo, do artboard.
 *
 * `useSafeAreaInsets` e não uma altura fixa: a barra de status varia entre
 * aparelhos, e um número cravado põe o título embaixo do relógio em metade
 * deles. Largura fixa numa tela de celular já custou caro neste projeto.
 */
export function Cabecalho({
  titulo,
  subtitulo,
  selo,
  direita,
}: {
  readonly titulo: string;
  readonly subtitulo?: string;
  readonly selo?: number;
  readonly direita?: React.ReactNode;
}) {
  const margens = useSafeAreaInsets();

  return (
    <View style={[e.topo, { paddingTop: margens.top + espaco.m }]}>
      <View style={e.textos}>
        <View style={e.linhaTitulo}>
          <Text style={e.titulo}>{titulo}</Text>
          {/* Zero não aparece: um "0" chamando atenção é ruído. */}
          {selo !== undefined && selo > 0 ? (
            <View style={e.selo}>
              <Text style={e.seloTexto}>{selo > 99 ? '99+' : selo}</Text>
            </View>
          ) : null}
        </View>
        {subtitulo ? (
          <Text style={e.subtitulo} numberOfLines={1}>
            {subtitulo}
          </Text>
        ) : null}
      </View>
      {direita}
    </View>
  );
}

const e = StyleSheet.create({
  topo: {
    paddingHorizontal: espaco.g,
    paddingBottom: espaco.m,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: espaco.s,
    backgroundColor: cor.marcaTopo,
  },
  textos: { flex: 1, minWidth: 0 },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', gap: espaco.s },
  titulo: { fontSize: fonte.titulo, fontWeight: '700', lineHeight: 22, color: cor.papel },
  selo: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: raio.pilula,
    backgroundColor: cor.perigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seloTexto: { fontSize: 10.5, fontWeight: '700', color: cor.papel },
  subtitulo: { marginTop: 1, fontSize: fonte.miudo, lineHeight: 14, color: cor.marcaApagada },
});
