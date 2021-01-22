const webpack = require('webpack');

module.exports = {
    optimization: {
        "minimize": false
    },
    resolve: {
        // Required because of https://github.com/webpack/webpack/issues/6584
        // which breaks deepmerge -> rest-facade -> auth0
        mainFields: ["main", "module"]
    },
    plugins: [
        // Required to correctly detect require in 'formidable'
        new webpack.DefinePlugin({
            "global.GENTLY": false,
            "process.env.COMMIT_REF": JSON.stringify(process.env.COMMIT_REF) // Available in the build, but not at runtime
        })
    ],
}