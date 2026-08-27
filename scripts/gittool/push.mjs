// Creates the GitHub repo (if needed) and pushes `main` using isomorphic-git.
// The token is read from the GITHUB_TOKEN env var, injected securely from the
// secret store — it never appears in the command or chat.
//   Repo name via REPO_NAME env (default "data-logger"); PRIVATE=false for public.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '..', '..');

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO_NAME || 'data-logger';
const isPrivate = process.env.PRIVATE !== 'false';
if (!token) { console.error('GITHUB_TOKEN not set'); process.exit(1); }

const gh = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'coco-gittool',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

async function main() {
  // 1. Who owns this token?
  const meRes = await gh('https://api.github.com/user');
  if (!meRes.ok) throw new Error(`token check failed: ${meRes.status} ${await meRes.text()}`);
  const login = (await meRes.json()).login;
  console.log(`authenticated as: ${login}`);

  // 2. Create the repo if it doesn't already exist.
  const exists = await gh(`https://api.github.com/repos/${login}/${repoName}`);
  if (exists.status === 404) {
    const create = await gh('https://api.github.com/user/repos', {
      method: 'POST',
      body: JSON.stringify({ name: repoName, private: isPrivate, description: 'Data Logger dashboard + calibration server' }),
    });
    if (!create.ok) throw new Error(`repo create failed: ${create.status} ${await create.text()}`);
    console.log(`created repo: ${login}/${repoName} (${isPrivate ? 'private' : 'public'})`);
  } else if (exists.ok) {
    console.log(`repo already exists: ${login}/${repoName} (will push into it)`);
  } else {
    throw new Error(`repo check failed: ${exists.status} ${await exists.text()}`);
  }

  const url = `https://github.com/${login}/${repoName}.git`;
  // 3. Record the remote (idempotent).
  try { await git.deleteRemote({ fs, dir, remote: 'origin' }); } catch (_) {}
  await git.addRemote({ fs, dir, remote: 'origin', url });

  // 4. Push main.
  const result = await git.push({
    fs, http, dir, remote: 'origin', ref: 'main', url, force: false,
    onAuth: () => ({ username: token, password: 'x-oauth-basic' }),
  });
  if (result.errors && result.errors.length) throw new Error('push errors: ' + result.errors.join('; '));
  console.log(`pushed to ${url}`);
  console.log(`\nRepo URL: https://github.com/${login}/${repoName}`);
}

main().catch((e) => { console.error('push failed:', e.message || e); process.exit(1); });
