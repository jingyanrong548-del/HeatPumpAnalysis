/**
 * Open Thermal AI remote engine endpoint for Dual-Effect HP Economic Tool.
 * POST /calculate → { ok, version, results, missingInputs, warnings, assumptions }
 *
 * Run: npm run calculate-api
 * Env: PORT (default 9109), HOST (default 127.0.0.1), ENGINE_API_KEY (optional)
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calculateDualAllocation } from '../src/calculationCore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    return `dual-hp-economic-${pkg.version || '1.0.0'}`;
  } catch {
    return 'dual-hp-economic-1.0.0';
  }
})();

const PORT = Number(process.env.PORT || 9109);
const HOST = String(process.env.HOST || '127.0.0.1');
const API_KEY = String(process.env.ENGINE_API_KEY || '').trim();

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  });
  res.end(payload);
}

/**
 * @param {Record<string, unknown>} body
 */
export function handleCalculateBody(body) {
  const locale = body?.locale === 'zh' ? 'zh' : 'en';
  const rawInputs =
    body?.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
      ? body.inputs
      : body && typeof body === 'object'
        ? body
        : {};

  const out = calculateDualAllocation(rawInputs);

  if (!out.ok) {
    return {
      ok: false,
      version: VERSION,
      results: null,
      missingInputs: out.missingInputs,
      warnings: out.warnings,
      assumptions: [
        ...out.assumptions,
        'Missing required inputs return missingInputs without inventing numbers.',
      ],
      message: `Missing required fields: ${out.missingInputs.join(', ')}`,
    };
  }

  return {
    ok: true,
    version: VERSION,
    results: { ...out.results, locale, engine: 'dual_hp_economic' },
    missingInputs: [],
    warnings: out.warnings,
    assumptions: [
      ...out.assumptions,
      'Dual-effect heat pump economic allocation via POST /calculate.',
      'OTA aliases: heatLoadKw→qh, coolingLoadKw→qc, totalPowerKw→p_total, electricityPrice→price.',
    ],
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  if (req.method === 'GET' && (path === '/health' || path === '/calculate/health')) {
    send(res, 200, { status: 'ok', service: 'dual-calculate-api', version: VERSION });
    return;
  }

  if (req.method === 'POST' && path === '/calculate') {
    if (API_KEY) {
      const key = String(req.headers['x-api-key'] || '').trim();
      if (key !== API_KEY) {
        send(res, 401, { ok: false, error: 'unauthorized', message: 'Invalid X-API-Key.' });
        return;
      }
    }
    try {
      const body = await readJson(req);
      send(res, 200, handleCalculateBody(body));
    } catch (err) {
      send(res, 400, {
        ok: false,
        version: VERSION,
        results: null,
        missingInputs: [],
        warnings: [],
        assumptions: [],
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  send(res, 404, { ok: false, error: 'not_found', path });
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`[dual-calculate-api] http://${HOST}:${PORT}/calculate  (${VERSION})`);
  });
}

export { server, VERSION };
