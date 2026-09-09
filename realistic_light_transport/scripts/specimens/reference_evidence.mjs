import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const REFERENCE_SCHEMA = 'pocket-aquarium.reference-comparison/v1'
const SAFE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const text = (value) => typeof value === 'string' && value.trim().length > 0
const list = (value) => Array.isArray(value) && value.length > 0

function json(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function isGeneric(url) {
  try {
    const parsed = new URL(url)
    const haystack = `${parsed.pathname}${parsed.search}`.toLowerCase()
    return !['http:', 'https:'].includes(parsed.protocol) || parsed.pathname === '/' || /(?:category:|\/categor(?:y|ies)(?:\/|$)|\/search(?:\/|$)|special:mediasearch|[?&](?:q|query|search|keyword)=)/.test(haystack)
  } catch { return true }
}

function grandfathered(root, speciesId, candidate) {
  const user = json(path.join(root, 'art/specimens/user-acceptance.v1.json'))
  if (user?.entries?.some((entry) => entry.speciesId === speciesId && entry.candidate === candidate && entry.status === 'user_accepted')) return 'user-acceptance.v1.json'
  const runtime = json(path.join(root, 'src/assets/specimens/runtime-acceptance.v1.json'))
  if (runtime?.assets?.some((entry) => entry.speciesId === speciesId && entry.sourceCandidate === candidate)) return 'runtime-acceptance.v1.json'
  return null
}

export function validateReferenceEvidence({ root, speciesId, candidate }) {
  if (!SAFE.test(speciesId) || !SAFE.test(candidate)) throw new Error('reference evidence: unsafe species or candidate name')
  const legacy = grandfathered(root, speciesId, candidate)
  if (legacy) return { status: 'grandfathered', basis: legacy }
  const relativePath = `art/specimens/${speciesId}/reference-comparison.json`
  const file = path.join(root, relativePath)
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  let data
  try { data = raw && JSON.parse(raw) } catch {}
  if (!data) throw new Error(`reference evidence: ${relativePath} is missing or invalid JSON`)

  const errors = []
  if (data.schemaVersion !== REFERENCE_SCHEMA) errors.push('schemaVersion')
  if (data.speciesId !== speciesId) errors.push('speciesId')
  const usage = data.sourceAssetPolicy
  if (usage?.copiedPixels !== false || usage?.redistributedSourceImages !== false || usage?.hotlinkedAssets !== false) errors.push('sourceAssetPolicy')
  const sources = list(data.sources) ? data.sources : []
  if (!sources.length) errors.push('sources')
  const sourceIds = new Set()
  for (const source of sources) {
    if (!text(source?.id) || sourceIds.has(source.id)) errors.push('source.id')
    else sourceIds.add(source.id)
    if (!text(source?.originalPageUrl) || isGeneric(source.originalPageUrl)) errors.push(`${source?.id || 'source'}.originalPageUrl`)
    for (const key of ['creator', 'license', 'accessedAt', 'allowedUse']) if (!text(source?.[key])) errors.push(`${source?.id || 'source'}.${key}`)
    if (text(source?.accessedAt) && !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedAt)) errors.push(`${source.id}.accessedAt`)
  }
  const checkSourceIds = (owner, ids) => {
    if (!list(ids)) errors.push(`${owner}.sourceIds`)
    else for (const id of ids) if (!sourceIds.has(id)) errors.push(`${owner}.sourceIds:${id}`)
  }
  for (const view of ['side', 'top', 'front']) {
    const evidence = data.views?.[view]
    if (!evidence || !['observed', 'inferred'].includes(evidence.status) || !text(evidence.notes)) errors.push(`views.${view}`)
    else if (evidence.status === 'observed') checkSourceIds(`views.${view}`, evidence.sourceIds)
    else if (!text(evidence.uncertainty)) errors.push(`views.${view}.uncertainty`)
  }
  for (const [key, controlsRequired, measured] of [['silhouetteLandmarks', true, false], ['proportions', true, true], ['colorPatternBoundaries', true, false]]) {
    const entries = data[key]
    if (!list(entries)) { errors.push(key); continue }
    entries.forEach((entry, index) => {
      const owner = `${key}[${index}]`
      if (!text(entry?.name) || !text(entry?.notes)) errors.push(owner)
      if (measured) {
        if (!['observed', 'inferred'].includes(entry?.status)) errors.push(`${owner}.status`)
        else if (entry.status === 'observed') checkSourceIds(owner, entry.sourceIds)
        else if (!text(entry.uncertainty)) errors.push(`${owner}.uncertainty`)
      } else checkSourceIds(owner, entry?.sourceIds)
      if (controlsRequired && (!list(entry?.sourceControls) || entry.sourceControls.some((control) => !text(control)))) errors.push(`${owner}.sourceControls`)
      if (measured && (!Number.isFinite(entry?.referenceValue?.value) || !text(entry?.referenceValue?.unit))) errors.push(`${owner}.referenceValue`)
    })
  }
  if (!list(data.candidateComparison?.mismatches) || data.candidateComparison.mismatches.some((item) => !text(item?.area) || !text(item?.note))) errors.push('candidateComparison.mismatches')
  if (!Array.isArray(data.candidateComparison?.acceptanceBlockers)) errors.push('candidateComparison.acceptanceBlockers')
  else if (data.candidateComparison.acceptanceBlockers.length) errors.push('candidateComparison.acceptanceBlockers:not_empty')
  if (errors.length) throw new Error(`reference evidence: ${errors.join(', ')}`)
  return { status: 'passed', schemaVersion: REFERENCE_SCHEMA, path: relativePath, sha256: createHash('sha256').update(raw).digest('hex') }
}
