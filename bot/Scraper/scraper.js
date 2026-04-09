// Scraper/scraper.js
require('dotenv').config();
const puppeteer = require('puppeteer');

const LOGIN_ID = process.env.LOGIN_ID;
const PASSWORD = process.env.PASSWORD;

const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

function formatDateWithDay(dateStr) {
  const date = new Date(dateStr);
  const day = dayNames[date.getDay()];
  return `${dateStr}(${day})`;
}

// =============================
// 日付・時間をパース
// 入力例: "2026/4/8 19:00-21:00"
// =============================
function parseRequest(line) {
  const match = line.trim().match(
    /^(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/
  );
  if (!match) return null;

  const [, date, start, end] = match;

  // 月・日をゼロ埋め (2026/4/8 → 2026/04/08)
  const [y, m, d] = date.split('/');
  const normalizedDate = `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;

  return { date: normalizedDate, checkTime: { start, end } };
}

// =============================
// メイン: 複数リクエストを順番にチェック
// onResult(line, result) で1件ずつコールバック
// =============================
async function checkAvailabilityList(requests, onResult) {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // =============================
    // 1. ログイン
    // =============================
    await page.goto(
      'https://csweb.u-aizu.ac.jp/campusweb/campusportal.do',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );

    await page.waitForSelector('input[name="userName"]', { timeout: 15000 });
    await page.type('input[name="userName"]', LOGIN_ID);
    await page.type('input[name="password"]', PASSWORD);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[value="ログイン"], button, input[type="submit"]')
    ]);

    // =============================
    // 2. 施設利用状況参照を開く
    // =============================
    await page.waitForSelector('#tab-kh', { timeout: 15000 });
    await page.click('#tab-kh');

    await page.waitForSelector('li.menu-func span', { timeout: 15000 });
    await page.evaluate(() => {
      loadPortletMenu(
        'main',
        'campussquare.do?_flowId=KHW0001300-flow',
        { portletFlg: '0', mainWfId: 'main_KHW0001300_menu' }
      );
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const targetFrame = page.frames().find(f =>
      f.url().includes('campussquare.do')
    );

    // =============================
    // 3. 各リクエストを順番に処理
    // =============================
    for (const { date, checkTime, originalLine } of requests) {
      try {
        const formattedDate = formatDateWithDay(date);

        // 日付入力
        await targetFrame.waitForSelector('#displayDateStr', { timeout: 15000 });
        await targetFrame.evaluate((val) => {
          const input = document.querySelector('#displayDateStr');
          input.value = val;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, formattedDate);

        // 表示ボタン
        await targetFrame.waitForSelector(
          'input[type="submit"][value="表示"]',
          { timeout: 15000 }
        );
        await targetFrame.click('input[type="submit"][value="表示"]');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 空き状況チェック
        const result = await targetFrame.evaluate((checkTime) => {
          const BASE_HOUR   = 6;
          const TOTAL_SLOTS = (21 - BASE_HOUR) * 6;

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

          const DISPLAY_START = timeToIndex('09:00');
          const startIdx = timeToIndex(checkTime.start);
          const endIdx   = timeToIndex(checkTime.end);

          const rows = Array.from(document.querySelectorAll('tr'));
          const targetRow = rows.find(row => {
            const cell = row.querySelector('td.kyuko-shi-shisetsunm');
            return cell && cell.textContent.trim() === 'F1会議室';
          });

          if (!targetRow) return { error: 'F1会議室の行が見つかりません' };

          const occupied = new Array(TOTAL_SLOTS).fill(false);
          let colIndex = 0;

          for (const cell of Array.from(targetRow.querySelectorAll('td'))) {
            if (cell.classList.contains('kyuko-shi-shisetsunm')) continue;
            if (colIndex >= TOTAL_SLOTS) break;

            const colspan = parseInt(cell.getAttribute('colspan') || '1');
            if (cell.classList.contains('kyuko-shi-jugyo')) {
              for (let i = colIndex; i < colIndex + colspan && i < TOTAL_SLOTS; i++) {
                occupied[i] = true;
              }
            }
            colIndex += colspan;
          }

          const isOccupied = occupied.slice(startIdx, endIdx).some(v => v);
          if (!isOccupied) return { status: 'Open' };

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

          const filteredSlots = freeSlots.filter(slot =>
            timeToIndex(slot.split('~')[0]) >= DISPLAY_START
          );

          const freeAfterStart = filteredSlots.filter(slot =>
            timeToIndex(slot.split('~')[1]) > startIdx
          );

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
            freeSlots: filteredSlots
          };

        }, checkTime);

        // 1件ずつコールバックで通知
        await onResult(originalLine, date, checkTime, result);

      } catch (err) {
        await onResult(originalLine, date, checkTime, { error: err.message });
      }
    }

  } finally {
    await browser.close();
  }
}

module.exports = { parseRequest, checkAvailabilityList };