#!/usr/bin/env node
// filepath /home/jod/buoy/scripts/generate-share-summary.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'manual';
const contextPathArg = process.argv.find((arg) => arg.startsWith('--context='));
const envContextPath = process.env.BUOY_SHARE_SUMMARY_CONTEXT;
const candidateContextPath = contextPathArg ? contextPathArg.split('=')[1] : envContextPath;
const contextPath = candidateContextPath || (fs.existsSync(path.join(root, 'CONTEXT.md')) ? path.join(root, 'CONTEXT.md') : null);
const projectPath = path.join(root, 'PROJECT_DIRECTION_QUIETLY_DISTRIBUTABLE.md');
const outPath = path.join(root, 'docs', 'generated', 'THINHALO_VPS_SHARE_SUMMARY.md');

function readRequired(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath ? path.basename(filePath) : 'unspecified'}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function readOptional(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function findMatch(text, regex, label) {
  const m = text.match(regex);
  if (!m) throw new Error(`Could not extract ${label}`);
  return m[1].trim();
}

function sanitise(value) {
  return value
    .replace(/https?:\/\/[^\s]*\?(?:ttoken|token|auth|pat)=[^\s)]+/gi, '[redacted-token-url]')
    .replace(/\b(mariekebuoyproxysecret|lachiebuoyproxysecret|githubsubscribepat|perplexityapikey|buoysyncsecret|anchorsyncsecret)\b/gi, '[redacted-secret-ref]')
    .replace(/vault ID [A-Za-z0-9]+/gi, 'vault ID [redacted]');
}

function assertSafe(output) {
  const blocked = [
    /mariekebuoyproxysecret/i,
    /lachiebuoyproxysecret/i,
    /githubsubscribepat/i,
    /perplexityapikey/i,
    /vault ID [A-Za-z0-9]{8,}/i,
    /\?ttoken=/i,
    /X-Buoy-Sync-Secret:\s*\S+/i,
  ];
  for (const regex of blocked) {
    if (regex.test(output)) throw new Error(`Blocked content detected in output: ${regex}`);
  }
}

