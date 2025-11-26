import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_ENVIRONMENT_URL =
  process.env.ENVIRONMENT_URL ||
  "https://adherence-stage-obesity.hcore.app/api/discover?endpoints&format=openapi";
const CLIENT_ID = process.env.CLIENT_ID || "";

const envVars = {};
const sessionVars = new Map(); // sessionId -> vars object
const globalVars = {}; // fallback when no session id

const server = new McpServer({
  name: "adherence-mcp",
  version: "0.1.0",
});

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
      sessionVars.set(sessionId, {});
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

function toolNameFromPath(pathStr, method) {
  const cleaned = pathStr.split("/").filter(Boolean);
  const segments = cleaned.slice(-2);
  const withMethod = method ? [method, ...segments] : segments;
  const slug = slugify(withMethod);
  return slug || "endpoint";
}

function collectEnvironmentTargets() {
  const targets = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (key === "ENVIRONMENT_URL" || /_ENV_URL$/i.test(key)) {
      const apiKey =
        key === "ENVIRONMENT_URL" ? "default" : key.replace(/_ENV_URL$/i, "").toLowerCase();
      targets.push({ apiKey, url: value });
    }
  }
  if (targets.length === 0) {
    targets.push({ apiKey: "default", url: DEFAULT_ENVIRONMENT_URL });
  }
  return targets;
}

async function loadOpenApiSpecs() {
  const targets = collectEnvironmentTargets();
  const specs = [];
  for (const target of targets) {
    const res = await fetch(target.url);
    if (!res.ok) {
      throw new Error(
        `Errore caricando ${target.apiKey} (${target.url}): HTTP ${res.status}`
      );
    }
    const spec = await res.json();
    const serverUrl = spec?.servers?.[0]?.url;
    let derivedBase = "";
    if (serverUrl) {
      derivedBase = serverUrl;
    } else {
      try {
        derivedBase = new URL(target.url).origin;
      } catch {
        derivedBase = "";
      }
    }
    specs.push({
      apiKey: target.apiKey,
      url: target.url,
      baseUrl: derivedBase,
      spec,
    });
  }
  return specs;
}

function buildUrl(baseUrl, pathTemplate, vars) {
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const resolvedPath = resolveTemplates(pathTemplate, vars);
  if (/^https?:\/\//i.test(resolvedPath)) {
    return new URL(resolvedPath);
  }
  if (!base) {
    throw new Error(
      `URL relativo senza base. Fornisci url assoluto o definisci un server nell'OpenAPI.`
    );
  }
  const withSlash = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;
  return new URL(`${base}${withSlash}`);
}

