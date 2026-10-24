/**
 * Provisions ONLY LaFix staging Cloudflare D1 and Worker.
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in runner environment.
 * Never targets lafix-ro production and never enables billing.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const DB_NAME = 'lafix-marketplace-staging';
const WORKER_NAME = 'lafix-marketplace-staging';
const CONFIG_PATH = 'wrangler.staging.generated.json';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) {
  console.error('Cloudflare neautorizat. Configurează în GitHub Actions secrets CLOUDFLARE_API_TOKEN și CLOUDFLARE_ACCOUNT_ID. Nu lipi tokenul în chat.');
  process.exit(2);
}
function wrangler(args, capture = false) {
  const r = spawnSync('wrangler', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: process.env });
  if (!capture && r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Wrangler command failed: ' + args.slice(0, 3).join(' ') + ' (exit ' + r.status + ')');
  return capture === 'all' ? (r.stdout || '') + '\n' + (r.stderr || '') : (r.stdout || '');
}
function databaseId() {
  const raw = JSON.parse(wrangler(['d1', 'list', '--json'], true));
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw.result) ? raw.result : (raw.result?.databases || []));
  const matches = list.filter(db => db.name === DB_NAME);
  if (matches.length > 1) throw new Error('Multiple databases with staging name. Stop to avoid wrong database.');
  return matches[0]?.uuid || matches[0]?.id || '';
}
let id = databaseId();
if (!id) {
  console.log('Creating staging D1 (EU jurisdiction): ' + DB_NAME);
  wrangler(['d1', 'create', DB_NAME, '--jurisdiction', 'eu']);
  id = databaseId();
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  throw new Error('Could not verify staging D1 UUID; aborting.');
}
const config = {
  name: WORKER_NAME,
  main: 'apps/api/worker.mjs',
  compatibility_date: '2026-10-24',
  workers_dev: true,
  assets: {
    directory: './apps/site',
    binding: 'ASSETS',
    run_worker_first: ['/api/*']
  },
  d1_databases: [{ binding: 'DB', database_name: DB_NAME, database_id: id, migrations_dir: 'infra/d1' }],
  vars: { APP_ENV: 'staging' }
};
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { flag: 'w', mode: 0o600 });
try {
  console.log('Applying versioned migrations to staging D1 only');
  wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote', '--config', CONFIG_PATH]);
  console.log('Deploying separate staging Worker: ' + WORKER_NAME);
  const deployOutput = wrangler(['deploy', '--config', CONFIG_PATH], 'all');
  process.stdout.write(deployOutput);
  const urls = deployOutput.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi) || [];
  const url = urls.find(x => x.includes(WORKER_NAME + '.'));
  if (!url) throw new Error('Deployment URL not found in Wrangler output; verify Worker in Cloudflare dashboard.');
  const check = async (path, validate) => {
    let last = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const response = await fetch(url + path, { redirect: 'error' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = await response.text();
        if (!validate(result)) throw new Error('Unexpected response body');
        return;
      } catch (err) {
        last = String(err);
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Staging smoke test failed at ' + path + ': ' + last);
  };
  await check('/api/health', t => JSON.parse(t).ok === true);
  await check('/api/catalog', t => (JSON.parse(t).categories || []).length > 0);
  await check('/admin.html', t => t.includes('Panou de administrare'));
  console.log('Verified staging Worker and D1 API at ' + url);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### LaFix staging deployed and smoke-tested\n\n' +
      '- Worker: ' + url + '\n- Database: ' + DB_NAME +
      '\n- Checked: /api/health, /api/catalog, /admin.html\n' +
      '- Production lafix-ro: not targeted\n' +
      '- Billing and email login: still disabled until separately configured\n');
  }
} finally {
  rmSync(CONFIG_PATH, { force: true });
}
