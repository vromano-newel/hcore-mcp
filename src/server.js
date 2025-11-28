import "dotenv/config";
import fs from "fs/promises";
import dotenv from "dotenv";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const envVars = {}; // valori caricati dal file environment Postman
const sessionVars = new Map(); // sessionId -> vars object
const globalVars = {}; // fallback quando non c'è session id

const server = new McpServer({
  name: "adherence-mcp",
  version: "0.1.0",
});

function parseList(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolvePath(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function collectCollectionEntries(envEntries, fallbackEnv = process.env) {
  const source = envEntries && Object.keys(envEntries).length > 0 ? envEntries : fallbackEnv;
  const entries = [];
  for (const [key, value] of Object.entries(source)) {
    if (key === "POSTMAN_ENVIRONMENT_FILE") continue;
    if (!value) continue;
    const baseName = key.replace(/_PATH$/i, "");
    for (const entry of parseList(value)) {
      entries.push({ key: baseName, path: entry });
    }
  }
  return entries;
}

async function readJsonFile(pathStr) {
  const raw = await fs.readFile(pathStr, "utf-8");
  return JSON.parse(raw);
}

async function loadPostmanEnvironment(pathStr) {
  if (!pathStr) return {};
  try {
    const resolved = resolvePath(pathStr);
    const envJson = await readJsonFile(resolved);
    const values = envJson?.values || [];
    const collected = {};
    for (const entry of values) {
      if (!entry?.key) continue;
      if (entry.enabled === false) continue;
      collected[entry.key] = entry?.value ?? "";
    }
    return collected;
  } catch (err) {
    console.error(`Impossibile caricare l'environment Postman ${pathStr}:`, err);
    return {};
  }
}

async function loadPostmanCollection(pathStr) {
  const resolved = resolvePath(pathStr);
  const json = await readJsonFile(resolved);
  const name = json?.info?.name || resolved.split("/").pop() || "collection";
  const items = json?.item || [];
  return { name, items, source: resolved };
}

function resolveTemplates(str, vars = envVars) {
  if (typeof str !== "string") return str;
  return str.replace(/{{([^}]+)}}/g, (_, varName) => {
    const key = varName.trim();
    return vars[key] !== undefined ? vars[key] : `{{${key}}}`;
  });
}

function getScopeVars(extra) {
  const sessionId = extra?.sessionId;
  if (sessionId) {
    if (!sessionVars.has(sessionId)) {
      // inizializza la sessione con i valori dell'environment caricati
      sessionVars.set(sessionId, { ...envVars });
    }
    return sessionVars.get(sessionId);
  }
  return globalVars;
}

function slugify(parts) {
  const joined = parts.join("__");
  return joined
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_")
    .slice(0, 100);
}

function toHeaderObject(headers = []) {
  const acc = {};
  for (const entry of headers) {
    if (!entry || entry.disabled) continue;
    if (!entry.key) continue;
    acc[entry.key] = entry.value ?? "";
  }
  return acc;
}

function toQueryObject(query = []) {
  const acc = {};
  for (const q of query) {
    if (!q || q.disabled) continue;
    if (!q.key) continue;
    acc[q.key] = q.value ?? "";
  }
  return acc;
}

function buildRawUrl(urlDef = {}, vars) {
  if (typeof urlDef === "string") {
    return resolveTemplates(urlDef, vars);
  }
  if (urlDef.raw) {
    return resolveTemplates(urlDef.raw, vars);
  }
  const protocol = urlDef.protocol ? `${urlDef.protocol}://` : "";
  const host = Array.isArray(urlDef.host) ? urlDef.host.join(".") : "";
  const port = urlDef.port ? `:${urlDef.port}` : "";
  const path = Array.isArray(urlDef.path) ? `/${urlDef.path.join("/")}` : "";
  const raw = `${protocol}${host}${port}${path}`;
  return resolveTemplates(raw, vars);
}

function buildBodyFromDefinition(bodyDef, vars) {
  if (!bodyDef) return { body: undefined, contentType: undefined, isFormData: false };
  const mode = bodyDef.mode;
  if (mode === "raw") {
    const rawContent = resolveTemplates(bodyDef.raw || "", vars);
    const lang = bodyDef.options?.raw?.language;
    const inferredContentType = lang === "json" ? "application/json" : undefined;
    return { body: rawContent, contentType: inferredContentType, isFormData: false };
  }
  if (mode === "urlencoded") {
    const params = new URLSearchParams();
    for (const entry of bodyDef.urlencoded || []) {
      if (entry.disabled) continue;
      if (!entry.key) continue;
      params.append(entry.key, resolveTemplates(entry.value ?? "", vars));
    }
    return { body: params, contentType: "application/x-www-form-urlencoded", isFormData: false };
  }
  if (mode === "formdata") {
    const form = new FormData();
    for (const entry of bodyDef.formdata || []) {
      if (entry.disabled) continue;
      if (!entry.key) continue;
      form.append(entry.key, resolveTemplates(entry.value ?? "", vars));
    }
    return { body: form, contentType: undefined, isFormData: true };
  }
  return { body: undefined, contentType: undefined, isFormData: false };
}

function makeEndpointSlug(nameParts, method, slugCounter) {
  const leaf = nameParts[nameParts.length - 1] || "endpoint";
  const parent = nameParts.slice(0, -1).join(" ");
  const candidates = [
    slugify([leaf, method]),
    slugify([leaf]),
    slugify([parent, leaf, method]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!slugCounter[candidate]) {
      slugCounter[candidate] = 1;
      return candidate;
    }
  }
  const base = candidates[0] || "endpoint";
  const count = (slugCounter[base] = (slugCounter[base] || 1) + 1);
  return `${base}_${count}`;
}

function flattenCollectionItems(items, parentNames = [], slugCounter = {}) {
  const requests = [];
  for (const item of items || []) {
    const currentNames = [...parentNames, item?.name || "item"];
    if (item?.request) {
      const method = String(item.request.method || "GET").toUpperCase();
      const finalSlug = makeEndpointSlug(currentNames, method, slugCounter);
      requests.push({
        key: finalSlug,
        name: currentNames.join(" / "),
        method,
        url: item.request.url,
        headers: item.request.header || [],
        query: item.request.url?.query || [],
        body: item.request.body,
        description: item.request.description || item.description || "",
      });
    }
    if (Array.isArray(item?.item) && item.item.length > 0) {
      requests.push(...flattenCollectionItems(item.item, currentNames, slugCounter));
    }
  }
  return requests;
}

function buildToolsFromCollections(collections) {
  for (const collection of collections) {
    const endpoints = flattenCollectionItems(collection.items);
    if (endpoints.length === 0) continue;
    const endpointKeys = endpoints.map((e) => e.key);
    const endpointEnum = z.enum(endpointKeys);
    const preview = endpointKeys.slice(0, 15).join(", ");
    const suffix = endpointKeys.length > 15 ? ", ..." : "";

    server.registerTool(
      collection.toolName || slugify([collection.name]),
      {
        description: `Chiamate API dalla collection "${collection.label || collection.name}" (${endpoints.length} endpoint): ${preview}${suffix}`,
        inputSchema: z.object({
          endpoint: endpointEnum,
          headers: z.record(z.string()).optional(),
          query: z.record(z.string()).optional(),
          body: z.union([z.string(), z.record(z.any()), z.array(z.any())]).optional(),
          vars: z.record(z.string()).optional(),
        }),
      },
      async (input, extra) => {
        const endpoint = endpoints.find((e) => e.key === input.endpoint);
        if (!endpoint) throw new Error("Endpoint non valido");

        const scopeVars = getScopeVars(extra);
        const templateVars = { ...envVars, ...globalVars, ...scopeVars, ...(input.vars || {}) };

        const rawUrl = buildRawUrl(endpoint.url, templateVars);
        let targetUrl;
        try {
          targetUrl = new URL(rawUrl);
        } catch (err) {
          throw new Error(`URL non valido per ${endpoint.name}: ${rawUrl}`);
        }

        const defaultQuery = toQueryObject(endpoint.query);
        for (const [k, v] of Object.entries(defaultQuery)) {
          targetUrl.searchParams.set(k, resolveTemplates(v, templateVars));
        }
        for (const [k, v] of Object.entries(input.query || {})) {
          targetUrl.searchParams.set(k, resolveTemplates(String(v), templateVars));
        }

        const defaultHeaders = toHeaderObject(endpoint.headers);
        const headers = {};
        for (const [k, v] of Object.entries(defaultHeaders)) {
          headers[k] = resolveTemplates(String(v), templateVars);
        }
        for (const [k, v] of Object.entries(input.headers || {})) {
          headers[k] = resolveTemplates(String(v), templateVars);
        }

        const bodyOverride = input.body;
        let bodyPayload;
        let contentType;
        let isFormData = false;

        if (bodyOverride !== undefined && bodyOverride !== null) {
          const isString = typeof bodyOverride === "string";
          if (isString) {
            bodyPayload = resolveTemplates(bodyOverride, templateVars);
          } else {
            // Se l'endpoint originale usa formdata, crea FormData solo con i campi passati dall'utente
            // I campi formdata dell'endpoint originale vengono ignorati quando si passa bodyOverride
            if (endpoint.body?.mode === "formdata") {
              const form = new FormData();
              // Aggiungi solo i campi specificati dall'utente, ignorando quelli dell'endpoint originale
              for (const [key, value] of Object.entries(bodyOverride)) {
                form.append(key, resolveTemplates(String(value), templateVars));
              }
              bodyPayload = form;
              isFormData = true;
            } else {
              bodyPayload = JSON.stringify(bodyOverride);
              contentType = "application/json";
            }
          }
        } else {
          const { body, contentType: defContentType, isFormData: defIsFormData } =
            buildBodyFromDefinition(endpoint.body, templateVars);
          bodyPayload = body;
          contentType = defContentType;
          isFormData = defIsFormData;
        }

        if (contentType && !headers["Content-Type"]) {
          headers["Content-Type"] = contentType;
        }

        const fetchOptions = { method: endpoint.method, headers };
        if (endpoint.method !== "GET" && endpoint.method !== "HEAD") {
          fetchOptions.body = bodyPayload;
          if (isFormData && fetchOptions.headers && fetchOptions.headers["Content-Type"]) {
            delete fetchOptions.headers["Content-Type"];
          }
        }

        const res = await fetch(targetUrl, fetchOptions);
        const text = await res.text();
        const contentTypeHeader = res.headers.get("content-type") || "";
        const isJson = contentTypeHeader.includes("application/json");
        let parsedJson = null;
        if (isJson) {
          try {
            parsedJson = JSON.parse(text);
          } catch {
            parsedJson = null;
          }
        }

        if (!res.ok) {
          const errorText = parsedJson ? JSON.stringify(parsedJson, null, 2) : text;
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        let payload = text;
        if (parsedJson) {
          payload = JSON.stringify(parsedJson, null, 2);
        }
        return {
          content: [{ type: "text", text: payload }],
        };
      }
    );
  }
}

async function main() {
  let envFileVars = {};
  try {
    const raw = await fs.readFile(resolvePath(".env"), "utf-8");
    envFileVars = dotenv.parse(raw);
  } catch {
    // se non c'è il file .env, si usa process.env
  }

  const envFile = envFileVars.POSTMAN_ENVIRONMENT_FILE || process.env.POSTMAN_ENVIRONMENT_FILE;
  const collectionEntries = collectCollectionEntries(envFileVars);

  const loadedEnv = await loadPostmanEnvironment(envFile);
  Object.assign(envVars, loadedEnv);
  Object.assign(globalVars, loadedEnv);

  if (collectionEntries.length === 0) {
    console.warn("Nessuna collection specificata nel file .env.");
  }
  console.info(
    `Percorsi collection letti da .env: ${
      collectionEntries.map((e) => `${e.key}:${e.path}`).join(", ") || "nessuno"
    }`
  );
  const collections = [];
  for (const { key, path } of collectionEntries) {
    try {
      const col = await loadPostmanCollection(path);
      const toolName = slugify([key || col.name || "collection"]);
      const label = col.name || key || path;
      collections.push({ ...col, toolName, label });
    } catch (err) {
      console.error(`Errore caricando la collection ${path}:`, err);
    }
  }
  if (collections.length === 0) {
    console.warn("Nessuna collection Postman caricata: non verranno esposti tool API.");
  } else {
    console.info(
      `Caricate ${collections.length} collection Postman: ${collections
        .map((c) => c.label)
        .join(", ")}`
    );
  }

  server.registerTool(
    "set_vars",
    {
      description:
        "Imposta variabili di default (scope sessione o globale) riutilizzabili dalle chiamate successive.",
      inputSchema: z.object({
        vars: z.record(z.string()).optional(),
        clear: z.array(z.string()).optional(),
        resetToEnvironment: z.boolean().optional(),
        scope: z.enum(["session", "global"]).optional(),
      }),
    },
    async ({ vars, clear, scope, resetToEnvironment }, extra) => {
      const targetScope = scope || "session";
      const bag = targetScope === "session" ? getScopeVars(extra) : globalVars;
      const effectiveVars = { ...(vars || {}) };
      const hasVars = Object.keys(effectiveVars).length > 0;
      const hasClear = Array.isArray(clear) && clear.length > 0;
      if (!hasVars && !hasClear && !resetToEnvironment) {
        return {
          content: [
            {
              type: "text",
              text: "Nessuna variabile fornita. Specifica almeno vars, clear o resetToEnvironment.",
            },
          ],
          isError: true,
        };
      }
      if (resetToEnvironment) {
        for (const key of Object.keys(bag)) {
          delete bag[key];
        }
        Object.assign(bag, envVars);
      }
      if (Array.isArray(clear)) {
        for (const key of clear) {
          delete bag[key];
        }
      }
      Object.assign(bag, effectiveVars);
      return {
        content: [
          {
            type: "text",
            text: `Impostate ${Object.keys(effectiveVars).length} variabili in scope ${targetScope}${
              resetToEnvironment ? " (reset dall'environment)" : ""
            }.`,
          },
        ],
      };
    }
  );

  buildToolsFromCollections(collections);
  await server.connect(new StdioServerTransport());
  try {
    await server.sendToolListChanged();
  } catch {
    // ignore
  }
}

await main();
