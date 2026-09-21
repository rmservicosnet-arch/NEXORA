module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // `react-native-reanimated/plugin` fica por último, sempre. É exigência do
    // próprio plugin, e a ordem errada falha em runtime, não na compilação.
    plugins: ['react-native-reanimated/plugin'],
  };
};
