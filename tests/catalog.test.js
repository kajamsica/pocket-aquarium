/* Accepted marine store parity. Run with `node tests/catalog.test.js`. */
"use strict";

var assert = require("node:assert/strict");
var path = require("node:path");
global.window = global;
require("../js/data.js");

var D = global.PA.DATA;
var accepted = require("../realistic_light_transport/src/assets/specimens/runtime-acceptance.v1.json").assets;
var acceptedAnimals = accepted.filter(function (entry) { return entry.category !== "coral"; });
var acceptedCorals = accepted.filter(function (entry) { return entry.category === "coral"; });
var marineIds = Object.keys(D.SPECIES).filter(function (id) { return D.SPECIES[id].habitat === "reef"; }).sort();
var acceptedAnimalIds = acceptedAnimals.map(function (entry) { return entry.speciesId; }).sort();

assert.equal(acceptedAnimals.length, 25);
assert.deepEqual(marineIds, acceptedAnimalIds);
assert.ok(D.SPECIES.neon_tetra && D.SPECIES.pygmy_cory, "freshwater catalog remains present");
assert.equal(D.ACTIONS.LOCK_CORAL_PLACEMENT, "LOCK_CORAL_PLACEMENT");

acceptedAnimals.forEach(function (entry) {
  var source = require(path.join("..", "realistic_light_transport", "art", "specimens", entry.speciesId, "asset.source.json"));
  var profile = D.SPECIES[entry.speciesId];
  assert.equal(profile.name, source.displayName, entry.speciesId + " display name");
  assert.equal(profile.sci, source.scientificLabel, entry.speciesId + " scientific label");
  assert.equal(profile.adultSizeCm, source.referenceSize.meters * 100, entry.speciesId + " accepted size");
  ["price", "bioload", "minVolumeL", "minFootprintCm2", "socialMin", "socialMax",
    "layer", "territoriality", "predator", "coralSafe", "invertSafe", "diet", "metabolic"
  ].forEach(function (field) { assert.ok(Object.prototype.hasOwnProperty.call(profile, field), entry.speciesId + " " + field); });
  assert.ok(Array.isArray(profile.cleanupRoles), entry.speciesId + " cleanup roles");
});

var coralIds = Object.keys(D.CORALS).sort();
var acceptedCoralIds = Array.from(new Set(acceptedCorals.map(function (entry) { return entry.speciesId; }))).sort();
assert.equal(coralIds.length, 8);
assert.deepEqual(coralIds, acceptedCoralIds);

var actualVariants = [];
coralIds.forEach(function (id) {
  var coral = D.CORALS[id];
  var source = require(path.join("..", "realistic_light_transport", "art", "specimens", id, "asset.source.json"));
  assert.equal(coral.name, source.displayName, id + " display name");
  assert.equal(coral.sci, source.scientificLabel, id + " scientific label");
  assert.equal(coral.referenceSizeCm, source.referenceSize.meters * 100, id + " accepted size");
  coral.variants.forEach(function (variant) { actualVariants.push([id, variant.id, variant.displayName]); });
  var acceptedDefault = acceptedCorals.find(function (entry) { return entry.speciesId === id && entry.defaultForSpecies; });
  assert.equal(coral.defaultVariantId, acceptedDefault.variantId, id + " default variant");
  assert.ok(coral.par.min < coral.par.max && coral.flow.min < coral.flow.max, id + " husbandry ranges");
});
var acceptedVariants = acceptedCorals.map(function (entry) { return [entry.speciesId, entry.variantId, entry.displayName]; });
assert.equal(actualVariants.length, 22);
assert.deepEqual(actualVariants.sort(), acceptedVariants.sort());

var acceptedVariant = global.PA.validatePurchase({}, { kind: "coral", id: "zoanthid", variantId: "blue_green" });
var rejectedVariant = global.PA.validatePurchase({}, { kind: "coral", id: "zoanthid", variantId: "candidate_only" });
assert.ok(acceptedVariant.reasons.indexOf("Unknown coral variant.") < 0);
assert.ok(rejectedVariant.reasons.indexOf("Unknown coral variant.") >= 0);

console.log("Accepted marine catalog parity: 25 animals, 8 corals, 22 coral variants.");
