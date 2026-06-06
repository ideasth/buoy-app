import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('generate-share-summary', () => {
  const repo = process.cwd();
  const script = path.join(repo, 'scripts', 'generate-share-summary.mjs');
  const output = path.join(repo, 'docs', 'generated', 'THINHALO_VPS_SHARE_SUMMARY.md');

  test('writes summary with required sections in repo-safe mode', () => {
    execFileSync('node', [script, '--mode=manual'], { cwd: repo, encoding: 'utf8' });
    const text = fs.readFileSync(output, 'utf8');
    expect(text).toContain('# Thinhalo VPS share summary');
    expect(text).toContain('## App identity');
    expect(text).toContain('## Deploy workflow');
    expect(text).toContain('## Pipeline snapshot');
    expect(text).toContain('github.com/ideasth/buoy-app');
  });

  test('sanitises blocked content markers', () => {
    execFileSync('node', [script, '--mode=manual'], { cwd: repo, encoding: 'utf8' });
    const text = fs.readFileSync(output, 'utf8');
    expect(text).not.toMatch(/\?ttoken=/i);
    expect(text).not.toMatch(/mariekebuoyproxysecret/i);
    expect(text).not.toMatch(/githubsubscribepat/i);
  });

  test('post-deploy mode stays non-fatal on missing project input in temp copy', () => {
    const temp = fs.mkdtempSync(path.join(repo, '.tmp-share-summary-'));
    fs.cpSync(path.join(repo, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
    const result = execFileSync('node', [path.join(temp, 'scripts', 'generate-share-summary.mjs'), '--mode=post-deploy'], {
      cwd: temp,
      encoding: 'utf8',
    });
    expect(result).toMatch(/Next step:/);
  });
});
