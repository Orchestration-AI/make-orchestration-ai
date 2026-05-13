import { defineConfig } from '@hey-api/openapi-ts';

const stripController = (name: string) => name.replace(/Controller/g, '');

export default defineConfig({
  input: 'https://api-dot-orchestration-ai-online-qa.ew.r.appspot.com/openapi.json',
  output: {
    path: 'typescript',
    clean: false,
    entryFile: false,
  },
  plugins: [
    {
      name: '@hey-api/typescript',
      requests: { name: (name) => stripController(name) + 'Data' },
      responses: { name: (name) => stripController(name) + 'Responses', response: (name) => stripController(name) + 'Response' },
      errors: { name: (name) => stripController(name) + 'Errors', error: (name) => stripController(name) + 'Error' },
    },
    {
      name: '@hey-api/client-axios',
    },
    {
      name: '@hey-api/sdk',
      operations: { methodName: stripController },
    },
  ],
});
