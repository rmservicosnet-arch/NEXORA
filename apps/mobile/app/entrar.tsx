import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErroDeRede, ErroRequisicao } from '../src/api/cliente';
import { baseAtual } from '../src/api/cliente';
import { useSessao } from '../src/auth/sessao';
import { Aviso, Botao, Corpo } from '../src/ui/componentes';
import { cor, espaco, fonte, raio, TOQUE_MINIMO } from '../src/ui/tema';

/**
 * A entrada da equipe.
 *
 * Domínio de FUNCIONÁRIO. A senha do portal do cliente não serve aqui e a
 * daqui não serve lá — são tabelas, rotas e segredos de assinatura
 * diferentes (ADR-009). Quem errar a porta recebe "e-mail ou senha
 * incorretos", que é verdade: para este domínio, a credencial não existe.
 *
 * A mensagem de erro distingue três coisas que parecem iguais e não são:
 *
 *   sem rede            → nem chegou ao servidor
 *   muitas tentativas   → chegou, e ele pediu para esperar
 *   credencial inválida → chegou, e ele recusou
 *
 * Tratar as três como "não foi possível entrar" faria o vendedor trocar uma
 * senha que está certa por causa de um elevador sem sinal.
 */
export default function Entrar() {
  const { usuario, entrar } = useSessao();
  const margens = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<{ titulo: string; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) {
    return <Redirect href="/(app)/pedidos" />;
  }

  const pronto = email.trim().length > 3 && senha.length > 0;

  const enviar = async () => {
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
    } catch (e) {
      if (e instanceof ErroDeRede) {
        setErro({
          titulo: 'Sem conexão',
          texto: `O aplicativo não alcançou ${baseAtual()}. Verifique a rede e tente de novo.`,
        });
      } else if (e instanceof ErroRequisicao && e.eLimite) {
        setErro({
          titulo: 'Tentativas demais',
          texto: 'Espere um minuto antes de tentar de novo. Sua senha pode estar certa.',
        });
      } else if (e instanceof ErroRequisicao) {
        setErro({ titulo: 'Não foi possível entrar', texto: e.corpo.mensagem });
      } else {
        setErro({ titulo: 'Não foi possível entrar', texto: 'Tente de novo em instantes.' });
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <KeyboardAvoidingView style={e2.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          e2.conteudo,
          { paddingTop: margens.top + 48, paddingBottom: margens.bottom + espaco.gg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={e2.marca}>
          <Text style={e2.marcaNome}>Estoque</Text>
          <View style={e2.selo}>
            <Text style={e2.seloTexto}>EQUIPE</Text>
          </View>
        </View>

        <Text style={e2.titulo}>Entrar</Text>
        <Corpo tom="apagado" style={e2.subtitulo}>
          Use as credenciais que o administrador da sua empresa forneceu. Sua empresa é identificada
          pelo seu usuário.
        </Corpo>

        {erro ? (
          <View style={e2.erro}>
            <Aviso tom="perigo" titulo={erro.titulo}>
              {erro.texto}
            </Aviso>
          </View>
        ) : null}

        <Campo
          rotulo="E-mail"
          valor={email}
          aoMudar={setEmail}
          tipo="email"
          placeholder="voce@empresa.com.br"
        />
        <Campo rotulo="Senha" valor={senha} aoMudar={setSenha} tipo="senha" />

        <Botao
          aoTocar={() => void enviar()}
          ocupado={enviando}
          desabilitado={!pronto}
          style={e2.entrar}
        >
          Entrar
        </Botao>

        {/*
          O endereço da API aparece porque, na instalação, ele é o que dá
          errado: o celular precisa alcançar a máquina na rede, e `localhost`
          ali é o próprio aparelho. Esconder isso transformaria um erro de
          configuração numa caça ao tesouro.
        */}
        <Corpo tom="fraco" style={e2.endereco}>
          Servidor: {baseAtual()}
        </Corpo>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Campo({
  rotulo,
  valor,
  aoMudar,
  tipo = 'texto',
  placeholder,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly aoMudar: (v: string) => void;
  readonly tipo?: 'texto' | 'email' | 'senha';
  readonly placeholder?: string;
}) {
  return (
    <View style={e2.campo}>
      <Text style={e2.campoRotulo}>{rotulo}</Text>
      <TextInput
        value={valor}
        onChangeText={aoMudar}
        style={e2.entrada}
        placeholder={placeholder}
        placeholderTextColor={cor.fraco}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={tipo === 'email' ? 'email-address' : 'default'}
        secureTextEntry={tipo === 'senha'}
        textContentType={tipo === 'senha' ? 'password' : 'username'}
      />
    </View>
  );
}

const e2 = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.marcaTopo },
  conteudo: { flexGrow: 1, paddingHorizontal: espaco.gg },
  marca: { flexDirection: 'row', alignItems: 'center', gap: espaco.s, marginBottom: 28 },
  marcaNome: { fontSize: 20, fontWeight: '700', color: cor.papel },
  selo: {
    height: 21,
    paddingHorizontal: 9,
    borderRadius: raio.pilula,
    backgroundColor: cor.marcaClara,
    justifyContent: 'center',
  },
  seloTexto: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: cor.papel },
  titulo: { fontSize: 26, fontWeight: '700', color: cor.papel },
  subtitulo: { marginTop: espaco.xs, color: cor.marcaApagada },
  erro: { marginTop: espaco.g },
  campo: { marginTop: espaco.g, gap: 6 },
  campoRotulo: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: cor.marcaTexto,
  },
  entrada: {
    minHeight: TOQUE_MINIMO + 4,
    paddingHorizontal: espaco.m,
    borderRadius: raio.m,
    backgroundColor: cor.papel,
    fontSize: 15,
    color: cor.tinta,
  },
  entrar: { marginTop: espaco.gg, minHeight: 52 },
  endereco: { marginTop: espaco.g, textAlign: 'center', fontSize: fonte.miudo },
});
