const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

const FUNCTIONS_OUT = path.join(__dirname, '..', 'dist', 'functions');
const FUNCTIONS_SRC = path.join(__dirname, 'src', 'functions');
const ENTRY_POINTS = _(fs.readdirSync(FUNCTIONS_SRC))
    .map(f =>
        [f.split('.').slice(0, -1), path.join(FUNCTIONS_SRC, f)]
    )
    .fromPairs()
    .valueOf();

module.exports = {
    mode: 'production',
    entry: ENTRY_POINTS,
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ],
    },
    target: 'node',

    output: {
        path: FUNCTIONS_OUT,
        filename: '[name].js',
        libraryTarget: 'commonjs',
    },

    bail: true,
    devtool: 'inline-cheap-module-source-map',
    stats: {
        colors: true,
    },
    optimization: {
        "minimize": false
    },
    resolve: {
        extensions: ['.js', '.ts'],
        // Required because of https://github.com/webpack/webpack/issues/6584
        // which breaks deepmerge -> rest-facade -> auth0
        mainFields: ["main", "module"]
    },
    plugins: [
        new webpack.DefinePlugin({
            // Required to correctly detect require in 'formidable'
            "global.GENTLY": false,
            // Available in the build, but not at runtime:
            "process.env.VERSION": JSON.stringify(process.env.VERSION || 'dev')
        })
    ],
}