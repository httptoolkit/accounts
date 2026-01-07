const path = require('path');

module.exports = (wallaby) => {
  return {
    files: [
      'netlify.toml',
      'package.json',
      'api/src/**/*.ts',
      'module/src/**/*.ts',
      'api/test/tsconfig.json',
      'api/test/**/*.ts',
      'api/test/fixtures/**/*',
      '!api/test/**/*.spec.ts'
    ],

    tests: [
      'api/test/**/*.spec.ts'
    ],

    compilers: {
      '**/*.ts?(x)': wallaby.compilers.typeScript({
        esModuleInterop: true,
        target: 'es2016',
        module: 'commonjs',
        moduleResolution: "node"
      })
    },

    workers: {
      initial: 1,
      regular: 1,
      restart: true
    },

    testFramework: 'mocha',
    env: {
      type: 'node',
      params: {
        env: [
          `NODE_EXTRA_CA_CERTS=${path.join(import.meta.dirname, 'api', 'test', 'fixtures', 'test-ca.pem')}`
        ].join(';')
      }
    },
    debug: true
  };
};