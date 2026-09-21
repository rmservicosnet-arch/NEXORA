import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  isScannedCode,
  useCameraDevice,
  useCameraPermission,
  useObjectOutput,
  usePreviewOutput,
  type ScannedObject,
} from 'react-native-vision-camera';

import { Botao, Corpo } from '../ui/componentes';
import { cor, espaco, fonte, raio, TOQUE_MINIMO } from '../ui/tema';

/**
 * O leitor de código de barras.
 *
 * É a razão de `docs/MOBILE.md` §1 proibir WebView: `react-native-vision-camera`
 * usa ML Kit no Android — autofoco, exposição e leitura contínua nativos. Em
 * `WebView` seria `getUserMedia` mais decodificação em JavaScript, que é a
 * diferença entre um leitor que funciona e um que o vendedor abandona no
 * segundo dia.
 *
 * ## A API da versão 5 não é a que os exemplos mostram
 *
 * A v4 tinha `useCodeScanner` e a prop `codeScanner`. A v5 — que é a versão
 * fixada no documento — foi reescrita sobre Nitro: agora se monta uma lista
 * de SAÍDAS (`usePreviewOutput`, `useObjectOutput`) e se passa em `outputs`.
 * `isScannedCode` estreita o objeto lido para o que tem `value`.
 *
 * Escrevi a primeira versão contra a API antiga, que é a que aparece em toda
 * documentação de terceiros, e o `tsc` a recusou. Vale como aviso: a versão
 * do documento estava certa, e o exemplo que se encontra por aí, não.
 *
 * ## Formatos
 *
 * Os que existem numa loja de artigos esportivos: EAN-13 e EAN-8 nas
 * etiquetas de fábrica, CODE-128 nas impressas internamente. Habilitar todos
 * degrada a leitura — o decodificador tenta cada um em cada quadro.
 */

/** Trava contra ler a mesma etiqueta trinta vezes por segundo. */
const ESPERA_ENTRE_LEITURAS_MS = 1_200;

export interface LeitorProps {
  /** Chamado uma vez por código, respeitando a trava. */
  readonly aoLer: (codigo: string) => void;
  /** Desliga o sensor sem desmontar — usado quando um painel cobre a tela. */
  readonly pausado?: boolean;
  readonly aoPedirDigitacao: () => void;
}

