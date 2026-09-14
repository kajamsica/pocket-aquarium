import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { validateReferenceEvidence } from './reference_evidence.mjs'

const specimen = 'new_fish'
const candidate = 'fable-v1'
const fixture = () => ({
  schemaVersion: 'pocket-aquarium.reference-comparison/v1',
  speciesId: specimen,
  sourceAssetPolicy: { copiedPixels: false, redistributedSourceImages: false, hotlinkedAssets: false },
  sources: [{ id: 'PHOTO-1', originalPageUrl: 'https://example.org/photos/specimen-123', creator: 'Example Museum', license: 'CC BY 4.0', accessedAt: '2026-09-09', allowedUse: 'visual reference only' }],
  views: {
    side: { status: 'observed', sourceIds: ['PHOTO-1'], notes: 'Lateral outline.' },
    top: { status: 'inferred', uncertainty: 'medium', notes: 'Width inferred from related anatomy.' },
    front: { status: 'inferred', uncertainty: 'high', notes: 'Head thickness inferred.' },
  },
  silhouetteLandmarks: [{ name: 'snout to peduncle', sourceIds: ['PHOTO-1'], sourceControls: ['morphology.controlStations'], notes: 'Stations follow the lateral silhouette.' }],
  proportions: [{ name: 'body depth / standard length', status: 'observed', referenceValue: { value: 0.32, unit: 'ratio' }, sourceIds: ['PHOTO-1'], sourceControls: ['morphology.controlStations[*].dorsalHeight'], notes: 'Depth is controlled by station heights.' }],
  colorPatternBoundaries: [{ name: 'midbody patch', sourceIds: ['PHOTO-1'], sourceControls: ['textures.bodyZones'], notes: 'Procedural boundary follows the reference.' }],
  candidateComparison: { mismatches: [{ area: 'fin rays', note: 'Represented as normal-map relief.' }], acceptanceBlockers: [] },
})

function root(data = fixture()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-reference-'))
  const packageDir = path.join(dir, 'art/specimens', specimen)
  fs.mkdirSync(packageDir, { recursive: true })
  if (data) fs.writeFileSync(path.join(packageDir, 'reference-comparison.json'), JSON.stringify(data))
  return dir
}

test('passes a complete package and returns hash-bound evidence', () => {
  const result = validateReferenceEvidence({ root: root(), speciesId: specimen, candidate })
  assert.equal(result.status, 'passed')
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
})

test('grandfathers only an exact accepted species and candidate pair', () => {
  const dir = root(null)
  fs.writeFileSync(path.join(dir, 'art/specimens/user-acceptance.v1.json'), JSON.stringify({ entries: [{ speciesId: specimen, candidate, status: 'user_accepted' }] }))
  assert.equal(validateReferenceEvidence({ root: dir, speciesId: specimen, candidate }).status, 'grandfathered')
  assert.throws(() => validateReferenceEvidence({ root: dir, speciesId: specimen, candidate: 'new-v2' }), /missing or invalid/)
})

test('blocks generic evidence, implicit missing views, unmapped proportions, and open blockers', () => {
  const cases = [
    ['generic page', (value) => { value.sources[0].originalPageUrl = 'https://commons.wikimedia.org/wiki/Category:New_fish' }, /originalPageUrl/],
    ['missing view label', (value) => { delete value.views.top.status }, /views.top/],
    ['unmapped proportion', (value) => { delete value.proportions[0].sourceControls }, /sourceControls/],
    ['open blocker', (value) => { value.candidateComparison.acceptanceBlockers.push('Side silhouette does not match.') }, /not_empty/],
  ]
  for (const [name, mutate, expected] of cases) {
    const value = fixture(); mutate(value)
    assert.throws(() => validateReferenceEvidence({ root: root(value), speciesId: specimen, candidate }), expected, name)
  }
})
