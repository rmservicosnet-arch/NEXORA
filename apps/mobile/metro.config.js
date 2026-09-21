// Metro num monorepo: sem isto o bundler não enxerga `packages/contracts`.
//
// O aplicativo importa `@estoque/contracts` — o MESMO pacote que a API e o
// web importam. Duplicar os tipos aqui faria a terceira cópia do contrato, e
// a terceira envelheceria sozinha.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projeto = __dirname;
const raiz = path.resolve(projeto, '../..');

const config = getDefaultConfig(projeto);

// Observa a raiz do monorepo: mudança em packages/ recarrega o app.
config.watchFolders = [raiz];

// Resolve primeiro no próprio app, depois na raiz — é onde o npm workspaces
// deixa a maioria dos pacotes.
config.resolver.nodeModulesPaths = [
  path.resolve(projeto, 'node_modules'),
  path.resolve(raiz, 'node_modules'),
];

// Sem isto, duas cópias de react podem ser carregadas e os hooks quebram com
// "Invalid hook call" — erro que parece do código e é de resolução.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
