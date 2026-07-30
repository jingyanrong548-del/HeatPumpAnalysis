/**
 * Smoke test for dual-effect HP /calculate (no HTTP server required).
 * Run: npm run test:calculate-api
 */
import assert from 'node:assert/strict';
import { handleCalculateBody } from './calculate-api.mjs';

const missing = handleCalculateBody({ inputs: {}, locale: 'zh' });
assert.equal(missing.ok, false);
assert.ok(missing.missingInputs.includes('p_total'));
assert.ok(missing.missingInputs.includes('price'));

const noExergy = handleCalculateBody({
  locale: 'en',
  inputs: {
    totalPowerKw: 100,
    coolingLoadKw: 200,
    heatLoadKw: 300,
    cop_c_alt: 3,
    cop_h_alt: 3.5,
    electricityPrice: 0.8,
  },
});
assert.equal(noExergy.ok, true, noExergy.message);
assert.equal(noExergy.results.exergySkipped, true);
assert.ok(noExergy.warnings.some((w) => w.includes('skip_exergy')));
assert.ok(noExergy.results.alt_pc > 0);
assert.ok(noExergy.results.en_pc > 0);

const full = handleCalculateBody({
  inputs: {
    p_total: 100,
    qc: 200,
    qh: 300,
    cop_c_alt: 3,
    cop_h_alt: 3.5,
    price: 0.8,
    t_env_c: 25,
    t_c_c: 10,
    t_h_c: 60,
  },
});
assert.equal(full.ok, true);
assert.equal(full.results.exergySkipped, false);
assert.ok(full.results.ex_pc > 0);

console.log('test:calculate-api OK', {
  version: full.version,
  savingPerHour: full.results.saving_per_hour.toFixed(2),
  skipExergyWarn: noExergy.warnings[0],
});
