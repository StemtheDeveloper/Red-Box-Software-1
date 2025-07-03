module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "script",
  },
  extends: ["eslint:recommended"],
  rules: {
    // Essential rules only - focused on potential bugs, not style
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "off", // Made less strict

    // Style rules made warnings or disabled
    quotes: "off", // Allow both single and double quotes
    "linebreak-style": "off", // Disable line ending checks for Windows
    indent: "off", // Allow any indentation
    "object-curly-spacing": "off", // Allow any spacing style
    "comma-dangle": "off", // Allow any comma style
    "quote-props": "off", // Allow any quote style for properties

    // Documentation rules disabled
    "valid-jsdoc": "off", // Disable JSDoc validation
    "require-jsdoc": "off", // Disable JSDoc requirement

    // Length and formatting made more lenient
    "max-len": "off", // Allow any line length
    semi: "off", // Allow with or without semicolons
    "space-before-function-paren": "off", // Allow any spacing
    "keyword-spacing": "off", // Allow any keyword spacing
    "space-infix-ops": "off", // Allow any operator spacing
    "comma-spacing": "off", // Allow any comma spacing
    "key-spacing": "off", // Allow any key spacing
    "brace-style": "off", // Allow any brace style

    // Variable rules made warnings
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }], // Allow unused vars starting with _
    "no-undef": "warn", // Make undefined variables warnings instead of errors

    // Keep only critical error rules
    "no-console": "off", // Allow console statements
    "no-debugger": "warn", // Warn but don't block on debugger
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
        // Even more lenient for test files
        "no-undef": "off", // Allow Jest globals
        "no-unused-vars": "off", // Allow unused variables in tests
        "max-len": "off", // Allow long lines in tests
      },
    },
  ],
  globals: {},
};
