const path = require('path');
const Webpack = require('webpack');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const GoogleFontsPlugin = require('google-fonts-plugin');

const SRC_DIR = path.resolve(__dirname, 'src');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'dist', 'public');

const NODE_ENV = process.env.NODE_ENV || 'development';

const INDEX_HTML = path.join(SRC_DIR, 'index.html');

module.exports = {
    mode: NODE_ENV,

    entry: path.join(SRC_DIR, 'index.tsx'),

    output: {
        path: OUTPUT_DIR,
        filename: 'app.js',
        libraryTarget: 'umd'
    },

    resolve: {
        extensions: ['.js', '.ts', '.tsx']
    },

    devtool: NODE_ENV === 'development'
        ? "eval-cheap-module-source-map"
        : "source-map",

    devServer: {
        port: 8765,
        historyApiFallback: true,
        public: 'local.httptoolkit.tech:8765'
    },

    module: {
        rules: [{
            test: /\.tsx?$/,
            use: [{ loader: 'ts-loader' }],
            exclude: /node_modules/
        }, {
            test: /\.(woff2|ttf|png|svg)$/,
            loader: 'file-loader'
        }, {
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
        }, NODE_ENV === 'production' ? {
            test: INDEX_HTML,
            use: [{
                loader: '@httptoolkit/prerender-loader',
                options: {
                    string: true,
                    documentUrl: "https://accounts.httptoolkit.tech",
                    env: {
                        SC_DISABLE_SPEEDY: 'true'
                    }
                }
            }]
        } : {}]
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
            filename: 'fonts.css'
        }),
        new Webpack.EnvironmentPlugin({
            'VERSION': null,
            'API_BASE': null
        })
    ],
};