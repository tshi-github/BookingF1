// 環境変数を読み込む（.envファイル）
require('dotenv').config();

// Puppeteer（ブラウザ操作）とChromium（サーバー用軽量ブラウザ）
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// 曜日配列（Date.getDay()用）
const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 日付文字列に曜日を付ける
 * 例: 2026/04/09 → 2026/04/09(木)
 */
function formatDateWithDay(dateStr) {
  const date = new Date(dateStr);
  const day = dayNames[date.getDay()];
  return `${dateStr}(${day})`;
}

/**
 * 入力された1行の文字列をパースする
 * 例: "2026/4/9 09:00-10:00"
 */
function parseRequest(line) {
  const match = line.trim().match(
    /^(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/
  );
  if (!match) return null;

  const [, date, start, end] = match;

  // 月日を2桁に補正
  const [y, m, d] = date.split('/');
  const normalizedDate = `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;

  return { date: normalizedDate, checkTime: { start, end } };
}

/**
 * 複数リクエストの空き状況をチェック
 */
async function checkAvailabilityList(requests, onResult) {

  // ブラウザ起動（Renderなどの環境用設定）
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  // 画面サイズ指定
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // 会津大学の施設利用状況ページにアクセス（ログイン不要）
    await page.goto(
      'https://csweb.u-aizu.ac.jp/campusweb/campussquare.do?_flowId=KHW0001310-flow',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );

    // 少し待機（描画安定のため）
    await new Promise(resolve => setTimeout(resolve, 2000));

    // フレーム取得（存在すれば）
    const targetFrame = page.frames().find(f =>
      f.url().includes('campussquare.do')
    ) ?? page.mainFrame();

    // リクエストごとに処理
    for (const { date, checkTime, originalLine } of requests) {
      try {
        const formattedDate = formatDateWithDay(date);

        // 日付入力欄を待つ
        await targetFrame.waitForSelector('#displayDateStr', { timeout: 15000 });

        // 日付をセット
        await targetFrame.evaluate((val) => {
          const input = document.querySelector('#displayDateStr');
          input.value = val;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, formattedDate);

        // 表示ボタンを押す
        await targetFrame.waitForSelector(
          'input[type="submit"][value="表示"]',
          { timeout: 15000 }
        );
        await targetFrame.click('input[type="submit"][value="表示"]');

        // 読み込み待機
        await new Promise(resolve => setTimeout(resolve, 3000));

        // ページ内で空き状況を解析
        const result = await targetFrame.evaluate((checkTime) => {

          // 6:00〜21:00 を10分刻みで管理
          const BASE_HOUR   = 6;
          const TOTAL_SLOTS = (21 - BASE_HOUR) * 6;

          // 時刻 → インデックス変換
          function timeToIndex(timeStr) {
            const [h, m] = timeStr.split(':').map(Number);
            return (h - BASE_HOUR) * 6 + Math.floor(m / 10);
          }

          // インデックス → 時刻変換
          function indexToTime(idx) {
            const totalMin = BASE_HOUR * 60 + idx * 10;
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          }

          // 9:00以降のみ表示対象
          const DISPLAY_START = timeToIndex('09:00');

          const startIdx = timeToIndex(checkTime.start);
          const endIdx   = timeToIndex(checkTime.end);

          // テーブルの行取得
          const rows = Array.from(document.querySelectorAll('tr'));

          // F1会議室の行を探す
          const targetRow = rows.find(row => {
            const cell = row.querySelector('td.kyuko-shi-shisetsunm');
            return cell && cell.textContent.trim() === 'F1会議室';
          });

          if (!targetRow) return { error: 'F1会議室の行が見つかりません' };

          // 各時間帯の占有状態（true = 使用中）
          const occupied = new Array(TOTAL_SLOTS).fill(false);

          let colIndex = 0;

          // 各セルを走査
          for (const cell of Array.from(targetRow.querySelectorAll('td'))) {
            if (cell.classList.contains('kyuko-shi-shisetsunm')) continue;
            if (colIndex >= TOTAL_SLOTS) break;

            const colspan = parseInt(cell.getAttribute('colspan') || '1');

            // 授業などで埋まっている場合
            if (cell.classList.contains('kyuko-shi-jugyo')) {
              for (let i = colIndex; i < colIndex + colspan && i < TOTAL_SLOTS; i++) {
                occupied[i] = true;
              }
            }

            colIndex += colspan;
          }

          // 指定時間内に埋まりがあるか
          const isOccupied = occupied.slice(startIdx, endIdx).some(v => v);

          // 完全に空いている
          if (!isOccupied) return { status: 'Open' };

          // 空き時間帯を抽出
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

          // 9:00以降に絞る
          const filteredSlots = freeSlots.filter(slot =>
            timeToIndex(slot.split('~')[0]) >= DISPLAY_START
          );

          // 指定開始時刻以降に空きがあるか
          const freeAfterStart = filteredSlots.filter(slot =>
            timeToIndex(slot.split('~')[1]) > startIdx
          );

          // 以降すべて埋まっている
          if (freeAfterStart.length === 0) {
            return {
              status: 'Occupied',
              allOccupied: true,
              message: `${checkTime.start}〜21:00 は空きがありません`
            };
          }

          // 一部空きあり
          return {
            status: 'Occupied',
            allOccupied: false,
            freeSlots: filteredSlots
          };

        }, checkTime);

        // 結果をコールバックで返す
        await onResult(originalLine, date, checkTime, result);

      } catch (err) {
        // エラー時もコールバックで返す
        await onResult(originalLine, date, checkTime, { error: err.message });
      }
    }

  } finally {
    // 最後にブラウザを閉じる
    await browser.close();
  }
}

// 外部から使えるようにエクスポート
module.exports = { parseRequest, checkAvailabilityList };