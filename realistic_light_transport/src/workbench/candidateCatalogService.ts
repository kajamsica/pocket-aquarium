// @ts-nocheck -- this project intentionally has no @types/node dependency.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// Dev-only review surface: lists visual-catalog candidate packages under art/specimens/*/candidates/*
// and streams their review files. Candidates never enter the runtime bundle or the accepted asset
// registry; the workbench loads them explicitly for inspection while they await user acceptance.
const PREFIX = '/__catalog/v1/candidates'
const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const SERVED_FILES = new Map([
  ['lod1.glb', 'model/gltf-binary'],
  ['renders/author-preview.png', 'image/png'],
  ['renders/three-view.png', 'image/png'],
  ['candidate.manifest.json', 'application/json; charset=utf-8'],
  ['validation-receipt.json', 'application/json; charset=utf-8'],
  ['build-receipt.json', 'application/json; charset=utf-8'],
])
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function send(response, status, payload) {
  response.statusCode = status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

export function indexCandidates(root) {
  const specimens = join(root, 'art', 'specimens')
  if (!existsSync(specimens)) return []
  const entries = []
  for (const speciesId of readdirSync(specimens).sort()) {
    const candidates = join(specimens, speciesId, 'candidates')
    if (!SAFE_SEGMENT.test(speciesId) || !existsSync(candidates) || !statSync(candidates).isDirectory()) continue
    for (const candidate of readdirSync(candidates).sort()) {
      const dir = join(candidates, candidate)
      if (!SAFE_SEGMENT.test(candidate) || !statSync(dir).isDirectory()) continue
      const glb = join(dir, 'lod1.glb')
      const manifest = readJson(join(dir, 'candidate.manifest.json'))
      const build = readJson(join(dir, 'build-receipt.json'))
      const receipt = readJson(join(dir, 'validation-receipt.json'))
      const hasGlb = existsSync(glb) && statSync(glb).size > 0
      entries.push({
        speciesId,
        candidate,
        loadable: Boolean(hasGlb && manifest),
        displayName: manifest?.displayName ?? speciesId,
        scientificName: manifest?.scientificName ?? null,
        variantId: manifest?.variantId ?? null,
        assetVersion: manifest?.assetVersion ?? null,
        bodyPlan: manifest?.bodyPlan ?? null,
        referenceGrade: manifest?.referenceGrade ?? null,
        referenceSizeMeters: manifest?.referenceSizeMeters ?? null,
        referenceSizeKind: manifest?.referenceSizeKind ?? null,
        origin: manifest?.origin ?? null,
        clipRoles: manifest?.clipRoles ?? null,
        clipLoops: manifest?.clipLoops ?? null,
        clips: manifest?.statistics?.clips ?? [],
        statistics: manifest?.statistics ?? null,
        candidateState: manifest?.candidate?.state ?? 'unknown',
        candidateHash: manifest?.candidate?.candidateHash ?? receipt?.candidateHash ?? null,
        validatorStatus: manifest?.validator?.status ?? 'pending',
        buildStatus: build?.status ?? (hasGlb ? 'unknown' : 'incomplete'),
        buildFailedStage: build?.failure?.stage ?? null,
        buildFinishedAt: build?.finishedAt ?? null,
        glbBytes: hasGlb ? statSync(glb).size : 0,
        glbSha256: manifest?.runtimeGlbSha256?.lod1 ?? null,
        files: {
          glb: hasGlb ? `${PREFIX}/${speciesId}/${candidate}/lod1.glb` : null,
          authorPreview: existsSync(join(dir, 'renders', 'author-preview.png')) ? `${PREFIX}/${speciesId}/${candidate}/renders/author-preview.png` : null,
          threeView: existsSync(join(dir, 'renders', 'three-view.png')) ? `${PREFIX}/${speciesId}/${candidate}/renders/three-view.png` : null,
        },
      })
    }
  }
  return entries
}

export function candidateCatalogService(options: { root?: string } = {}): Plugin {
  const root = resolve(options.root || DEFAULT_ROOT)
  return {
    name: 'pocket-aquarium-candidate-catalog',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith(PREFIX)) return next()
        if (!LOOPBACKS.has(request.socket.remoteAddress || '')) return send(response, 403, { error: 'loopback_only' })
        if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'get_only' })
        const rest = url.pathname.slice(PREFIX.length)
        if (rest === '.json' || rest === '' || rest === '/') {
          return send(response, 200, { schemaVersion: 1, generatedAt: new Date().toISOString(), candidates: indexCandidates(root) })
        }
        const parts = rest.replace(/^\//, '').split('/')
        const speciesId = parts.shift() || ''
        const candidate = parts.shift() || ''
        const file = parts.join('/')
        const contentType = SERVED_FILES.get(file)
        if (!SAFE_SEGMENT.test(speciesId) || !SAFE_SEGMENT.test(candidate) || !contentType) return send(response, 404, { error: 'not_found' })
        const path = join(root, 'art', 'specimens', speciesId, 'candidates', candidate, file)
        if (!existsSync(path) || !statSync(path).isFile()) return send(response, 404, { error: 'not_found' })
        response.statusCode = 200
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', contentType)
        response.setHeader('Content-Length', String(statSync(path).size))
        if (request.method === 'HEAD') return response.end()
        createReadStream(path).pipe(response)
      })
    },
  }
}
