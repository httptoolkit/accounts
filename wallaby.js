module.exports = (wallaby) => {
  process.env.NODE_EXTRA_CA_CERTS = './test/fixtures/test-ca.pem';
  process.env.FUNCTIONS_DIR = './src/functions/';

  return {
    files: [
      'netlify.toml',
      'package.json',
      'src/**/*.ts',
      'test/tsconfig.json',
      'test/**/*.ts',
      'test/fixtures/**/*',
      '!test/**/*.spec.ts'
    ],
    tests: [
      'test/**/*.spec.ts'
    ],

    workers: {
      initial: 4,
      regular: 1,
      restart: true
    },

    testFramework: 'mocha',
    env: {
      type: 'node'
    },
    debug: true
  };
};