export function Leitor({ aoLer, pausado = false, aoPedirDigitacao }: LeitorProps) {
  const permissao = useCameraPermission();
  const aparelho = useCameraDevice('back');
  const [lanterna, setLanterna] = useState(false);
  const [pedindo, setPedindo] = useState(false);

  /*
    O último código e quando ele entrou, em `useRef`.

    O callback é chamado a cada quadro; um `setState` ali provocaria dezenas
    de renders por segundo — a câmera engasga e a leitura piora justamente
    enquanto a pessoa está mirando.
  */
  const ultimo = useRef<{ codigo: string; em: number } | null>(null);

  const tratar = useCallback(
    (objetos: ScannedObject[]) => {
      if (pausado) return;

      const primeiro = objetos.find((o) => isScannedCode(o) && o.value);
      if (!primeiro || !isScannedCode(primeiro)) return;

      const valor = primeiro.value;
      if (!valor) return;

      const agora = Date.now();
      const anterior = ultimo.current;

      /*
        O mesmo código de novo dentro da janela é o MESMO ato: a etiqueta
        continua na frente da câmera. Sem a trava, uma mirada vira trinta
        itens no carrinho.

        Código DIFERENTE passa na hora — bipar dois produtos em sequência é
        rápido, e esperar 1,2 s entre eles seria o leitor brigando com quem
        trabalha.
      */
      if (anterior && anterior.codigo === valor && agora - anterior.em < ESPERA_ENTRE_LEITURAS_MS) {
        return;
      }

      ultimo.current = { codigo: valor, em: agora };
      aoLer(valor);
    },
    [aoLer, pausado],
  );

  const previa = usePreviewOutput();
  const leitura = useObjectOutput({
    types: ['ean-13', 'ean-8', 'code-128'],
    onObjectsScanned: tratar,
  });

  if (!permissao.hasPermission) {
    return (
      <Moldura>
        <Corpo style={e.avisoTitulo}>A câmera precisa de permissão</Corpo>
        <Corpo style={e.avisoTexto}>
          Sem ela não há leitura de código de barras — e digitar o código a cada item é o que o
          leitor existe para evitar.
        </Corpo>
        <View style={e.avisoBotoes}>
          <Botao
            ocupado={pedindo}
            aoTocar={() => {
              setPedindo(true);
              void permissao.requestPermission().finally(() => setPedindo(false));
            }}
          >
            Permitir câmera
          </Botao>
          <Botao variante="secundario" aoTocar={aoPedirDigitacao}>
            Digitar código
          </Botao>
        </View>
      </Moldura>
    );
  }

  if (!aparelho) {
    /*
      Emulador sem câmera, ou traseira com defeito. Dizer o que houve e
      oferecer a digitação é melhor do que uma tela preta que parece
      travamento.
    */
    return (
      <Moldura>
        <Corpo style={e.avisoTitulo}>Nenhuma câmera traseira encontrada</Corpo>
        <Corpo style={e.avisoTexto}>
          O aplicativo não achou a câmera deste aparelho. Dá para seguir digitando o código.
        </Corpo>
        <View style={e.avisoBotoes}>
          <Botao variante="secundario" aoTocar={aoPedirDigitacao}>
            Digitar código
          </Botao>
        </View>
      </Moldura>
    );
  }

  return (
    <View style={e.lente}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={aparelho}
        // `isActive` desliga o sensor quando um painel cobre a tela: câmera
        // ligada por trás de um diálogo é bateria e calor por nada.
        isActive={!pausado}
        outputs={[previa, leitura]}
        torchMode={lanterna ? 'on' : 'off'}
      />

      <View style={e.alvo} pointerEvents="none">
        <View style={[e.canto, e.cantoCimaEsq]} />
        <View style={[e.canto, e.cantoCimaDir]} />
        <View style={[e.canto, e.cantoBaixoEsq]} />
        <View style={[e.canto, e.cantoBaixoDir]} />
        <View style={e.linhaLeitura} />
      </View>

      <View style={e.instrucoes} pointerEvents="none">
        <Text style={e.instrucao}>Aponte a câmera para o código de barras</Text>
        <Text style={e.instrucaoFraca}>Leitura contínua ativa</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={lanterna ? 'Desligar lanterna' : 'Ligar lanterna'}
        onPress={() => setLanterna((x) => !x)}
        style={[e.botaoRedondo, e.lanterna, lanterna && e.lanternaLigada]}
      >
        <Text style={e.botaoIcone}>{lanterna ? '☀' : '☼'}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={aoPedirDigitacao}
        style={[e.botaoRedondo, e.digitar]}
      >
        <Text style={e.digitarTexto}>Digitar código</Text>
      </Pressable>
    </View>
  );
}

function Moldura({ children }: { readonly children: React.ReactNode }) {
  return <View style={[e.lente, e.molduraAviso]}>{children}</View>;
}

const ALTURA = 288;

const e = StyleSheet.create({
  lente: { height: ALTURA, backgroundColor: cor.lente, overflow: 'hidden' },
  molduraAviso: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.gg,
    gap: espaco.s,
  },
  avisoTitulo: { color: cor.papel, fontSize: fonte.subtitulo, fontWeight: '600' },
  avisoTexto: { color: '#BDB8AF', textAlign: 'center', fontSize: fonte.apoio },
  avisoBotoes: { marginTop: espaco.s, flexDirection: 'row', gap: espaco.s },

  alvo: { position: 'absolute', left: 45, top: 78, width: 300, height: 132 },
  canto: { position: 'absolute', width: 34, height: 34, borderColor: cor.papel },
  cantoCimaEsq: { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 8 },
  cantoCimaDir: {
    right: 0,
    top: 0,
    borderRightWidth: 3,
    borderTopWidth: 3,
    borderTopRightRadius: 8,
  },
  cantoBaixoEsq: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cantoBaixoDir: {
    right: 0,
    bottom: 0,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderBottomRightRadius: 8,
  },
  linhaLeitura: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 64,
    height: 2,
    backgroundColor: '#FF6B5A',
  },

  instrucoes: { position: 'absolute', left: 0, right: 0, top: 224, alignItems: 'center', gap: 4 },
  instrucao: { fontSize: fonte.corpo, fontWeight: '500', color: cor.papel },
  instrucaoFraca: { fontSize: fonte.miudo, color: '#BDB8AF' },

  botaoRedondo: {
    position: 'absolute',
    bottom: 14,
    minHeight: TOQUE_MINIMO,
    borderRadius: raio.pilula,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lanterna: { left: 14, width: TOQUE_MINIMO },
  lanternaLigada: { backgroundColor: 'rgba(255,255,255,0.32)' },
  botaoIcone: { fontSize: 20, color: cor.papel },
  digitar: { right: 14, paddingHorizontal: espaco.g },
  digitarTexto: { fontSize: fonte.corpo, fontWeight: '500', color: cor.papel },
});
