const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');
const {parse: parseIcu} = require('@formatjs/icu-messageformat-parser');

const root = path.resolve(__dirname, '..');
const statePath = path.join(root, 'frontend-translation-state.json');
const outputPath = path.join(root, 'dist', 'frontend-zh-CN.json');
const reportPath = path.join(root, 'dist', 'frontend-translation-report.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const english = JSON.parse(fs.readFileSync(state.english_path, 'utf8').replace(/^\uFEFF/, ''));

function skeletonNode(node) {
  if (node.type === 0) return {type: 0};
  const result = {type: node.type};
  if ('value' in node) result.value = node.value;
  if ('style' in node && node.style != null) result.style = node.style;
  if ('offset' in node) result.offset = node.offset;
  if ('pluralType' in node) result.pluralType = node.pluralType;
  if (node.options) result.options = Object.fromEntries(Object.keys(node.options).sort().map(key => [key, skeleton(node.options[key].value)]));
  if (node.children) result.children = skeleton(node.children);
  return result;
}
function skeleton(nodes) {
  const result = [];
  for (const node of nodes.map(skeletonNode)) {
    if (node.type === 0 && result.at(-1)?.type === 0) continue;
    result.push(node);
  }
  return result;
}
const valid = (source, target) => {
  if (typeof target !== 'string' || !target.trim()) return false;
  try { return JSON.stringify(skeleton(parseIcu(source))) === JSON.stringify(skeleton(parseIcu(target))); }
  catch { return false; }
};

function mask(source) {
  const replacements = [];
  const token = value => {
    const key = `ZXQ${String(replacements.length + 1).padStart(4, '0')}QXZ`;
    replacements.push([key, value]);
    return key;
  };
  let text = source.replace(/<\/?[A-Za-z][^>]*>/g, token);
  // Hide the complete ICU/message-format grammar and translate only the human
  // prose between those tokens. Restoring the tokens recreates byte-for-byte
  // valid placeholders, selectors, braces and formatting directives.
  text = text.replace(/\{\s*[A-Za-z_][\w.-]*\s*,\s*(?:plural|selectordinal|select)\s*,/g, token);
  text = text.replace(/\{\s*[A-Za-z_][\w.-]*\s*,\s*[^{}]+\}/g, token);
  text = text.replace(/\{\s*[A-Za-z_][\w.-]*\s*\}/g, token);
  text = text.replace(/(?:[A-Za-z_][\w.-]*|=\d+)\s*\{/g, token);
  text = text.replace(/[{}]/g, token);
  return {text, replacements};
}
function restore(text, replacements) {
  let result = text;
  for (const [token, value] of replacements) result = result.split(token).join(value);
  return result;
}
function parse(result) {
  const matches = [...result.matchAll(/⟦(\d{5})⟧\s*/g)];
  const values = new Map();
  matches.forEach((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : result.length;
    values.set(Number(match[1]), result.slice(match.index + match[0].length, end).trim());
  });
  return values;
}
async function waitForTranslation(page, marker, previous) {
  const output = page.locator('span[jsname="W297wb"]');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const text = (await output.allTextContents()).map(x => x.trim()).filter(Boolean).join('\n');
    if (text !== previous && text.includes(marker)) return text;
    await page.waitForTimeout(250);
  }
  throw new Error(`等待修复译文超时：${marker}`);
}

(async () => {
  const pending = Object.keys(english).filter(key => !(key in state.translations) && (state.attempts[key] || 0) >= 3);
  const batches = [];
  let current = [], length = 0;
  const single = process.argv.includes('--single');
  for (const key of pending) {
    const masked = mask(english[key]);
    const item = {key, source: english[key], ...masked};
    const addition = masked.text.length + 10;
    if (current.length && (single || length + addition > 4300)) { batches.push(current); current = []; length = 0; }
    current.push(item); length += addition;
  }
  if (current.length) batches.push(current);

  const context = await chromium.launchPersistentContext('tools/google-chrome-profile-repair', {channel: 'chrome', headless: true, locale: 'zh-CN'});
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://translate.google.com/?sl=en&tl=zh-CN&op=translate', {waitUntil: 'domcontentloaded', timeout: 60000});
  const reject = page.getByRole('button', {name: '全部拒绝'});
  if (await reject.count()) await reject.click();
  await page.waitForSelector('textarea', {timeout: 60000});
  const input = page.locator('textarea').first();
  let previous = '', repaired = 0, failed = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const text = batch.map((item, index) => `⟦${String(index + 1).padStart(5, '0')}⟧ ${item.text}`).join('\n');
    const marker = `⟦${String(batch.length).padStart(5, '0')}⟧`;
    await input.fill(text);
    const translated = await waitForTranslation(page, marker, previous);
    previous = translated;
    const values = parse(translated);
    batch.forEach((item, index) => {
      const candidate = restore(values.get(index + 1) || '', item.replacements);
      if (valid(item.source, candidate)) { state.translations[item.key] = candidate; delete state.issues[item.key]; repaired++; }
      else { state.issues[item.key] = '占位符保护后仍无法获得结构有效的 Google 译文'; failed++; }
    });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    console.log(JSON.stringify({batch: batchIndex + 1, batches: batches.length, repaired, failed}));
    await page.waitForTimeout(350);
  }
  await context.close();

  const output = Object.fromEntries(Object.entries(english).map(([key, value]) => [key, state.translations[key] || value]));
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  const unchanged = Object.keys(english).filter(key => output[key] === english[key]);
  const report = {english_path: state.english_path, total: Object.keys(output).length, translated: Object.keys(output).length - unchanged.length, unchanged: unchanged.length, repaired, failed, issues: state.issues, source_hits: state.source_hits || {}};
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({done: true, ...report}));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
