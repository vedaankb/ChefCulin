/**
 * Chat completions via the CulinAI backend proxy (§2.9).
 *
 * The key lives on the API process and never reaches the browser. As a VITE_
 * variable it compiled into the bundle, where it is readable from the network
 * tab of any hosted page — fine on localhost, not fine behind a demo link.
 *
 * Set OPENAI_API_KEY in the environment that runs `npm run api`. A direct
 * browser-side key is still honoured for local work if VITE_OPENAI_API_KEY is
 * set, but the proxy is the default path and the only one safe to deploy.
 */

const PROXY_PATH = '/llm/chat'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

/** Mirrors src/api.js — the proxy rides the same base as every other call. */
function apiBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
    return String(import.meta.env.VITE_API_BASE)
  }
  return '/api'
}

function readEnv(name) {
  if (typeof import.meta !== 'undefined' && import.meta.env?.[name]) {
    return String(import.meta.env[name]).trim()
  }
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return String(process.env[name]).trim()
  }
  return ''
}

/** API key: VITE_OPENAI_API_KEY in dev; OPENAI_API_KEY for Vitest live runs. */
function openaiApiKey() {
  return readEnv('VITE_OPENAI_API_KEY') || readEnv('OPENAI_API_KEY')
}

/**
 * True when a browser-side key is present. The proxy path does not need one,
 * so this is no longer the only way the LLM can be reachable — callers that
 * gate on it are asking "can I call OpenAI directly", not "is the LLM up".
 */
export function openaiConfigured() {
  return Boolean(openaiApiKey())
}

/** Whether the backend proxy can serve. Never returns the key itself. */
export async function proxyConfigured() {
  try {
    const res = await fetch(new URL(`${apiBase()}/llm/status`, window.location.origin))
    if (!res.ok) return false
    const body = await res.json()
    return Boolean(body.configured)
  } catch {
    return false
  }
}

function defaultModel() {
  return readEnv('VITE_OPENAI_MODEL') || readEnv('OPENAI_MODEL') || DEFAULT_MODEL
}

/**
 * @param {object} body — OpenAI chat completions body (messages, tools, temperature, …)
 */
export async function llmChat(body) {
  const payload = { model: defaultModel(), ...body }
  const key = openaiApiKey()

  // Direct call only when a browser-side key was deliberately provided (local
  // work, and the Vitest live suites which run outside a browser). Otherwise
  // the request goes through the backend, where the credential lives.
  const url = key ? OPENAI_URL : new URL(`${apiBase()}${PROXY_PATH}`, baseOrigin())
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const via = key ? 'OpenAI' : 'LLM proxy'
    throw new Error(`${via} ${res.status}${detail ? `: ${detail.slice(0, 400)}` : ''}`)
  }

  return res.json()
}

/** window.location in the browser; a stable stand-in under Node test runners. */
function baseOrigin() {
  if (typeof window !== 'undefined' && window.location) return window.location.origin
  return 'http://127.0.0.1:8001'
}
