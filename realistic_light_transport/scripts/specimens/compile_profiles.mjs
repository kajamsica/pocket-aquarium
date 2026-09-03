import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RLT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const REPO_ROOT = resolve(RLT_ROOT, '..')
const SPECIMEN_ROOT = resolve(RLT_ROOT, 'art/specimens')
const OUTPUT = resolve(REPO_ROOT, 'js/specimenProfiles.js')
const REQUIRED_HASH = 'ed4d447b2c7d88e91f45699a76b2ff3768144b57e6acb4199000567bafe37ac0'
const fail = (message) => { throw new Error(message) }
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value

function visit(value, callback) {
  if (!value || typeof value !== 'object') return
  if ('status' in value && 'evidenceClass' in value && 'disposition' in value) callback(value)
  for (const child of Object.values(value)) visit(child, callback)
}

function validateEvidence(value, sourceIds, label, requiredClass = null) {
  visit(value, (entry) => {
    if (entry.status === 'unset_required' && entry.value !== null) fail(`${label}: unset_required must retain null`)
    if (entry.status === 'supported' && entry.value === null) fail(`${label}: supported evidence cannot be null`)
    if (requiredClass && entry.evidenceClass !== requiredClass) fail(`${label}: expected ${requiredClass}`)
    for (const sourceId of entry.sourceRefs) if (!sourceIds.has(sourceId)) fail(`${label}: unknown source ${sourceId}`)
  })
}

function validateAxis(axis, label) {
  if (!axis || axis.evidenceClass !== 'game_calibration' || axis.disposition !== 'runtime') fail(`${label}: response axis must be runtime game calibration`)
  const segments = axis.value
  const bands = new Set(segments.map(({ band }) => band))
  for (const band of ['ideal', 'neutral', 'poor', 'critical']) if (!bands.has(band)) fail(`${label}: missing ${band} band`)
  if (segments[0].minimum !== null || segments.at(-1).maximum !== null) fail(`${label}: response domain must be open ended`)
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment.minimum !== null && segment.maximum !== null && segment.minimum >= segment.maximum) fail(`${label}: unordered segment ${index}`)
    if (index > 0) {
      const previous = segments[index - 1]
      if (previous.maximum !== segment.minimum || previous.maximumInclusive === segment.minimumInclusive) fail(`${label}: gap or overlap at segment ${index}`)
    }
  }
}

