#!/usr/bin/env node

/**
 * Script per generare automaticamente la configurazione MCP per Cursor
 * 
 * Uso:
 *   node generate-cursor-config.js
 * 
 * Output: stampa la configurazione JSON con i percorsi assoluti corretti
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname);

// Percorsi relativi ai file
const paths = {
  server: resolve(projectRoot, 'src/server.js'),
  environment: resolve(projectRoot, 'nwl.obesity.stage.postman_environment.json'),
  collections: {
    phr: resolve(projectRoot, 'collections/phr.postman_collection.json'),
    auth: resolve(projectRoot, 'collections/auth.postman_collection.json'),
    adherence: resolve(projectRoot, 'collections/adherence.postman_collection.json'),
    content: resolve(projectRoot, 'collections/content.postman_collection.json'),
    obesity: resolve(projectRoot, 'collections/obesity.postman_collection.json'),
    pjbuilder: resolve(projectRoot, 'collections/pjbuilder.postman_collection.json'),
  }
};

// Verifica che i file esistano
const missingFiles = [];
if (!existsSync(paths.server)) missingFiles.push(paths.server);
if (!existsSync(paths.environment)) missingFiles.push(paths.environment);
Object.entries(paths.collections).forEach(([name, path]) => {
  if (!existsSync(path)) missingFiles.push(`${name}: ${path}`);
});

if (missingFiles.length > 0) {
  console.error('⚠️  Attenzione: alcuni file non sono stati trovati:');
  missingFiles.forEach(file => console.error(`   - ${file}`));
  console.error('\nControlla che tutti i file esistano prima di usare questa configurazione.\n');
}

// Genera la configurazione
const config = {
  mcpServers: {
    "hcore-mcp": {
      command: "node",
      args: [paths.server],
      env: {
        POSTMAN_ENVIRONMENT_FILE: paths.environment,
        PHR_PATH: paths.collections.phr,
        AUTH_PATH: paths.collections.auth,
        ADHERENCE_PATH: paths.collections.adherence,
        CONTENT_PATH: paths.collections.content,
        OBESITY_PATH: paths.collections.obesity,
        PJBUILDER_PATH: paths.collections.pjbuilder,
      }
    }
  }
};

console.log('📋 Configurazione MCP per Cursor:\n');
console.log(JSON.stringify(config, null, 2));
console.log('\n💡 Copia questa configurazione e incollala nelle impostazioni MCP di Cursor.');
console.log('   Settings → Features → Model Context Protocol → Add MCP Server\n');

