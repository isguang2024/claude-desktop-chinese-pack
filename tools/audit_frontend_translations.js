const fs = require('fs');
const path = require('path');
const {parse} = require('@formatjs/icu-messageformat-parser');

const root = path.resolve(__dirname, '..');
const statePath = path.join(root, 'frontend-translation-state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const english = JSON.parse(fs.readFileSync(state.english_path, 'utf8').replace(/^\uFEFF/, ''));
const onlineRoot = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp', 'claude-zh-online');
const sourcePaths = [
  path.join(onlineRoot, 'Jyy1529-claude-desktop_win-zh_cn', 'resources', 'frontend-zh-CN.json'),
  path.join(onlineRoot, 'good9527-Claude-Desktop-Chinese', 'dist', 'zh-CN.json'),
  path.join(onlineRoot, 'javaht-claude-desktop-zh-cn', 'resources', 'frontend-zh-CN.json'),
  path.join(onlineRoot, 'LifeActor-Claude_zh-CN_LanguagePack', 'translated-zh-CN', 'ion-dist', 'zh-CN.json'),
];
const sources = sourcePaths.filter(fs.existsSync).map(file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));

function skeletonNode(node) {
  if (node.type === 0) return {type: 0};
  const result = {type: node.type};
  if ('value' in node && node.type !== 0) result.value = node.value;
  if ('style' in node && node.style != null) result.style = node.style;
  if ('offset' in node) result.offset = node.offset;
  if ('pluralType' in node) result.pluralType = node.pluralType;
  if (node.options) {
    result.options = Object.fromEntries(Object.keys(node.options).sort().map(key => [key, skeleton(node.options[key].value)]));
  }
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
function compatible(source, target) {
  try { return JSON.stringify(skeleton(parse(source))) === JSON.stringify(skeleton(parse(target))); }
  catch { return false; }
}

let communityRecovered = 0;
for (const key of Object.keys(english)) {
  const current = state.translations[key];
  if (current && current !== english[key] && compatible(english[key], current)) continue;
  delete state.translations[key];
  for (const source of sources) {
    const candidate = source[key];
    if (candidate && candidate !== english[key] && compatible(english[key], candidate)) {
      state.translations[key] = candidate;
      delete state.issues[key];
      communityRecovered++;
      break;
    }
  }
  if (!(key in state.translations) && (state.attempts[key] || 0) > 0) {
    state.attempts[key] = 3;
    state.issues[key] = 'ICU MessageFormat 结构校验未通过';
  }
}

fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
const invalid = Object.keys(english).filter(key => state.translations[key] && !compatible(english[key], state.translations[key]));
const unresolved = Object.keys(english).filter(key => !(key in state.translations) && (state.attempts[key] || 0) >= 3);
console.log(JSON.stringify({total: Object.keys(english).length, translated: Object.keys(state.translations).length, communityRecovered, invalid: invalid.length, unresolved: unresolved.length}, null, 2));