function compilePackage(packageDir) {
  const manifest = readJson(resolve(packageDir, 'specimen.package.json'))
  if (manifest.schemaVersion !== 'pocket-aquarium.specimen-package/v1' || manifest.speciesId !== 'ocellaris') fail('unsupported specimen package')
  const files = Object.fromEntries(['biology', 'calibration', 'morphology', 'sources'].map((key) => [key, resolve(packageDir, manifest.files[key])]))
  for (const path of Object.values(files)) if (!existsSync(path)) fail(`missing package file ${path}`)
  const biology = readJson(files.biology)
  const calibration = readJson(files.calibration)
  const morphology = readJson(files.morphology)
  const sources = readJson(files.sources)
  const sourceIds = new Set(sources.sources.map(({ id }) => id))
  validateEvidence(biology, sourceIds, 'biology')
  validateEvidence(calibration, sourceIds, 'calibration', 'game_calibration')
  if (biology.speciesId !== manifest.speciesId || calibration.speciesId !== manifest.speciesId || morphology.speciesId !== manifest.speciesId) fail('speciesId mismatch')
  if (biology.identity.waterType.value !== 'marine' || biology.housing.enforcedMinimumDisplayVolumeL.value !== 75.71) fail('Ocellaris marine or volume policy mismatch')
  if (!biology.acuteExperimentalLimits.every(({ disposition }) => disposition === 'research_only')) fail('acute endpoints must be research_only')
  if (!Object.values(biology.unsupportedRates).every(({ status, value }) => status === 'unset_required' && value === null)) fail('unsupported rates must remain null')
  if (morphology.units !== 'meters' || morphology.sampling.ringSampleCount !== 48 || morphology.sampling.ringPositions.length !== 48 || morphology.sampling.crossSectionExponent !== 1.72 || morphology.sampling.capMode !== 'center_fan') fail('morphology sampling mismatch')
  if (morphology.controlStations.some((station, index) => index && station.x <= morphology.controlStations[index - 1].x) || morphology.sampling.ringPositions.some((x, index) => index && x <= morphology.sampling.ringPositions[index - 1])) fail('morphology positions must be strictly ordered')
  for (const [name, axis] of Object.entries(calibration.responseAxes)) validateAxis(axis, name)
  const acceptedAsset = resolve(packageDir, manifest.files.acceptedAsset)
  const acceptance = readJson(resolve(packageDir, manifest.files.acceptance))
  const acceptedHash = sha256(acceptedAsset)
  if (acceptedHash !== manifest.promotion.acceptedHash || acceptedHash !== REQUIRED_HASH || acceptance.runtimeGlbSha256.lod1 !== acceptedHash || acceptance.assetVersion !== manifest.revisions.asset) fail('accepted Ocellaris asset identity mismatch')
  const runtimeRefs = new Set()
  visit(biology, (entry) => { if (entry.disposition === 'runtime') entry.sourceRefs.forEach((id) => runtimeRefs.add(id)) })
  visit(calibration, (entry) => { if (entry.disposition === 'runtime') entry.sourceRefs.forEach((id) => runtimeRefs.add(id)) })
  const legacy = calibration.legacyRuntime.value
  const social = biology.social.configuration.value
  const recruitment = biology.reproduction.larvalRecruitment.value
  return {
    ...legacy, id: manifest.speciesId, speciesId: manifest.speciesId, kind: 'fish', name: manifest.commonName, sci: manifest.scientificName,
    waterType: 'salt', realm: manifest.waterType, habitat: 'reef', nativeHabitat: biology.identity.habitatTags.value.join(', '),
    adultSizeCm: biology.identity.adultSizeCm.value, minVolumeL: biology.housing.enforcedMinimumDisplayVolumeL.value,
    socialMin: social.minimum, socialMax: social.maximum, profileRevision: manifest.revisions, acceptedAssetHash: acceptedHash,
    asset: { path: relative(REPO_ROOT, acceptedAsset), version: manifest.revisions.asset, referenceAdultLengthMeters: morphology.adultLengthMeters, clips: ['idle', 'swim', 'burst'] },
    routineHusbandry: biology.routineHusbandry, responseAxes: Object.fromEntries(Object.entries(calibration.responseAxes).map(([name, axis]) => [name, axis.value])),
    conditionModel: { multiplierByBand: calibration.conditionMultiplierByBand.value, stressAccrualPerDayByBand: calibration.stressAccrualPerDayByBand.value, criticalHazardAfterHours: calibration.criticalHazardAfterHours.value, recoveryPerDay: calibration.recoveryPerDay.value },
    compatibilityEdges: biology.compatibilityEdges,
    breeding: { type: 'pair-substrate', needsAdults: 2, socialMin: 2, water: { stable: true }, cover: true, hostFeature: 'host', pairBondDays: calibration.breeding.value.pairBondDays, incubationDays: calibration.breeding.value.incubationDays, tendedBy: 'male', frySurvivalFeature: calibration.breeding.value.recruitmentFeature, recruitmentAvailable: recruitment.availableInOrdinaryDisplay, ordinaryPodsSufficient: recruitment.ordinaryPodsSufficient },
    sourceRefs: [...runtimeRefs].sort(), schemaVersion: 'pocket-aquarium.runtime-specimen/v1',
  }
}

function buildCatalog() {
  const catalog = {}
  for (const name of readdirSync(SPECIMEN_ROOT).sort()) {
    const packageDir = resolve(SPECIMEN_ROOT, name)
    if (existsSync(resolve(packageDir, 'specimen.package.json'))) catalog[name] = compilePackage(packageDir)
  }
  return stable(catalog)
}

function render(catalog) {
  const json = JSON.stringify(catalog)
  return `/* Generated by compile_profiles.mjs. Do not edit. */\n(function (global) {\n  'use strict'\n  function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value) }\n  var PA = global.PA = global.PA || {}\n  PA.SPECIMEN_PROFILES = deepFreeze(${json})\n})(typeof window !== 'undefined' ? window : globalThis)\n`
}

const first = render(buildCatalog())
const second = render(buildCatalog())
if (first !== second) fail('compiler output is not deterministic')
if (process.argv.includes('--check')) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== first) fail('generated specimen profile is stale')
} else writeFileSync(OUTPUT, first)
console.log(JSON.stringify({ status: 'passed', deterministic: true, output: relative(REPO_ROOT, OUTPUT), profiles: Object.keys(buildCatalog()), acceptedHash: REQUIRED_HASH }))
