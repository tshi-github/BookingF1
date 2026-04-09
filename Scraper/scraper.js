// scraper.js
require('dotenv').config();
const puppeteer = require('puppeteer');

const LOGIN_ID = process.env.LOGIN_ID;
const PASSWORD = process.env.PASSWORD;

const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

// 日付 + 曜日フォーマット
function formatDateWithDay(dateStr) {
  const date = new Date(dateStr);
  const day = dayNames[date.getDay()];
  return `${dateStr}(${day})`;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // =============================
    // 1. ログインページへアクセス
    // =============================
    await page.goto(
      'https://csweb.u-aizu.ac.jp/campusweb/campusportal.do',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    console.log('ページ読み込み完了');

    // =============================
    // 2. フォーム入力
    // =============================
    await page.waitForSelector('input[name="userName"]', { timeout: 15000 });

    await page.type('input[name="userName"]', LOGIN_ID);
    await page.type('input[name="password"]', PASSWORD);

    console.log('入力完了');

    // =============================
    // 3. ログイン
    // =============================
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[value="ログイン"], button, input[type="submit"]')
    ]);

    console.log('ログイン成功');

    // =============================
    // 3.1 休補・スケジュールタブ
    // =============================
    await page.waitForSelector('#tab-kh', { timeout: 15000 });
    await page.click('#tab-kh');
    console.log('休補・スケジュールタブをクリック');

    // =============================
    // 3.2 施設利用状況参照
    // =============================
    await page.waitForSelector('li.menu-func span', { timeout: 15000 });

    await page.evaluate(() => {
      loadPortletMenu(
        'main',
        'campussquare.do?_flowId=KHW0001300-flow',
        {
          portletFlg: '0',
          mainWfId: 'main_KHW0001300_menu'
        }
      );
    });

    console.log('施設利用状況参照を開いた');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // =============================
    // 3.3 日付入力
    // =============================
    const userInputDate = '2026/04/06';
    const formattedDate = formatDateWithDay(userInputDate);

    const targetFrame = page.frames().find(f =>
      f.url().includes('campussquare.do')
    );

    await targetFrame.waitForSelector('#displayDateStr', { timeout: 15000 });

    await targetFrame.evaluate((val) => {
      const input = document.querySelector('#displayDateStr');
      input.value = val;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, formattedDate);

    console.log(`日付入力: ${formattedDate}`);

    await page.screenshot({ path: 'debug.png', fullPage: true });

    // =============================
    // 3.5 表示ボタン
    // =============================
    await targetFrame.waitForSelector(
      'input[type="submit"][value="表示"]',
      { timeout: 15000 }
    );

    await targetFrame.click('input[type="submit"][value="表示"]');

    console.log('表示ボタンをクリック');

    await new Promise(resolve => setTimeout(resolve, 3000));

    await page.screenshot({ path: 'debug.png', fullPage: true });

    // =============================
    // 4. 空き状況チェック
    // =============================
    const checkTime = { start: '15:00', end: '16:00' };

    const result = await targetFrame.evaluate((checkTime) => {
      // HTML上のセル列は 6:00 始まり (index=0 が 6:00)
      // 表示範囲は 6:00〜21:00 = 90スロット
      const BASE_HOUR   = 6;
      const TOTAL_SLOTS = (21 - BASE_HOUR) * 6; // 90スロット

      function timeToIndex(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return (h - BASE_HOUR) * 6 + Math.floor(m / 10);
      }

      function indexToTime(idx) {
        const totalMin = BASE_HOUR * 60 + idx * 10;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }

      const startIdx = timeToIndex(checkTime.start);
      const endIdx   = timeToIndex(checkTime.end);

      // -------------------------
      // F1会議室の行を取得
      // -------------------------
      const rows = Array.from(document.querySelectorAll('tr'));

      const targetRow = rows.find(row => {
        const cell = row.querySelector('td.kyuko-shi-shisetsunm');
        return cell && cell.textContent.trim() === 'F1会議室';
      });

      if (!targetRow) {
        return { error: 'F1会議室の行が見つかりません' };
      }

      // -------------------------
      // セルを 6:00 から順に走査して occupied[] を構築
      // 予約済みセルの colspan 分だけインデックスを進める
      // -------------------------
      const occupied = new Array(TOTAL_SLOTS).fill(false);
      let colIndex = 0; // 0 = 6:00

      const cells = Array.from(targetRow.querySelectorAll('td'));

      for (const cell of cells) {
        if (cell.classList.contains('kyuko-shi-shisetsunm')) continue;
        if (colIndex >= TOTAL_SLOTS) break;

        const colspan = parseInt(cell.getAttribute('colspan') || '1');
        const isReserved = cell.classList.contains('kyuko-shi-jugyo');

        if (isReserved) {
          // colspan 分まとめて予約済みとしてマーク
          for (let i = colIndex; i < colIndex + colspan && i < TOTAL_SLOTS; i++) {
            occupied[i] = true;
          }
        }

        colIndex += colspan; // 予約済みなら colspan 分スキップ
      }

      // -------------------------
      // 指定時間帯が空いているか確認
      // -------------------------
      const isOccupied = occupied.slice(startIdx, endIdx).some(v => v);

      if (!isOccupied) {
        return { status: 'Open' };
      }

      // -------------------------
      // 空き時間帯を列挙 (9:00〜21:00)
      // -------------------------
      const freeSlots = [];
      let freeStart = null;

      for (let i = 0; i <= TOTAL_SLOTS; i++) {
        if (i < TOTAL_SLOTS && !occupied[i] && freeStart === null) {
          freeStart = i;
        } else if ((i === TOTAL_SLOTS || occupied[i]) && freeStart !== null) {
          freeSlots.push(`${indexToTime(freeStart)}~${indexToTime(i)}`);
          freeStart = null;
        }
      }

      // checkTime.start 以降に空きがあるか確認
      const freeAfterStart = freeSlots.filter(slot => {
        const slotEndTime = slot.split('~')[1];
        return timeToIndex(slotEndTime) > startIdx;
      });

      // 21:00まで空きなし
      if (freeAfterStart.length === 0) {
        return {
          status: 'Occupied',
          allOccupied: true,
          message: `${checkTime.start}〜21:00 は空きがありません`
        };
      }

      return {
        status: 'Occupied',
        allOccupied: false,
        freeSlots
      };

    }, checkTime);

    // =============================
    // 結果表示
    // =============================
    if (result.error) {
      console.log('エラー:', result.error);

    } else if (result.status === 'Open') {
      console.log(`${checkTime.start}-${checkTime.end} は Open`);

    } else if (result.allOccupied) {
      console.log(result.message);

    } else {
      console.log(`${checkTime.start}-${checkTime.end} は予約済み`);
      console.log('空き時間:', result.freeSlots.join(', '));
    }

  } catch (err) {
    console.error('エラー:', err.message);
    await page.screenshot({ path: 'error.png' });

  } finally {
    await browser.close();
  }

})();