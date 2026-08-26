const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  // The component gallery is a development tool. Registering its entry and page
  // only outside production means it can never land in dist/ - and therefore
  // never in the store zip, which packages whatever dist/ contains.
  const entry = {
    background: './src/background/index.ts',
    popup: './src/popup/index.tsx',
    options: './src/options/index.tsx',
  };
  if (!isProduction) {
    entry.styleguide = './src/styleguide/index.tsx';
  }

  return {
    entry,
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|jpg|jpeg|gif|svg)$/,
          type: 'asset/resource',
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
        // Use Preact's React compatibility layer so existing imports keep working
        'react': 'preact/compat',
        'react-dom': 'preact/compat',
        'react/jsx-runtime': 'preact/jsx-runtime',
      },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './public/popup.html',
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new HtmlWebpackPlugin({
        template: './public/options.html',
        filename: 'options.html',
        chunks: ['options'],
      }),
      ...(isProduction
        ? []
        : [
            new HtmlWebpackPlugin({
              template: './public/styleguide.html',
              filename: 'styleguide.html',
              chunks: ['styleguide'],
            }),
          ]),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'public/manifest.json', to: 'manifest.json' },
          { from: 'public/icons', to: 'icons', noErrorOnMissing: true },
          { from: '_locales', to: '_locales' },
        ],
      }),
    ],
    devtool: isProduction ? false : 'source-map',
  };
};
