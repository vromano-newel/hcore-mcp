# HCore MCP Server

Server MCP (Model Context Protocol) per esporre le API HCore tramite collection Postman.

## 📋 Descrizione

Questo server MCP espone le API HCore come strumenti utilizzabili da Cursor e altri client MCP. Le API sono organizzate in collection Postman che vengono caricate dinamicamente e esposte come tool MCP.

### Collection disponibili

- **auth** - Autenticazione e gestione utenti
- **phr** - Personal Health Record (PHR)
- **adherence** - Aderenza terapeutica e medication request
- **content** - Content Management System
- **obesity** - Gestione programmi obesità
- **pjbuilder** - Program Builder

## 🚀 Installazione

1. **Clona o scarica il repository**

2. **Installa le dipendenze**
   ```bash
   npm install
   ```

3. **Configura le variabili d'ambiente**

   Crea un file `.env` nella root del progetto con le seguenti variabili:

   ```env
   # File environment Postman (opzionale)
   POSTMAN_ENVIRONMENT_FILE=./nwl.obesity.stage.postman_environment.json

   # Percorsi delle collection Postman
   # Formato: COLLECTION_NAME_PATH=/path/to/collection.json
   # Puoi specificare più collection separandole con virgole
   PHR_PATH=./collections/phr.postman_collection.json
   AUTH_PATH=./collections/auth.postman_collection.json
   ADHERENCE_PATH=./collections/adherence.postman_collection.json
   CONTENT_PATH=./collections/content.postman_collection.json
   OBESITY_PATH=./collections/obesity.postman_collection.json
   PJBUILDER_PATH=./collections/pjbuilder.postman_collection.json
   ```

## ⚙️ Configurazione in Cursor

### 🚀 Metodo 1: Script automatico (consigliato)

Lo script genera automaticamente la configurazione con i percorsi corretti:

```bash
node generate-cursor-config.js
```

Copia l'output JSON e incollalo nelle impostazioni MCP di Cursor:
1. Apri Cursor → **Settings** → **Features** → **Model Context Protocol**
2. Clicca su **Add MCP Server**
3. Incolla la configurazione generata
4. Riavvia Cursor

### 📝 Metodo 2: Configurazione manuale

1. **Trova il percorso assoluto del progetto**
   ```bash
   pwd
   # Esempio output: /Users/vincenzo.romano/Data/Projects/MCPs/hcore
   ```

2. **Apri Cursor**
   - Vai su **Settings** → **Features** → **Model Context Protocol**
   - Clicca su **Add MCP Server**

3. **Copia e incolla la configurazione**

   Apri il file `cursor-mcp-config.json` incluso nel progetto, sostituisci `/path/to/hcore` con il percorso assoluto trovato al punto 1, e incolla la configurazione in Cursor.

   Oppure copia direttamente questa configurazione (ricorda di sostituire il percorso):

   ```json
   {
     "mcpServers": {
       "hcore-mcp": {
         "command": "node",
         "args": [
           "/path/to/hcore/src/server.js"
         ],
         "env": {
           "POSTMAN_ENVIRONMENT_FILE": "/path/to/hcore/nwl.obesity.stage.postman_environment.json",
           "PHR_PATH": "/path/to/hcore/collections/phr.postman_collection.json",
           "AUTH_PATH": "/path/to/hcore/collections/auth.postman_collection.json",
           "ADHERENCE_PATH": "/path/to/hcore/collections/adherence.postman_collection.json",
           "CONTENT_PATH": "/path/to/hcore/collections/content.postman_collection.json",
           "OBESITY_PATH": "/path/to/hcore/collections/obesity.postman_collection.json",
           "PJBUILDER_PATH": "/path/to/hcore/collections/pjbuilder.postman_collection.json"
         }
       }
     }
   }
   ```

4. **Riavvia Cursor**

   Dopo aver aggiunto la configurazione, riavvia Cursor per caricare il server MCP.

