import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import git from 'isomorphic-git';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '..', '..');
const files = await git.listFiles({ fs, dir, ref: 'HEAD' });
const bad = files.filter((f) => /node_modules|\.db$|frontend\/dist/.test(f));
console.log('total committed:', files.length);
console.log('leaked (node_modules/db/dist):', bad.length, bad.slice(0, 5).join(', '));
console.log('--- top-level files ---');
console.log(files.filter((f) => f.split('/').length <= 2).join('\n'));
