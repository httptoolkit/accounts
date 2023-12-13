const path = require('path');
const Webpack = require('webpack');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const GoogleFontsPlugin = require('@beyonk/google-fonts-webpack-plugin');

const SRC_DIR = path.resolve(__dirname, 'src');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'dist');

const NODE_ENV = process.env.NODE_ENV || 'development';

const INDEX_HTML = path.join(SRC_DIR, 'index.html');

module.exports = {
    mode: NODE_ENV,

    entry: path.join(SRC_DIR, 'index.tsx'),

    output: {
        path: OUTPUT_DIR,
        filename: 'app.js'
    },

    resolve: {
        extensions: ['.js', '.ts', '.tsx'],
        fallback: {
            'events': require.resolve('events/'),
            'util': require.resolve('util/'),
            'buffer': require.resolve('buffer/'),
            'stream': require.resolve('stream-browserify/'),
            'crypto': require.resolve('crypto-browserify/')
        }
    },

    devtool: NODE_ENV === 'development'
        ? "eval-cheap-module-source-map"
        : "source-map",

    devServer: {
        port: 8765,
        historyApiFallback: true,
        allowedHosts: 'all'
    },

    module: {
        rules: [{
            test: /\.tsx?$/,
            use: [{ loader: 'ts-loader' }],
            exclude: /node_modules/
        }, {
            test: /\.(woff2|ttf|png|svg)$/,
            type: 'asset/resource'
        }, {
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
        }]
    },

    plugins: [
        new HtmlWebpackPlugin({
            template: INDEX_HTML
        }),
        new GoogleFontsPlugin({
            fonts: [
                { family: "Fira Mono" },
                { family: "Lato" }
            ],
            formats: ['woff2'], // Supported by Chrome, FF, Edge, Safari 12+
            filename: 'fonts.css',
            apiUrl: 'https://gwfh.mranftl.com/api/fonts'
        }),
        new Webpack.ProvidePlugin({
            process: 'process/browser'
        }),
        new Webpack.EnvironmentPlugin({
            'ACCOUNTS_API': null, // Always optional
            // Both required in production builds:
            'VERSION': process.env.NODE_ENV === 'production' ? undefined : null,
            'SENTRY_DSN': process.env.NODE_ENV === 'production' ? undefined : null,
        })
    ]
};