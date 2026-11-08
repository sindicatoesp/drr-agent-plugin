const assert = require("assert");
const { erf, normalCdf, lognormalCdf } = require("../lib/utils");
const { evaluateSeismicFragility, evaluateFloodDamage, evaluateWindDamage } = require("../lib/fragility");

console.log("Testing Fragility Functions & Mathematical CDFs...");

// 1. Math checks
assert.strictEqual(erf(0), 0, "erf(0) must be 0");
assert(Math.abs(normalCdf(0) - 0.5) < 0.0001, "normalCdf(0) must be 0.5");
assert(Math.abs(normalCdf(1.96) - 0.975) < 0.001, "normalCdf(1.96) must be ~0.975");

// Lognormal CDF median check: at x = median, CDF must be 0.5
assert(Math.abs(lognormalCdf(0.3, 0.3, 0.6) - 0.5) < 0.0001, "Lognormal CDF at median must be 0.5");

// 2. Seismic Fragility
const urmAtLowPga = evaluateSeismicFragility("URM", 0.05);
assert(urmAtLowPga.meanDamageRatio < 0.1, "Damage ratio for low PGA should be small");

const urmAtHighPga = evaluateSeismicFragility("URM", 0.8);
assert(urmAtHighPga.meanDamageRatio > 0.6, "Damage ratio for high PGA should be large");
assert(urmAtHighPga.exceedanceProbabilities.complete > 0.5, "P(DS >= complete) should exceed 50%");

// Discrete probabilities sum to 1.0 (approx due to rounding)
const sumProbs = Object.values(urmAtHighPga.discreteProbabilities).reduce((a, b) => a + b, 0);
assert(Math.abs(sumProbs - 1.0) < 0.01, `Probabilities must sum to ~1.0, got ${sumProbs}`);

// 3. Flood Damage
const flood0m = evaluateFloodDamage(0);
assert.strictEqual(flood0m.structuralDamageRatio, 0);

const flood2m = evaluateFloodDamage(2.0);
assert(flood2m.structuralDamageRatio > 0.3 && flood2m.contentDamageRatio > 0.5);

// 4. Wind Damage
const cat5 = evaluateWindDamage(260);
assert.strictEqual(cat5.saffirSimpsonCategory, 5);
assert(cat5.meanDamageRatio >= 0.9);

console.log("✅ Fragility tests passed!");
