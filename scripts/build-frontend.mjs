import { build } from 'esbuild';

await build({
  entryPoints: ['web/react/index.tsx'],
  outfile: 'web/react-ui.js',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
