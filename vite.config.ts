import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Versão do package.json na tela (rodapé do login)
    define: {
      __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Porta de HMR distinta do portal do cliente (24678) e do bm-crm (24679) e dos outros projetos, para rodarem ao mesmo tempo
      hmr: process.env.DISABLE_HMR === 'true' ? false : { port: 24690 },
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
