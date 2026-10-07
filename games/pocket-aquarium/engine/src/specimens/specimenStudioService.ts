// @ts-nocheck -- this project intentionally has no @types/node dependency.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const PREFIX = '/__specimen-studio/v1/specimens/'
const MAX_BODY_BYTES = 1024 * 1024
const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const OPERATIONS = new Map([
  ['GET status', 'status'],
  ['POST candidates/validate', 'validate'],
  ['POST candidates/accept', 'accept'],
])
const LIFECYCLE_SCRIPT = fileURLToPath(new URL('../../scripts/specimens/promote_specimen.mjs', import.meta.url))
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function send(response, status, payload) {
  response.statusCode = status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

async function readBody(request) {
  const advertised = Number(request.headers['content-length'] || 0)
  if (advertised > MAX_BODY_BYTES) throw Object.assign(new Error('payload_too_large'), { status: 413 })
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('payload_too_large'), { status: 413 })
    chunks.push(chunk)
  }
  if (!size) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }) }
}

function runLifecycle(root, operation, speciesId, payload) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [LIFECYCLE_SCRIPT, operation, '--species', speciesId], {
      cwd: root,
      env: { ...process.env, SPECIMEN_STUDIO_RLT_ROOT: root },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', rejectRun)
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8').trim()
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        const message = /^[a-z0-9_.-]{1,80}$/.test(detail) ? detail : 'lifecycle_failed'
        const status = message === 'payload_too_large' ? 413 : /stale|collision|promotion_in_progress/.test(message) ? 409 : 400
        return rejectRun(Object.assign(new Error(message), { status }))
      }
      try { resolveRun(JSON.parse(output)) }
      catch { rejectRun(Object.assign(new Error('invalid_lifecycle_response'), { status: 500 })) }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

export function specimenStudioService(options: { root?: string } = {}): Plugin {
  const root = resolve(options.root || DEFAULT_ROOT)
  return {
    name: 'pocket-aquarium-specimen-studio',
    apply: 'serve',
    configureServer(server) {
      const configuredHost = String(server.config.server.host || 'localhost')
      if (!['127.0.0.1', 'localhost', '::1'].includes(configuredHost)) throw new Error('Specimen Studio requires a loopback Vite host')
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith(PREFIX)) return next()
        if (!LOOPBACKS.has(request.socket.remoteAddress || '')) return send(response, 403, { error: 'loopback_only' })
        const parts = url.pathname.slice(PREFIX.length).split('/')
        const speciesId = parts.shift() || ''
        const operation = OPERATIONS.get(`${request.method} ${parts.join('/')}`)
        if (speciesId !== 'ocellaris') return send(response, 404, { error: 'unsupported_species' })
        if (!operation) return send(response, 405, { error: 'unsupported_operation' })
        if (request.method === 'POST' && !String(request.headers['content-type'] || '').startsWith('application/json')) return send(response, 415, { error: 'application_json_required' })
        const origin = request.headers.origin
        if (origin && !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin)) return send(response, 403, { error: 'loopback_origin_required' })
        try {
          const payload = request.method === 'POST' ? await readBody(request) : {}
          send(response, 200, await runLifecycle(root, operation, speciesId, payload))
        } catch (error) {
          send(response, error.status || 500, { error: error.status ? error.message : 'lifecycle_failed' })
        }
      })
    },
  }
}