### 🔧 Metodo 3: Modifica diretta del file di configurazione

Se preferisci modificare direttamente il file di configurazione:

1. **Apri il file di configurazione MCP di Cursor:**
   - **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`
   - **Windows**: `%APPDATA%\Cursor\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json`
   - **Linux**: `~/.config/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`

2. **Aggiungi la configurazione** (o modifica quella esistente se `hcore-mcp` è già presente)

3. **Riavvia Cursor**

### 📝 Metodo 2: Configurazione manuale

### 🔧 Metodo 3: Modifica diretta del file di configurazione

1. Apri il file di configurazione MCP di Cursor:
   - **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`
   - **Windows**: `%APPDATA%\Cursor\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json`
   - **Linux**: `~/.config/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`

2. Aggiungi la configurazione sopra indicata

3. Riavvia Cursor

## 📝 Utilizzo

Una volta configurato, puoi utilizzare gli strumenti MCP direttamente in Cursor. Gli strumenti sono organizzati per collection:

- `mcp_hcore-mcp_auth` - Endpoint di autenticazione
- `mcp_hcore-mcp_phr` - Endpoint PHR
- `mcp_hcore-mcp_adherence` - Endpoint adherence
- `mcp_hcore-mcp_content` - Endpoint CMS
- `mcp_hcore-mcp_app` - Endpoint obesity
- `mcp_hcore-mcp_program` - Endpoint program builder

### Esempio: Ricerca item PHR

```javascript
// Cerca item con category "observations" e type "weight"
mcp_hcore-mcp_phr({
  endpoint: "item_search_test_json_post",
  body: {
    "category": "observations",
    "search[type]": "weight"
  }
})
```

### Esempio: Autenticazione

```javascript
// Autenticazione
mcp_hcore-mcp_auth({
  endpoint: "auth_token_password_post",
  vars: {
    "username": "user@example.com",
    "password": "password123"
  }
})
```

### Esempio: Ricerca medication request

```javascript
// Lista medication request
mcp_hcore-mcp_adherence({
  endpoint: "adherence_medication_request_search_post"
})
```

## 🔧 Funzionalità

### Gestione variabili

Puoi impostare variabili di sessione o globali che vengono utilizzate nelle chiamate successive:

```javascript
mcp_hcore-mcp_set_vars({
  vars: {
    "userToken": "your-token-here",
    "category": "observations"
  },
  scope: "session" // o "global"
})
```

### Body formdata personalizzato

Quando passi un `body` come oggetto per un endpoint che usa formdata, vengono inclusi **solo i campi che specifichi**, ignorando quelli dell'endpoint originale. Questo ti permette di controllare esattamente quali parametri vengono inviati.

## 🛠️ Sviluppo

### Avvio del server

```bash
npm start
```

Il server si avvia in modalità stdio e comunica tramite il protocollo MCP.

### Struttura del progetto

```
hcore/
├── collections/                    # Collection Postman
│   ├── auth.postman_collection.json
│   ├── phr.postman_collection.json
│   ├── adherence.postman_collection.json
│   └── ...
├── src/
│   └── server.js                   # Server MCP principale
├── generate-cursor-config.js        # Script per generare la config Cursor
├── cursor-mcp-config.json           # Template configurazione Cursor
├── package.json
└── README.md
```

## 📚 Documentazione

Per vedere tutti gli endpoint disponibili, consulta le collection Postman nella cartella `collections/`.

Ogni collection espone i suoi endpoint come tool MCP con il nome formato da:
- Nome della collection (slugificato)
- Nome dell'endpoint (slugificato)
- Metodo HTTP

Esempio: `phr__item_search_test_json_post` → `item_search_test_json_post`

## 🔐 Sicurezza

- I token di autenticazione vengono gestiti tramite variabili di sessione
- Le credenziali non vengono mai loggate o esposte
- Utilizza sempre HTTPS in produzione

## 📄 Licenza

ISC

## 👤 Autore

Vincenzo Romano

