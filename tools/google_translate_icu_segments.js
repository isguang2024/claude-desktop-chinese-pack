const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');
const {parse, isStructurallyValid} = require('@formatjs/icu-messageformat-parser');

const root = path.resolve(__dirname, '..');
const statePath = path.join(root, 'frontend-translation-state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const english = JSON.parse(fs.readFileSync(state.english_path, 'utf8').replace(/^\uFEFF/, ''));

function serializeStyle(style) {
  if (style == null) return '';
  if (typeof style === 'string') return `, ${style}`;
  if (style.type === 'number') return `, ::${style.skeleton || ''}`;
  return '';
}
function serialize(nodes) {
  return nodes.map(node => {
    switch (node.type) {
      case 0: return node.value;
      case 1: return `{${node.value}}`;
      case 2: return `{${node.value}, number${serializeStyle(node.style)}}`;
      case 3: return `{${node.value}, date${serializeStyle(node.style)}}`;
      case 4: return `{${node.value}, time${serializeStyle(node.style)}}`;
      case 5: return `{${node.value}, select, ${Object.entries(node.options).map(([key, value]) => `${key} {${serialize(value.value)}}`).join(' ')}}`;
      case 6: return `{${node.value}, ${node.pluralType === 'ordinal' ? 'selectordinal' : 'plural'}, ${node.offset ? `offset:${node.offset} ` : ''}${Object.entries(node.options).map(([key, value]) => `${key} {${serialize(value.value)}}`).join(' ')}}`;
      case 7: return '#';
      case 8: return `<${node.value}>${serialize(node.children)}</${node.value}>`;
      default: return '';
    }
  }).join('');
}
function walk(nodes, callback) {
  for (const node of nodes) {
    if (node.type === 0 && node.value.trim()) callback(node);
    if (node.options) Object.values(node.options).forEach(option => walk(option.value, callback));
    if (node.children) walk(node.children, callback);
  }
}
function skeleton(nodes) {
  return nodes.map(node => {
    const out = {type: node.type};
    if (node.type !== 0 && node.value != null) out.value = node.value;
    if (node.style != null) out.style = node.style;
    if (node.offset != null) out.offset = node.offset;
    if (node.pluralType != null) out.pluralType = node.pluralType;
    if (node.options) out.options = Object.fromEntries(Object.keys(node.options).sort().map(key => [key, skeleton(node.options[key].value)]));
    if (node.children) out.children = skeleton(node.children);
    return out;
  });
}
function compatible(source, target) {
  try { return JSON.stringify(skeleton(parse(source))) === JSON.stringify(skeleton(parse(target))); }
  catch { return false; }
}
function protect(value) {
  return value.replace(/\r?\n/g, ' ␤ ').replace(/\t/g, ' ␉ ');
}
function restore(value) {
  return value.replace(/\s*␤\s*/g, '\n').replace(/\s*␉\s*/g, '\t');
}

(async () => {
  const shouldProcess = value => {
    const text = String(value).trim();
    if (!/[A-Za-z]/.test(text) || /^(?:https?:\/\/|mailto:|[A-Za-z]:\\|\/[\/\w.-]+$)/.test(text)) return false;
    if (/^[A-Z0-9_.+/@:#-]+$/.test(text)) return false;
    if (/^[A-Za-z0-9_.+/@:#-]+$/.test(text) && /[-_/@:#.+]/.test(text)) return false;
    return true;
  };
  const issueKeys = Object.keys(english).filter(key => (!(key in state.translations) || state.translations[key] === english[key]) && shouldProcess(english[key]));
  const segmentMap = new Map();
  const parsed = new Map();
  for (const key of issueKeys) {
    try {
      const ast = parse(english[key]);
      parsed.set(key, ast);
      walk(ast, node => segmentMap.set(node.value, protect(node.value)));
    } catch { /* leave an unparseable entry unchanged */ }
  }
  const segments = [...segmentMap.entries()];
  const batches = [];
  let current = [], length = 0;
  for (const [source, protectedText] of segments) {
    const addition = protectedText.length + 10;
    if (current.length && length + addition > 4300) { batches.push(current); current = []; length = 0; }
    current.push({source, protectedText, n: current.length + 1});
    length += addition;
  }
  if (current.length) batches.push(current);

  const context = await chromium.launchPersistentContext('tools/google-chrome-profile-segments', {channel: 'chrome', headless: true, locale: 'zh-CN'});
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://translate.google.com/?sl=en&tl=zh-CN&op=translate', {waitUntil: 'domcontentloaded', timeout: 60000});
  const reject = page.getByRole('button', {name: '全部拒绝'});
  if (await reject.count()) await reject.click();
  await page.waitForSelector('textarea', {timeout: 60000});
  const input = page.locator('textarea').first();
  const translatedSegments = new Map();
  let previous = '';
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const text = batch.map(item => `⟦${String(item.n).padStart(5, '0')}⟧ ${item.protectedText}`).join('\n');
    const marker = `⟦${String(batch.length).padStart(5, '0')}⟧`;
    await input.fill('');
    await page.waitForTimeout(300);
    await input.fill(text);
    const output = page.locator('span[jsname="W297wb"]');
    const deadline = Date.now() + 45000;
    let result = '';
    while (Date.now() < deadline) {
      result = (await output.allTextContents()).map(x => x.trim()).filter(Boolean).join('\n');
      if (result !== previous && result.includes(marker)) break;
      await page.waitForTimeout(250);
    }
    if (!result.includes(marker)) throw new Error(`Google 翻译片段超时：${batchIndex + 1}/${batches.length}`);
    previous = result;
    const matches = [...result.matchAll(/⟦(\d{5})⟧\s*/g)];
    matches.forEach((match, index) => {
      const end = index + 1 < matches.length ? matches[index + 1].index : result.length;
      const item = batch.find(x => x.n === Number(match[1]));
      if (item) translatedSegments.set(item.source, restore(result.slice(match.index + match[0].length, end).trim()));
    });
    console.log(JSON.stringify({batch: batchIndex + 1, batches: batches.length, segments: translatedSegments.size}));
  }
  await context.close();

  let translated = 0;
  for (const key of issueKeys) {
    const ast = parsed.get(key);
    if (!ast) continue;
    walk(ast, node => { if (translatedSegments.has(node.value)) node.value = translatedSegments.get(node.value); });
    const candidate = serialize(ast);
    if (compatible(english[key], candidate)) { state.translations[key] = candidate; delete state.issues[key]; translated++; }
    else console.error(JSON.stringify({key, source: english[key], candidate}));
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  const output = Object.fromEntries(Object.entries(english).map(([key, value]) => [key, state.translations[key] || value]));
  fs.writeFileSync(path.join(root, 'dist', 'frontend-zh-CN.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({done: true, issueKeys: issueKeys.length, translated, remainingIssues: Object.keys(state.issues).length}));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
