// scraper.js
const puppeteer = require('puppeteer');

const LOGIN_ID = 's1310056';
const PASSWORD = 'aduadi00i11';

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // デバッグ中はfalse
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // 1. ログインページへアクセス
    await page.goto(
      'https://csweb.u-aizu.ac.jp/campusweb/campusportal.do',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );

    console.log("ページ読み込み完了");

    // 2. フォーム入力
    await page.waitForSelector('input[name="userName"]', { timeout: 15000 });

    await page.type('input[name="userName"]', LOGIN_ID);
    await page.type('input[name="password"]', PASSWORD);

    console.log("入力完了");

    // 3. ログイン処理（複数パターン対応）
    const loginButtonSelector = 'input[value="ログイン"], button, input[type="button"], input[type="submit"]';

    await page.waitForSelector(loginButtonSelector, { timeout: 10000 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click(loginButtonSelector)
    ]);

    console.log('ログイン成功（遷移確認）');

    // 4. データ取得（とりあえずページ全体確認）
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('ページ内容一部:', bodyText.slice(0, 300));

    // 5. スクショ
    await page.screenshot({ path: 'debug.png', fullPage: true });

  } catch (err) {
    console.error('エラー:', err.message);
    await page.screenshot({ path: 'error.png' });
  } finally {
    await browser.close();
  }
})();