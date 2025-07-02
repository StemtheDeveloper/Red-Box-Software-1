module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "script",
  },
  extends: ["eslint:recommended", "google"],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    quotes: ["error", "double", { allowTemplateLiterals: true }],
    "linebreak-style": "off", // Disable line ending checks for Windows
    indent: ["error", 2], // Use 2 spaces to match existing code
    "object-curly-spacing": ["error", "never"], // No spaces to match existing code
    "comma-dangle": ["error", "always-multiline"], // Require trailing commas
    "valid-jsdoc": "off", // Disable JSDoc validation
    "require-jsdoc": "off", // Disable JSDoc requirement
    "max-len": ["error", { code: 120 }], // Allow longer lines
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }], // Allow unused vars starting with _
  },
  overrides: [
    {
      files: ["test/**/*.js", "**/*.test.js", "**/*.spec.js"],
      env: {
        jest: true,
        mocha: true,
        node: true,
      },
      globals: {
        jest: "readonly",
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
      rules: {
        "no-undef": "off", // Allow Jest globals
        "no-unused-vars": "off", // Allow unused variables in tests
        "max-len": "off", // Allow long lines in tests
        indent: ["error", 2], // Use 2 spaces in test files
        "object-curly-spacing": ["error", "never"], // No spaces in test objects
        "comma-dangle": ["error", "never"], // No trailing commas in tests
      },
    },
  ],
  globals: {},
};
