import parser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'tmp/**',
      '.scale/**',
      'test-fixtures/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {},
  },
]
