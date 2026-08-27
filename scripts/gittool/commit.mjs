// Local git commit using isomorphic-git (pure JS) — no native git needed.
// Initializes the repo at the project root, stages every non-ignored file,
// and creates a commit. Run: node scripts/gittool/commit.mjs "message"
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import git from 'isomorphic-git';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '..', '..'); // project root
const message = process.argv[2] || 'Data Logger server + dashboard';

const AUTHOR = { name: 'Pratham Katariya', email: 'prathamkatariya77@gmail.com' };
const ALWAYS_SKIP = new Set(['.git', 'node_modules']);

async function walk(rel = '') {
  const abs = path.join(dir, rel);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (ALWAYS_SKIP.has(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      files.push(...(await walk(childRel)));
    } else if (e.isFile()) {
      files.push(childRel);
    }
  }
  return files;
}

async function main() {
  await git.init({ fs, dir, defaultBranch: 'main' });
  await git.setConfig({ fs, dir, path: 'user.name', value: AUTHOR.name });
  await git.setConfig({ fs, dir, path: 'user.email', value: AUTHOR.email });

  const all = await walk();
  let added = 0;
  for (const filepath of all) {
    const ignored = await git.isIgnored({ fs, dir, filepath });
    if (ignored) continue;
    await git.add({ fs, dir, filepath });
    added++;
  }

  const oid = await git.commit({ fs, dir, message, author: AUTHOR });
  console.log(`Committed ${added} files.`);
  console.log(`commit: ${oid}`);
  const branch = await git.currentBranch({ fs, dir, fullname: false });
  console.log(`branch: ${branch}`);
}

main().catch((e) => { console.error('commit failed:', e); process.exit(1); });
