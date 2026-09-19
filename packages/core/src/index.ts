export {
  ESCALA_CUSTO,
  ESCALA_QUANTIDADE,
  ESCALA_VALOR,
  ZERO,
  arredondarCusto,
  arredondarQuantidade,
  arredondarValor,
  dec,
  ehNegativo,
  ehZero,
  formatarBRL,
  formatarQuantidade,
  maior,
  menor,
  type Dec,
  type ValorEntrada,
} from './dinheiro';

export {
  CustoInvalidoError,
  ErroDominio,
  QuantidadeInvalidaError,
  ValorImprecisoError,
  type DetalhesErro,
} from './erros';

export {
  ImagemInvalidaError,
  LADO_MINIMO_IMAGEM,
  LIMITE_BYTES_IMAGEM,
  TIPOS_IMAGEM_ACEITOS,
  conferirImagemDeCatalogo,
  lerImagem,
  type Imagem,
  type TipoImagem,
} from './imagem';

export {
  aplicarEntrada,
  aplicarSaida,
  aplicarSaidaComCustoEspecifico,
  aplicarTransferencia,
  posicao,
  posicaoVazia,
  proximaPosicao,
  valorEstoque,
  type Entrada,
  type PoliticaCusto,
  type Posicao,
  type ResultadoMovimento,
  type ResultadoTransferencia,
  type Saida,
  type SaidaComCusto,
} from './custo-medio';
