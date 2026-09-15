(() => {
  if (globalThis.__claudeZhLanguagePackInstalled) return;
  globalThis.__claudeZhLanguagePackInstalled = true;

  const dictionary = Object.assign(__CLAUDE_ZH_DICTIONARY__, {
    'Reminder: The summer Claude Code promotion, which boosted weekly limits by 50%, ended on September 13. But we\'re making part of it permanent: your weekly limit is now 25% higher than it was before the promotion.': '提醒：让每周限额提高 50% 的 Claude Code 夏季促销已于 9 月 13 日结束。但其中一部分优惠将永久保留：你的每周限额现在比促销前高 25%。',
    'Auto': '自动',
    'Manual': '手动',
    'Accept edits': '接受修改',
    'Plan': '计划',
    'Bypass permissions': '跳过权限检查',
    'Max': 'Max',
    'Claude Max': 'Claude Max',
    'Extra': '额外',
    'Effort': '思考强度',
    'About effort': '关于思考强度',
    'Open effort selector': '打开思考强度选择器',
    'Change effort level?': '要更改思考强度吗？',
    'Faster': '更快',
    'Smarter': '更深入',
    'Faster responses, higher cost. Opus only.': '响应更快，费用更高。仅限 Opus。',
    'Higher effort means more thorough responses, but takes longer and uses your limits faster.': '思考强度越高，回答越全面，但耗时更长，也会更快消耗你的额度。',
    'Claude handles permission decisions': '由 Claude 决定是否需要批准',
    'Always ask before making changes': '修改前始终询问',
    'Automatically accept all file edits': '自动批准所有文件修改',
    'Create a plan before making changes': '修改前先制定计划',
    'Accepts all permissions': '自动允许所有权限',
    'Read more': '阅读更多',
    'Learn more': '了解更多',
    'Learn more about usage limits': '详细了解使用量限制',
    'Weekly limits': '每周限额',
    'All models': '所有模型',
    'Usage credits': '使用量积分',
    'Turn on usage credits to keep using Claude if you hit a plan limit.': '开启使用量积分，以便在达到计划限额后继续使用 Claude。',
    'Desktop app': '桌面应用',
    'Platform': '平台',
    'Skills': '技能',
    'Connectors': '连接器',
    'Plugins': '插件',
    'API keys': 'API 密钥',
    'Max (5x)': '上限（5 倍）',
    'Current session': '当前会话',
    'Last updated: less than a minute ago': '最后更新：不到一分钟前',
    'Overview': '概览',
    'Models': '模型',
    'All': '全部',
    '30d': '30 天',
    '7d': '7 天',
    'Sessions': '会话数',
    'Messages': '消息数',
    'Total tokens': 'Token 总数',
    'Active days': '活跃天数',
    'Current streak': '当前连续天数',
    'Longest streak': '最长连续天数',
    'Peak hour': '高峰时段',
    'Favorite model': '最常用模型',
    'You\'ve used ~6x more tokens than Moby-Dick.': '你使用的 Token 数量约为《白鲸》的 6 倍。',
  });
  const languageKey = 'claude-zh-language';
  const legacyEnabled = localStorage.getItem('claude-zh-language-pack-enabled');
  let selectedLanguage = localStorage.getItem(languageKey) || (legacyEnabled === '0' ? 'en-US' : 'zh-CN');
  let enabled = selectedLanguage !== 'en-US';
  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();
  const observedRoots = new WeakSet();
  const observationOptions = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] };

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const skipped = element => !!element?.closest?.(
    'pre, code, textarea, input, [contenteditable="true"], article, ' +
    '[data-testid*="message" i], [data-testid*="conversation" i], [data-testid*="artifact" i], ' +
    '[class*="font-user-message" i], [class*="font-claude-response" i], [class~="prose"], [class*="prose-"]'
  );

  function translate(value) {
    const text = normalize(value);
    if (!text) return null;
    if (dictionary[text] && dictionary[text] !== text) return dictionary[text];
    const patterns = [
      [/^Resets in (.+)$/, (_, value) => `将在 ${value.replace(/\bhr\b/g, '小时').replace(/\bmin\b/g, '分钟')}后重置`],
      [/^Resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(.+)$/, (_, day, time) => {
        const days = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
        return `重置时间：${days[day] || day} ${time.replace(/\bAM\b/g, '上午').replace(/\bPM\b/g, '下午')}`;
      }],
      [/^Resets (Jan|January) (\d{1,2})$/, '重置时间：1 月 $2 日'],
      [/^Resets (Feb|February) (\d{1,2})$/, '重置时间：2 月 $2 日'],
      [/^Resets (Mar|March) (\d{1,2})$/, '重置时间：3 月 $2 日'],
      [/^Resets (Apr|April) (\d{1,2})$/, '重置时间：4 月 $2 日'],
      [/^Resets (May) (\d{1,2})$/, '重置时间：5 月 $2 日'],
      [/^Resets (Jun|June) (\d{1,2})$/, '重置时间：6 月 $2 日'],
      [/^Resets (Jul|July) (\d{1,2})$/, '重置时间：7 月 $2 日'],
      [/^Resets (Aug|August) (\d{1,2})$/, '重置时间：8 月 $2 日'],
      [/^Resets (Sep|September) (\d{1,2})$/, '重置时间：9 月 $2 日'],
      [/^Resets (Oct|October) (\d{1,2})$/, '重置时间：10 月 $2 日'],
      [/^Resets (Nov|November) (\d{1,2})$/, '重置时间：11 月 $2 日'],
      [/^Resets (Dec|December) (\d{1,2})$/, '重置时间：12 月 $2 日'],
      [/^Resets (.+)$/, '重置时间：$1'],
      [/^(\d+)% used$/, '$1% 已使用'],
      [/^Last updated: less than a minute ago$/, '最后更新：不到一分钟前'],
      [/^Last updated: (.+)$/, '最后更新：$1'],
      [/^(\d{1,2})\s*(AM|PM)$/, (_, hour, meridiem) => `${meridiem === 'AM' ? '上午' : '下午'} ${hour} 点`],
      [/^(\d+) days? ago$/, '$1 天前'],
      [/^(\d+) hours? ago$/, '$1 小时前'],
      [/^(\d+) minutes? ago$/, '$1 分钟前'],
      [/^\$(.+) spent$/, '已花费 $$$1'],
      [/^New chat with (.+)$/, '与 $1 新建对话'],
      [/^Delete (.+)\?$/, '删除 $1？'],
      [/^Search (.+)$/, '搜索 $1'],
    ];
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(text)) return text.replace(pattern, replacement);
    }
    return null;
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!enabled || !parent || skipped(parent)) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const translated = translate(node.nodeValue);
    if (translated && normalize(node.nodeValue) !== normalize(translated)) node.nodeValue = translated;
  }

  function translateElement(element) {
    if (!(element instanceof Element) || skipped(element)) return;
    const attrs = ['aria-label', 'title', 'placeholder', 'data-placeholder'];
    for (const attr of attrs) {
      if (!element.hasAttribute(attr)) continue;
      let saved = originalAttrs.get(element);
      if (!saved) originalAttrs.set(element, saved = {});
      if (!(attr in saved)) saved[attr] = element.getAttribute(attr);
      const translated = translate(element.getAttribute(attr));
      if (enabled && translated) element.setAttribute(attr, translated);
    }
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    }
  }

  function restoreRoot(root) {
    root.querySelectorAll?.('*').forEach(element => {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && originalText.has(node)) node.nodeValue = originalText.get(node);
      }
      const attrs = originalAttrs.get(element);
      if (attrs) for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
      if (element.shadowRoot) restoreRoot(element.shadowRoot);
    });
  }

  function restore() { restoreRoot(document); }

  function setLanguage(language) {
    selectedLanguage = language;
    enabled = language !== 'en-US';
    localStorage.setItem(languageKey, language);
    if (document.documentElement) document.documentElement.lang = enabled ? 'zh-CN' : 'en-US';
    if (enabled) scan(document); else restore();
  }

  function addChineseLanguageOption(root = document) {
    const headings = [...root.querySelectorAll('h1,h2,h3,[role="heading"]')];
    const heading = headings.find(e => /^(Choose your language|选择语言)$/.test(normalize(e.textContent)));
    if (!heading) return;
    const dialog = heading.closest('[role="dialog"]') || heading.parentElement?.parentElement;
    if (!dialog || dialog.querySelector('[data-claude-zh-language-option]')) return;
    const candidates = [...dialog.querySelectorAll('button,[role="option"],[role="radio"]')];
    const sample = candidates.find(e => /English \(United States\)/.test(e.textContent));
    if (!sample) return;
    const option = sample.cloneNode(true);
    option.dataset.claudeZhLanguageOption = 'true';
    option.removeAttribute('aria-checked');
    option.querySelectorAll('svg').forEach(e => e.remove());
    const lines = [...option.querySelectorAll('*')].filter(e => e.children.length === 0 && normalize(e.textContent));
    if (lines[0]) lines[0].textContent = '简体中文（中国）';
    if (lines[1]) lines[1].textContent = 'Chinese (Simplified)';
    if (!lines.length) option.textContent = '简体中文（中国）\nChinese (Simplified)';
    option.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setLanguage('zh-CN');
      const close = dialog.querySelector('button[aria-label*="Close"],button[aria-label*="关闭"]');
      close?.click();
    }, true);
    sample.parentElement?.appendChild(option);
  }

  function scan(root) {
    observeRoot(root);
    if (enabled && root instanceof Element) translateElement(root);
    root.querySelectorAll?.('*').forEach(element => {
      if (enabled) translateElement(element);
      // Electron/React surfaces occasionally render controls in a shadow root;
      // walk those roots too instead of limiting the language pack to light DOM.
      if (element.shadowRoot) scan(element.shadowRoot);
    });
    addChineseLanguageOption(root);
    if (document.documentElement) document.documentElement.lang = enabled ? 'zh-CN' : 'en-US';
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  });

  function observeRoot(root) {
    if (!root || (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) || observedRoots.has(root)) return;
    observedRoots.add(root);
    try { observer.observe(root, observationOptions); } catch {}
  }

  const nativeAttachShadow = Element.prototype.attachShadow;
  if (nativeAttachShadow && !Element.prototype.__claudeZhAttachShadowPatched) {
    Element.prototype.__claudeZhAttachShadowPatched = true;
    Element.prototype.attachShadow = function(init) {
      const shadow = nativeAttachShadow.call(this, init);
      queueMicrotask(() => scan(shadow));
      return shadow;
    };
  }

  const start = () => {
    scan(document);
  };
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start, { once: true });

  addEventListener('click', event => {
    if (!event.target?.closest) return;
    const option = event.target.closest('button,[role="option"],[role="radio"]');
    if (!option || option.dataset.claudeZhLanguageOption === 'true') return;
    const text = normalize(option.textContent);
    if (/^English(?:\s|$)/.test(text)) setLanguage('en-US');
  }, true);

  addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyL') {
      setLanguage(enabled ? 'en-US' : 'zh-CN');
    }
  }, true);
})();