function melbourneTimestamp() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} Australia/Melbourne`;
}

function parseContext(context) {
  if (!context) {
    return {
      canonicalUrl: 'Not captured in current canonical docs.',
      compatUrl: 'Not captured in current canonical docs.',
      repo: 'github.com/ideasth/buoy-app',
      vpsHost: 'Not captured in current canonical docs.',
      publicHostname: 'Not captured in current canonical docs.',
      repoPath: 'Not captured in current canonical docs.',
      reverseProxy: 'Not captured in current canonical docs.',
      pm2: 'Not captured in current canonical docs.',
      deployCommand: 'Not captured in current canonical docs.',
    };
  }

  return {
    canonicalUrl: findMatch(context, /Canonical live URL\s+(https:\/\/[^\s]+)/i, 'canonical live URL'),
    compatUrl: findMatch(context, /Back-compat live URL\s+(https:\/\/[^\s]+)/i, 'back-compat live URL'),
    repo: findMatch(context, /Source repo PUBLIC\s+([^\s]+)\s+branch/i, 'public repo'),
    vpsHost: findMatch(context, /VPS host\s+([^,]+),\s*Ubuntu/i, 'VPS host'),
    publicHostname: findMatch(context, /public hostname\s+([^.\s]+\.[^,\s]+)/i, 'public hostname'),
    repoPath: findMatch(context, /VPS repo path\s+([^\s]+)/i, 'VPS repo path'),
    reverseProxy: findMatch(context, /Reverse proxy\s+([^\s]+)\s+Buoy listening/i, 'reverse proxy'),
    pm2: findMatch(context, /Process manager pm2 process name\s+([^.\s]+)/i, 'pm2 process name'),
    deployCommand: findMatch(context, /The canonical deploy path is the in-repo script, run as the jod user on main\s+([^\s]+)/i, 'deploy command'),
  };
}

function compact(line) {
  return line.replace(/\s+/g, ' ').trim();
}

function parseProject(project) {
  const shipped = [];
  const queued = [];
  const lines = project.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^14\s+Anchor Buoy rename\b/i.test(line) && /\byes\b/i.test(line)) shipped.push(compact(line));
    if (/^17\s+Three-hostname split\b/i.test(line) && /\byes\b/i.test(line)) shipped.push(compact(line));
    if (/^20\s+Activity Log\b/i.test(line)) queued.push(compact(line));
  }

  if (!queued.length) {
    const m = project.match(/20\s+Activity Log[\s\S]*?STAGE20ACTIVITYLOGSPEC\.md[^\n]*/i);
    if (m) queued.push(compact(m[0]));
  }

  return { shipped, queued };
}

function render(contextData, projectData) {
  const lines = [
    '# Thinhalo VPS share summary',
    '',
    '## Purpose',
    '',
    'This file is a generated, operator-safe summary of the current Buoy app state for sharing into thinhalo VPS context. It is derived from canonical Buoy records and is not the source of truth.',
    '',
    '## App identity',
    '',
    `- Canonical app URL: ${contextData.canonicalUrl}`,
    `- Back-compat URL: ${contextData.compatUrl}`,
    `- Public repo: ${contextData.repo}`,
    `- VPS host: ${contextData.vpsHost} (${contextData.publicHostname})`,
    `- Reverse proxy: ${contextData.reverseProxy}`,
    `- pm2 process: ${contextData.pm2}`,
    '',
    '## Runtime topology',
    '',
    `- Single VPS deployment model with one Node process behind ${contextData.reverseProxy}.`,
    '- Application listens on loopback port 5000 behind the reverse proxy.',
    `- Canonical VPS repo path: ${contextData.repoPath}`,
    '- Legacy Anchor naming remains in selected paths and hostnames for compatibility where documented.',
    '',
    '## Public surfaces',
    '',
    '- buoy.thinhalo.com — Apex Buoy app.',
    '- anchor.thinhalo.com — Back-compat apex hostname served from the same backend.',
    '- buoy-family.thinhalo.com — Family calendar surface.',
    '- oliver-availability.thinhalo.com — Sanitised availability surface.',
    '',
    '## Deploy workflow',
    '',
    `- Canonical deploy command: ${contextData.deployCommand}`,
    '- High-level steps: pull main, regenerate baked secret from VPS secret store, install dependencies, build, reload pm2, probe health, and write a deploy log.',
    '- Deploy logs are written under /var/log/buoy as deploy-UTC-timestamp.log files.',
    '',
    '## Backups and health',
    '',
    '- OneDrive is the canonical backup store.',
    '- Backup receipt freshness is verified and surfaced through the existing admin-health model.',
    '- The admin health view summarises cron heartbeats, VPS timers, backup receipts, and masked ICS feed status.',
    '- There is no persistent local backup directory treated as canonical storage.',
    '',
    '## Scheduled tasks',
    '',
    '- Perplexity crons currently cover Outlook capture, ICS-only calendar sync, email status pull, and a one-shot AEDT cutover reminder.',
    '- VPS systemd timers currently cover backup snapshotting, backup pruning, calendar warming, morning warming, weekly-review warming, and backup-receipt verification.',
    '- This summary feature does not create or retune any scheduled task.',
    '',
    '## Pipeline snapshot',
    '',
    ...projectData.shipped.map((s) => `- Shipped: ${s}`),
    ...projectData.queued.map((q) => `- Queued: ${q}`),
    '',
    '## Source files',
    '',
    '- CONTEXT.md',
    '- PROJECT_DIRECTION_QUIETLY_DISTRIBUTABLE.md',
    '',
    '## Generated',
    '',
    `- Timestamp: ${melbourneTimestamp()}`,
    `- Generator: scripts/generate-share-summary.mjs`,
    `- Mode: ${mode}`,
    '',
  ];
  return sanitise(lines.join('\n'));
}

function main() {
  const context = readOptional(contextPath);
  const project = readRequired(projectPath);
  const contextData = parseContext(context);
  const projectData = parseProject(project);
  const output = render(contextData, projectData);
  assertSafe(output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`Generated ${path.relative(root, outPath)} in ${mode} mode.`);
  console.log('Next step: review the generated markdown, run tests, then patch or verify the deploy hook behaviour on the VPS.');
}

try {
  main();
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (mode === 'post-deploy') {
    console.warn(`[share-summary] warning: ${msg}`);
    console.log('Next step: review the generator warning in the deploy log and fix the extraction rule without blocking deploys.');
    process.exit(0);
  }
  console.error(`[share-summary] error: ${msg}`);
  console.log('Next step: fix the generator input or extraction rule, then rerun the share-summary build locally.');
  process.exit(1);
}

