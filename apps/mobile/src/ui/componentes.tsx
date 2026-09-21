import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { cor, espaco, fonte, raio, TOQUE_MINIMO } from './tema';

/**
 * As peças da interface do aplicativo.
 *
 * Deliberadamente poucas e sem biblioteca de componentes: o que o aplicativo
 * faz cabe em botão, cartão, pílula e aviso. Uma biblioteca traria tema,
 * ícones e animação que não se usam — e peso no APK, que é o que decide se o
 * vendedor instala.
 */

export function Titulo({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<TextStyle>;
}) {
  return <Text style={[e.titulo, style]}>{children}</Text>;
}

export function Corpo({
  children,
  tom = 'normal',
  style,
  numeroDeLinhas,
}: {
  readonly children: ReactNode;
  readonly tom?: 'normal' | 'apagado' | 'fraco' | 'perigo' | 'atencao' | 'bom';
  readonly style?: StyleProp<TextStyle>;
  readonly numeroDeLinhas?: number;
}) {
  const tons = {
    normal: cor.tinta,
    apagado: cor.apagado,
    fraco: cor.fraco,
    perigo: cor.perigo,
    atencao: cor.atencao,
    bom: cor.bomEscuro,
  };

  return (
    <Text style={[e.corpo, { color: tons[tom] }, style]} numberOfLines={numeroDeLinhas}>
      {children}
    </Text>
  );
}

/** Número. Monoespaçado e tabular: a coluna não dança quando o valor muda. */
export function Numero({
  children,
  tamanho = fonte.numero,
  tom = 'normal',
  style,
}: {
  readonly children: ReactNode;
  readonly tamanho?: number;
  readonly tom?: 'normal' | 'apagado' | 'perigo' | 'bom';
  readonly style?: StyleProp<TextStyle>;
}) {
  const tons = { normal: cor.tinta, apagado: cor.apagado, perigo: cor.perigo, bom: cor.bom };

  return <Text style={[e.numero, { fontSize: tamanho, color: tons[tom] }, style]}>{children}</Text>;
}

export function Rotulo({ children }: { readonly children: ReactNode }) {
  return <Text style={e.rotulo}>{children}</Text>;
}

export function Cartao({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return <View style={[e.cartao, style]}>{children}</View>;
}

export function Pilula({
  children,
  tom = 'neutro',
}: {
  readonly children: ReactNode;
  readonly tom?: 'neutro' | 'bom' | 'perigo' | 'atencao' | 'marca';
}) {
  const tons = {
    neutro: [cor.linhaFraca, cor.apagado],
    bom: [cor.bomFundo, cor.bomEscuro],
    perigo: [cor.perigoForte, cor.perigo],
    atencao: [cor.atencaoForte, cor.atencao],
    marca: [cor.marcaFundo, cor.marcaEscura],
  } as const;

  const [fundo, texto] = tons[tom];

  return (
    <View style={[e.pilula, { backgroundColor: fundo }]}>
      <Text style={[e.pilulaTexto, { color: texto }]}>{children}</Text>
    </View>
  );
}

export function Botao({
  children,
  aoTocar,
  variante = 'primario',
  ocupado = false,
  desabilitado = false,
  style,
}: {
  readonly children: ReactNode;
  readonly aoTocar: () => void;
  readonly variante?: 'primario' | 'secundario' | 'perigo';
  readonly ocupado?: boolean;
  readonly desabilitado?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const inerte = desabilitado || ocupado;

  const variantes = {
    primario: { fundo: cor.marca, borda: cor.marca, texto: cor.papel },
    secundario: { fundo: cor.papel, borda: cor.borda, texto: cor.texto },
    perigo: { fundo: cor.papel, borda: cor.perigoBorda, texto: cor.perigo },
  } as const;

  const v = variantes[variante];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inerte, busy: ocupado }}
      disabled={inerte}
      onPress={aoTocar}
      style={({ pressed }) => [
        e.botao,
        { backgroundColor: v.fundo, borderColor: v.borda },
        pressed && e.botaoPressionado,
        inerte && e.botaoInerte,
        style,
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={v.texto} size="small" />
      ) : (
        <Text style={[e.botaoTexto, { color: v.texto }]}>{children}</Text>
      )}
    </Pressable>
  );
}

/**
 * Aviso.
 *
 * Elemento visível, nunca `title` — no celular não existe passar o mouse, e é
 * no celular que a equipe confere pedido.
 */
export function Aviso({
  titulo,
  children,
  tom = 'atencao',
}: {
  readonly titulo: string;
  readonly children?: ReactNode;
  readonly tom?: 'atencao' | 'perigo' | 'marca';
}) {
  const tons = {
    atencao: { fundo: cor.atencaoFundo, borda: cor.atencaoBorda, texto: cor.atencao },
    perigo: { fundo: cor.perigoFundo, borda: cor.perigoBorda, texto: cor.perigo },
    marca: { fundo: cor.marcaFundo, borda: cor.marcaBorda, texto: cor.marcaEscura },
  } as const;

  const t = tons[tom];

  return (
    <View style={[e.aviso, { backgroundColor: t.fundo, borderColor: t.borda }]}>
      <Text style={[e.avisoTitulo, { color: t.texto }]}>{titulo}</Text>
      {children ? <Text style={[e.avisoTexto, { color: t.texto }]}>{children}</Text> : null}
    </View>
  );
}

export function Vazio({
  titulo,
  descricao,
}: {
  readonly titulo: string;
  readonly descricao: string;
}) {
  return (
    <View style={e.vazio}>
      <Text style={e.vazioTitulo}>{titulo}</Text>
      <Text style={e.vazioTexto}>{descricao}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  titulo: {
    fontSize: fonte.titulo,
    fontWeight: '700',
    lineHeight: 24,
    color: cor.tinta,
  },
  corpo: {
    fontSize: fonte.corpo,
    lineHeight: 19,
  },
  numero: {
    // `monospace` no Android, `Courier` no iOS — o RN resolve o genérico.
    fontFamily: 'monospace',
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  rotulo: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: cor.apagado,
  },
  cartao: {
    backgroundColor: cor.papel,
    borderWidth: 1,
    borderColor: cor.linha,
    borderRadius: raio.g,
    padding: espaco.m,
  },
  pilula: {
    height: 21,
    paddingHorizontal: 9,
    borderRadius: raio.pilula,
    justifyContent: 'center',
  },
  pilulaTexto: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  botao: {
    minHeight: TOQUE_MINIMO,
    paddingHorizontal: espaco.g,
    borderRadius: raio.m,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoPressionado: {
    opacity: 0.85,
  },
  botaoInerte: {
    opacity: 0.45,
  },
  botaoTexto: {
    fontSize: 15,
    fontWeight: '600',
  },
  aviso: {
    borderWidth: 1,
    borderRadius: raio.m,
    padding: espaco.m,
    gap: 3,
  },
  avisoTitulo: {
    fontSize: fonte.apoio,
    fontWeight: '600',
    lineHeight: 17,
  },
  avisoTexto: {
    fontSize: fonte.miudo,
    lineHeight: 16,
  },
  vazio: {
    paddingVertical: 40,
    paddingHorizontal: espaco.g,
    alignItems: 'center',
    gap: espaco.xs,
  },
  vazioTitulo: {
    fontSize: fonte.subtitulo,
    fontWeight: '600',
    color: cor.tinta,
  },
  vazioTexto: {
    fontSize: fonte.apoio,
    color: cor.apagado,
    textAlign: 'center',
  },
});
