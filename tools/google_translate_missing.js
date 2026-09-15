const {chromium} = require('playwright');

const base = 'http://127.0.0.1:8799';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function translatedText(page, expectedMarker, previous) {
  const output = page.locator('span[jsname="W297wb"]');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const values = await output.allTextContents();
    const text = values.map(value => value.trim()).filter(Boolean).join('\n');
    if (text !== previous && text.includes(expectedMarker)) return text;
    await page.waitForTimeout(250);
  }
  throw new Error(`等待 Google 译文超时：${expectedMarker}`);
}

(async () => {
  const context = await chromium.launchPersistentContext('tools/google-chrome-profile', {
    channel: 'chrome',
    headless: true,
    locale: 'zh-CN',
    viewport: {width: 1280, height: 900},
  });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  await page.goto('https://translate.google.com/?sl=en&tl=zh-CN&op=translate', {waitUntil: 'domcontentloaded', timeout: 60000});
  const reject = page.getByRole('button', {name: '全部拒绝'});
  if (await reject.count()) {
    await reject.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  await page.waitForSelector('textarea', {timeout: 60000});
  const source = page.locator('textarea').first();
  let batchNumber = 0;
  let previous = '';
  try {
    while (true) {
      const batch = await json(base + '/next');
      if (batch.done) break;
      const expected = `⟦${String(batch.items.length).padStart(5, '0')}⟧`;
      let result = '';
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await source.fill(batch.text);
          result = await translatedText(page, expected, previous);
          break;
        } catch (error) {
          lastError = error;
          await page.reload({waitUntil: 'domcontentloaded', timeout: 60000});
          await page.waitForSelector('textarea', {timeout: 60000});
        }
      }
      if (!result) throw lastError;
      const saved = await json(base + '/save', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({items: batch.items, result}),
      });
      previous = result;
      batchNumber++;
      if (batchNumber % 5 === 0 || saved.rejected) {
        console.log(JSON.stringify({batch: batchNumber, ...saved}));
      }
      await sleep(350);
    }
    const report = await json(base + '/finalize');
    console.log(JSON.stringify({done: true, batches: batchNumber, ...report}));
  } finally {
    await context.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