function buildToolsFromOpenApis(apiSpecs) {
  const methods = ["get", "post", "put", "patch", "delete", "options", "head"];

  for (const { apiKey, spec, baseUrl } of apiSpecs) {
    const paths = spec?.paths || {};
    const endpointMap = {};
    const slugCounter = {};

    for (const [pathKey, operations] of Object.entries(paths)) {
      const cleaned = pathKey.split("/").filter(Boolean);
      const baseSlug = slugify(cleaned.slice(-2)) || "endpoint";

      for (const method of methods) {
        if (!operations?.[method]) continue;

        const methodSlug = toolNameFromPath(pathKey, method);
        let candidate = baseSlug;
        if (endpointMap[candidate]) {
          candidate = methodSlug;
        }
        if (endpointMap[candidate]) {
          slugCounter[candidate] = (slugCounter[candidate] || 0) + 1;
          candidate = `${candidate}_${slugCounter[candidate]}`;
        }

        endpointMap[candidate] = { method, pathKey };
      }
    }

    const endpointKeys = Object.keys(endpointMap);
    if (endpointKeys.length === 0) continue;

    const listPreview = endpointKeys.slice(0, 20).join(", ");
    const hasMore = endpointKeys.length > 20 ? ", ..." : "";

    const endpointEnum = z.enum(endpointKeys);

    server.registerTool(
      apiKey.toLowerCase(),
      {
        description: `Chiamate API ${apiKey}. endpoint (tot ${endpointKeys.length}): ${listPreview}${hasMore}`,
        inputSchema: z.object({
          endpoint: endpointEnum,
          url: z.string().url().optional(),
          headers: z.record(z.string()).optional(),
          query: z.record(z.string()).optional(),
          form: z.record(z.any()).optional(),
          body: z.union([z.string(), z.record(z.any()), z.array(z.any())]).optional(),
          userToken: z.string().optional(),
          adminApiKey: z.string().optional(),
          vars: z.record(z.string()).optional(),
        }),
      },
      async (input, extra) => {
        const targetOp = endpointMap[input.endpoint];
        if (!targetOp) {
          throw new Error("Endpoint non valido");
        }

        const scopeVars = getScopeVars(extra);
        const templateVars = {
          ...envVars,
          ...scopeVars,
          ...(input.vars || {}),
          ...(input.userToken ? { userToken: input.userToken } : {}),
          ...(input.adminApiKey ? { "admin-apiKey": input.adminApiKey } : {}),
        };

        const targetUrl = buildUrl(baseUrl, input.url || targetOp.pathKey, templateVars);

        for (const [key, value] of Object.entries(input.query || {})) {
          targetUrl.searchParams.set(key, String(value));
        }

        const headers = { ...(input.headers || {}) };
        if (apiKey === "auth" && targetOp.pathKey === "/token/password" && CLIENT_ID) {
          if (!headers.Authorization) {
            headers.Authorization = CLIENT_ID;
          }
        }
        const fetchOptions = { method: targetOp.method.toUpperCase(), headers };

        const hasForm = input.form;
        if (targetOp.method.toUpperCase() !== "GET" && hasForm) {
          const form = new FormData();
          for (const [key, value] of Object.entries(hasForm)) {
            form.append(key, value === undefined || value === null ? "" : String(value));
          }
          fetchOptions.body = form;
          if (fetchOptions.headers && fetchOptions.headers["Content-Type"]) {
            delete fetchOptions.headers["Content-Type"];
          }
        } else if (targetOp.method.toUpperCase() !== "GET") {
          const chosenBody = input.body;
          if (chosenBody !== null && chosenBody !== undefined) {
            const isString = typeof chosenBody === "string";
            fetchOptions.body = isString ? chosenBody : JSON.stringify(chosenBody);
            fetchOptions.headers = {
              ...fetchOptions.headers,
              "Content-Type": fetchOptions.headers?.["Content-Type"] || "application/json",
            };
          }
        }

        const res = await fetch(targetUrl, fetchOptions);
        const text = await res.text();
        const contentType = res.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        let parsedJson = null;
        if (isJson) {
          try {
            parsedJson = JSON.parse(text);
          } catch {
            parsedJson = null;
          }
        }
        if (!parsedJson) {
          try {
            parsedJson = JSON.parse(text);
          } catch {
            parsedJson = null;
          }
        }

        if (!res.ok) {
          let errorText = text;
          if (isJson) {
            try {
              errorText = JSON.stringify(JSON.parse(text), null, 2);
            } catch {
              // keep raw text
            }
          }
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        if (apiKey === "auth" && targetOp.pathKey === "/token/password" && parsedJson) {
          const token = parsedJson.accessToken || parsedJson.access_token;
          if (typeof token === "string" && token.trim()) {
            const bag = getScopeVars(extra);
            bag.userToken = token;
          }
        }

        let payload = text;
        if (parsedJson) {
          try {
            payload = JSON.stringify(parsedJson, null, 2);
          } catch {
            // leave as text
          }
        }
        return {
          content: [{ type: "text", text: payload }],
        };
      }
    );
  }
}

async function main() {
  const specs = await loadOpenApiSpecs();

  server.registerTool(
    "set_vars",
    {
      description:
        "Imposta variabili di default (scope sessione o globale) riutilizzabili dalle chiamate successive.",
      inputSchema: z.object({
        vars: z.record(z.string()).optional(),
        userToken: z.string().optional(),
        adminApiKey: z.string().optional(),
        clear: z.array(z.string()).optional(),
        scope: z.enum(["session", "global"]).optional(),
      }),
    },
    async ({ vars, clear, scope, userToken, adminApiKey }, extra) => {
      const targetScope = scope || "session";
      const bag = targetScope === "session" ? getScopeVars(extra) : globalVars;
      const effectiveVars = { ...(vars || {}) };
      if (userToken) effectiveVars.userToken = userToken;
      if (adminApiKey) effectiveVars["admin-apiKey"] = adminApiKey;
      if (Object.keys(effectiveVars).length === 0 && (!clear || clear.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: "Nessuna variabile fornita. Specifica almeno vars, userToken o adminApiKey.",
            },
          ],
          isError: true,
        };
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
            text: `Impostate ${Object.keys(effectiveVars).length} variabili in scope ${targetScope}.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "set_user_token",
    {
      description: "Imposta userToken (scope di sessione di default) per le chiamate successive.",
      inputSchema: z.object({
        userToken: z.string(),
        scope: z.enum(["session", "global"]).optional(),
      }),
    },
    async ({ userToken, scope }, extra) => {
      const targetScope = scope || "session";
      const bag = targetScope === "session" ? getScopeVars(extra) : globalVars;
      bag.userToken = userToken;
      return {
        content: [
          {
            type: "text",
            text: `Impostato userToken in scope ${targetScope}.`,
          },
        ],
      };
    }
  );

  buildToolsFromOpenApis(specs);
  await server.connect(new StdioServerTransport());
  try {
    await server.sendToolListChanged();
  } catch {
    // ignore
  }
}

await main();
