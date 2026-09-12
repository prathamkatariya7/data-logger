const D = require('better-sqlite3');
const b = require('bcryptjs');
const db = new D('data/data_logger.db');
const rows = db.prepare('SELECT id,username,role,created_by FROM users').all();
console.log('users:', rows);
const u = db.prepare("SELECT * FROM users WHERE username='admin'").get();
console.log('admin exists:', !!u);
if (u) console.log('compare admin/admin:', b.compareSync('admin', u.password_hash));
