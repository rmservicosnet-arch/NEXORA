import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Marca cada pasta de saída com o seu sistema de módulos.
 *
 * Sem estes arquivos, o Node lê a `"type"` do package.json do pacote e
 * interpreta os dois diretórios do mesmo jeito — quebrando um dos dois.
 */
const marcas = [
  ['dist/cjs', { type: 'commonjs' }],
  ['dist/esm', { type: 'module' }],
];

for (const [pasta, conteudo] of marcas) {
  await mkdir(pasta, { recursive: true });
  await writeFile(`${pasta}/package.json`, `${JSON.stringify(conteudo, null, 2)}\n`);
}
