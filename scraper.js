// scraper.js
const puppeteer = require('puppeteer');

const LOGIN_ID = 's1310056';
const PASSWORD = 'aduadi00i11';

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // デバッグ中はfalse
    slowMo: 100,
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

    // 3. ログイン処理
    const loginButtonSelector = 'input[value="ログイン"], button, input[type="button"], input[type="submit"]';

    await page.waitForSelector(loginButtonSelector, { timeout: 10000 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click(loginButtonSelector)
    ]);

    console.log('ログイン成功（遷移確認）');

    // 3.1 休講・スケジュール
    await page.waitForSelector('#tab-kh', { timeout: 15000 });
    await page.click('#tab-kh');
    console.log('休講・スケジュールタブをクリック');

    // 3.2 施設利用状況参照
    await page.waitForSelector('li.menu-func span', { timeout: 15000 });

    // onclickのloadPortletMenuを直接実行
    await page.evaluate(() => {
      loadPortletMenu('main', 'campussquare.do?_flowId=KHW0001300-flow', {
        portletFlg: '0',
        mainWfId: 'main_KHW0001300_menu'
      });
    });

    console.log('施設利用状況参照を開いた');

    // 少し待機
    await new Promise(resolve => setTimeout(resolve, 3000));

    // スクショ
    await page.screenshot({ path: 'shisetsu.png', fullPage: true });
    console.log('スクリーンショット保存: shisetsu.png');

    // デバッグ用スクショ
    await page.screenshot({ path: 'debug.png', fullPage: true });

  } catch (err) {
    console.error('エラー:', err.message);
    await page.screenshot({ path: 'error.png' });
  } finally {
    await browser.close();
  }

})();