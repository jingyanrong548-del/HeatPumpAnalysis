/**
 * Dual-effect heat pump cost allocation core (no DOM, no alert).
 * Methods: alternative production, exergy, energy.
 */

function isFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n);
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return obj[k];
    }
  }
  return undefined;
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeDualInputs(raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    p_total: pick(p, 'p_total', 'totalPowerKw', 'totalPower'),
    qc: pick(p, 'qc', 'coolingLoadKw', 'coolingLoad'),
    qh: pick(p, 'qh', 'heatLoadKw', 'heatingLoadKw', 'heatLoad'),
    t_env_c: pick(p, 't_env_c', 't_env', 'ambientTemperatureC', 'envTemperatureC'),
    t_c_c: pick(p, 't_c_c', 't_c', 'coolingTemperatureC', 'sourceCoolingTempC'),
    t_h_c: pick(p, 't_h_c', 't_h', 'heatingTemperatureC', 'sinkHeatingTempC'),
    cop_c_alt: pick(p, 'cop_c_alt', 'copCoolingAlt', 'coolingCopAlt'),
    cop_h_alt: pick(p, 'cop_h_alt', 'copHeatingAlt', 'heatingCopAlt'),
    price: pick(p, 'price', 'electricityPrice'),
  };
}

/**
 * Pure allocation calculator — returns structured result or error object (never throws for bad temps).
 * @param {object} n — normalized numeric inputs
 */
export function calculateAllMethods(n) {
  const assumptions = [
    'Alternative method: allocate P_total by standalone cooling/heating power shares.',
    'Energy method: allocate by Qc : Qh heat load ratio.',
    'Exergy method: allocate by exergy destruction shares (requires valid temperatures).',
  ];
  const warnings = [];

  const pTotal = Number(n.p_total);
  const qc = Number(n.qc);
  const qh = Number(n.qh);
  const copCAlt = Number(n.cop_c_alt);
  const copHAlt = Number(n.cop_h_alt);
  const price = Number(n.price);

  const missingInputs = [];
  if (!isFiniteNumber(n.p_total) || pTotal <= 0) missingInputs.push('p_total');
  if (!isFiniteNumber(n.qc)) missingInputs.push('qc');
  if (!isFiniteNumber(n.qh)) missingInputs.push('qh');
  if (!isFiniteNumber(n.cop_c_alt) || copCAlt <= 0) missingInputs.push('cop_c_alt');
  if (!isFiniteNumber(n.cop_h_alt) || copHAlt <= 0) missingInputs.push('cop_h_alt');
  if (!isFiniteNumber(n.price) || price <= 0) missingInputs.push('price');

  if (missingInputs.length) {
    return { ok: false, results: null, missingInputs, warnings, assumptions };
  }

  const enPc = qc + qh > 0 ? pTotal * (qc / (qc + qh)) : 0;
  const enPh = qc + qh > 0 ? pTotal * (qh / (qc + qh)) : 0;

  const pCAlt = qc / copCAlt;
  const pHAlt = qh / copHAlt;
  const totalPAlt = pCAlt + pHAlt;
  const altPc = totalPAlt > 0 ? pTotal * (pCAlt / totalPAlt) : 0;
  const altPh = totalPAlt > 0 ? pTotal * (pHAlt / totalPAlt) : 0;

  const costAlt = totalPAlt * price;
  const costHeatpump = pTotal * price;
  const savingPerHour = costAlt - costHeatpump;

  const result = {
    p_total: pTotal,
    qc,
    qh,
    cop_c_alt: copCAlt,
    cop_h_alt: copHAlt,
    price,
    en_pc: enPc,
    en_ph: enPh,
    p_c_alt: pCAlt,
    p_h_alt: pHAlt,
    total_p_alt: totalPAlt,
    alt_pc: altPc,
    alt_ph: altPh,
    cost_alt: costAlt,
    cost_heatpump: costHeatpump,
    saving_per_hour: savingPerHour,
    exergySkipped: false,
  };

  const hasTemps =
    isFiniteNumber(n.t_env_c) && isFiniteNumber(n.t_c_c) && isFiniteNumber(n.t_h_c);

  if (!hasTemps) {
    warnings.push('skip_exergy: ambient/cooling/heating temperatures not provided; exergy method omitted.');
    result.exergySkipped = true;
    return { ok: true, results: result, missingInputs: [], warnings, assumptions };
  }

  const tEnvK = Number(n.t_env_c) + 273.15;
  const tCK = Number(n.t_c_c) + 273.15;
  const tHK = Number(n.t_h_c) + 273.15;

  if (tCK <= 0 || tHK <= tEnvK) {
    warnings.push(
      'skip_exergy: invalid temperature set for exergy (T_c > 0 K, T_h > T_env required); exergy method omitted.',
    );
    result.exergySkipped = true;
    result.t_env_c = Number(n.t_env_c);
    result.t_c_c = Number(n.t_c_c);
    result.t_h_c = Number(n.t_h_c);
    return { ok: true, results: result, missingInputs: [], warnings, assumptions };
  }

  const exC = qc * Math.abs(tEnvK / tCK - 1);
  const exH = qh * (1 - tEnvK / tHK);
  const totalEx = exC + exH;
  const exPc = totalEx > 0 ? pTotal * (exC / totalEx) : 0;
  const exPh = totalEx > 0 ? pTotal * (exH / totalEx) : 0;

  result.t_env_c = Number(n.t_env_c);
  result.t_c_c = Number(n.t_c_c);
  result.t_h_c = Number(n.t_h_c);
  result.t_env_k = tEnvK;
  result.t_c_k = tCK;
  result.t_h_k = tHK;
  result.ex_c = exC;
  result.ex_h = exH;
  result.ex_pc = exPc;
  result.ex_ph = exPh;

  return { ok: true, results: result, missingInputs: [], warnings, assumptions };
}

/**
 * @param {Record<string, unknown>} raw
 */
export function calculateDualAllocation(raw) {
  const normalized = normalizeDualInputs(raw);
  return calculateAllMethods(normalized);
}
