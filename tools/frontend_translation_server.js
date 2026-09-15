const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const statePath = path.join(root, 'frontend-translation-state.json');
const outputPath = path.join(root, 'dist', 'frontend-zh-CN.json');
const reportPath = path.join(root, 'dist', 'frontend-translation-report.json');
const port = Number(process.argv[2] || 8765);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const english = JSON.parse(fs.readFileSync(state.english_path, 'utf8').replace(/^\uFEFF/, ''));

const variableSignature = text => [...String(text).matchAll(/\{\s*([A-Za-z_][\w.-]*)\s*(?=[,}])/g)].map(x => x[1]).sort().join('\n');
const tagSignature = text => [...String(text).matchAll(/<\/?([A-Za-z][\w.-]*)\b[^>]*>/g)].map(x => x[1]).sort().join('\n');
const valid = (source, translated) => typeof translated === 'string' && translated.trim() && variableSignature(source) === variableSignature(translated) && tagSignature(source) === tagSignature(translated);
const shouldTranslate = text => {
  const value = String(text).trim();
  if (!/[A-Za-z]/.test(value) || /^(?:https?:\/\/|mailto:|[A-Za-z]:\\|\/[\/\w.-]+$)/.test(value)) return false;
  if (!value.includes(' ') && /^[A-Za-z0-9_.+/@:#-]+$/.test(value)) return false;
  return true;
};
const attempts = state.attempts || (state.attempts = {});
const issues = state.issues || (state.issues = {});
const translations = state.translations || (state.translations = {});

function saveState() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}
function pendingKeys() {
  return Object.keys(english).filter(key => !(key in translations) && shouldTranslate(english[key]) && (attempts[key] || 0) < 3);
}
function status() {
  const pending = pendingKeys();
  const exhausted = Object.keys(english).filter(key => !(key in translations) && shouldTranslate(english[key]) && (attempts[key] || 0) >= 3);
  return {pending: pending.length, exhausted: exhausted.length, translated: Object.keys(translations).length, total: Object.keys(english).length};
}
function nextBatch(limit = 4300) {
  const keys = pendingKeys();
  const items = [];
  let total = 0;
  for (const key of keys) {
    const source = english[key];
    const n = items.length + 1;
    const addition = 9 + source.length + 1;
    if (items.length && total + addition > limit) break;
    items.push({n, key, source});
    total += addition;
  }
  return {done: !items.length, items, text: items.map(x => `⟦${String(x.n).padStart(5, '0')}⟧ ${x.source}`).join('\n'), pending: keys.length, translated: Object.keys(translations).length, total: Object.keys(english).length};
}
function accept(items, result) {
  const matches = [...String(result).matchAll(/⟦(\d{5})⟧\s*/g)];
  const parsed = new Map();
  matches.forEach((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : result.length;
    parsed.set(Number(match[1]), result.slice(match.index + match[0].length, end).trim());
  });
  let accepted = 0, rejected = 0;
  for (const item of items) {
    const translated = parsed.get(Number(item.n)) || '';
    attempts[item.key] = (attempts[item.key] || 0) + 1;
    if (valid(english[item.key], translated)) {
      translations[item.key] = translated;
      delete issues[item.key];
      accepted++;
    } else {
      issues[item.key] = 'Google 译文缺失或占位符/标签结构发生变化';
      rejected++;
    }
  }
  saveState();
  return {accepted, rejected, ...status()};
}
function finalize() {
  const output = Object.fromEntries(Object.entries(english).map(([key, value]) => [key, translations[key] || value]));
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  const unchanged = Object.keys(english).filter(key => output[key] === english[key]);
  const report = {english_path: state.english_path, total: Object.keys(output).length, translated: Object.keys(output).length - unchanged.length, unchanged: unchanged.length, issues, source_hits: state.source_hits || {}};
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}
function reply(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type'});
  res.end(body);
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET' && req.url === '/next') return reply(res, 200, nextBatch());
  if (req.method === 'GET' && req.url === '/status') return reply(res, 200, status());
  if (req.method === 'GET' && req.url === '/finalize') return reply(res, 200, finalize());
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { reply(res, 200, accept(JSON.parse(body).items, JSON.parse(body).result)); }
      catch (error) { reply(res, 500, {error: String(error.stack || error)}); }
    });
    return;
  }
  reply(res, 404, {error: 'not found'});
}).listen(port, '0.0.0.0', () => console.log(JSON.stringify({url: `http://127.0.0.1:${port}`, ...status()})));
