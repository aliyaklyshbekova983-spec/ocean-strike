const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'ocean-strike.db'));

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('win','loss')),
  difficulty TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  sunk INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// Migration for older local databases: add email to users without deleting existing accounts.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
if(!userColumns.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL');

app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
function validPassword(password, salt, stored) {
  const {hash} = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(stored,'hex'));
}
function cleanUsername(value) {
  return String(value || '').trim();
}
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function auth(req,res,next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,'') || '';
  if(!token) return res.status(401).json({error:'Требуется вход'});
  const row = db.prepare(`SELECT s.token,s.user_id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`).get(token, Date.now());
  if(!row) return res.status(401).json({error:'Сессия истекла'});
  req.user = {id:row.user_id, username:row.username, token};
  next();
}
function publicUser(id) { return db.prepare('SELECT id,username,email,created_at FROM users WHERE id=?').get(id); }

app.post('/api/register',(req,res)=>{
  const username=cleanUsername(req.body.username);
  const password=String(req.body.password||'');
  const email=String(req.body.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Введите корректную электронную почту'});
  if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) return res.status(400).json({error:'Логин: 3–24 символа, только буквы, цифры, _ или -'});
  if(password.length<6) return res.status(400).json({error:'Пароль должен быть не короче 6 символов'});
  if(db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) return res.status(409).json({error:'Такой логин уже занят'});
  if(db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(email)) return res.status(409).json({error:'Эта электронная почта уже зарегистрирована'});
  const {hash,salt}=hashPassword(password);
  const info=db.prepare('INSERT INTO users(username,password_hash,salt,email) VALUES(?,?,?,?)').run(username,hash,salt,email);
  const token=makeToken();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,info.lastInsertRowid,Date.now()+1000*60*60*24*30);
  res.json({token,user:publicUser(info.lastInsertRowid)});
});

app.post('/api/login',(req,res)=>{
  const username=cleanUsername(req.body.username), password=String(req.body.password||'');
  const user=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
  if(!user || !validPassword(password,user.salt,user.password_hash)) return res.status(401).json({error:'Неверный логин или пароль'});
  const token=makeToken();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,user.id,Date.now()+1000*60*60*24*30);
  res.json({token,user:publicUser(user.id)});
});

app.post('/api/logout',auth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(req.user.token);res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({user:publicUser(req.user.id)}));

app.get('/api/stats',auth,(req,res)=>{
  const stats=db.prepare(`SELECT COUNT(*) games, SUM(result='win') wins, SUM(result='loss') losses, COALESCE(SUM(hits),0) hits, COALESCE(SUM(misses),0) misses, COALESCE(SUM(sunk),0) sunk FROM games WHERE user_id=?`).get(req.user.id);
  const recent=db.prepare(`SELECT result,difficulty,hits,misses,sunk,duration_seconds,played_at FROM games WHERE user_id=? ORDER BY id DESC LIMIT 12`).all(req.user.id);
  res.json({stats:{games:stats.games||0,wins:stats.wins||0,losses:stats.losses||0,hits:stats.hits||0,misses:stats.misses||0,sunk:stats.sunk||0},recent});
});

app.post('/api/games',auth,(req,res)=>{
  const b=req.body||{};
  const result=b.result==='win'?'win':b.result==='loss'?'loss':null;
  if(!result) return res.status(400).json({error:'Некорректный результат'});
  const difficulty=['easy','normal','hard'].includes(b.difficulty)?b.difficulty:'normal';
  db.prepare(`INSERT INTO games(user_id,result,difficulty,hits,misses,sunk,duration_seconds) VALUES(?,?,?,?,?,?,?)`).run(req.user.id,result,difficulty,Number(b.hits)||0,Number(b.misses)||0,Number(b.sunk)||0,Number(b.duration_seconds)||0);
  db.prepare('DELETE FROM progress WHERE user_id=?').run(req.user.id);
  res.json({ok:true});
});

app.get('/api/progress',auth,(req,res)=>{
  const row=db.prepare('SELECT state_json,updated_at FROM progress WHERE user_id=?').get(req.user.id);
  res.json(row ? {state:JSON.parse(row.state_json),updated_at:row.updated_at} : {state:null});
});
app.put('/api/progress',auth,(req,res)=>{
  const state=req.body?.state;
  if(!state || typeof state!=='object') return res.status(400).json({error:'Нет состояния игры'});
  const json=JSON.stringify(state);
  if(json.length>900000) return res.status(413).json({error:'Состояние игры слишком большое'});
  db.prepare(`INSERT INTO progress(user_id,state_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP`).run(req.user.id,json);
  res.json({ok:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Ocean Strike running on http://localhost:${PORT}`));
