const D = require('better-sqlite3');
const b = require('bcryptjs');
const db = new D('data/data_logger.db');
const u = db.prepare("SELECT password_hash h FROM users WHERE username='admin'").get();
console.log('admin==newpass:', u ? b.compareSync('newpass', u.h) : 'no-admin');
const i = db.prepare('DELETE FROM users').run();
console.log('cleared users:', i.changes, '(server restart will reseed admin/admin)');
