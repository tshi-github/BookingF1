// 環境変数を読み込む
require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 曜日配列
const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 日付文字列に曜日を付与
 * 例: 2026/05/11 → 2026/05/11(月)
 */
function formatDateWithDay(dateStr) {
  const date = new Date(dateStr);

  const day = dayNames[date.getDay()];

  return `${dateStr}(${day})`;
}

/**
 * 入力文字列をパース
 * 例:
 * 2026/05/11 10:00-12:00
 */
function parseRequest(line) {
  const match = line.trim().match(
    /^(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/
  );

  if (!match) return null;

  const [, date, start, end] = match;

  const [y, m, d] = date.split('/');

  const normalizedDate =
    `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;

  return {
    date: normalizedDate,
    checkTime: {
      start,
      end,
    },
    originalLine: line,
  };
}

/**
 * 時刻 → インデックス
 * 06:00開始
 * 10分単位
 */
function timeToIndex(timeStr) {
  const BASE_HOUR = 6;

  const [h, m] = timeStr.split(':').map(Number);

  return (h - BASE_HOUR) * 6 + Math.floor(m / 10);
}

/**
 * インデックス → 時刻
 */
function indexToTime(idx) {
  const BASE_HOUR = 6;

  const totalMin = BASE_HOUR * 60 + idx * 10;

  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * HTML取得
 */
async function fetchHtml(date) {
  try {
    console.log('===== fetchHtml START =====');

    const formattedDate = formatDateWithDay(date);

    console.log('formattedDate:', formattedDate);

    // 初回アクセス
    const firstResponse = await axios.get(
      'https://csweb.u-aizu.ac.jp/campusweb/campussquare.do?_flowId=KHW0001310-flow',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      }
    );

    console.log('GET success');

    fs.writeFileSync(
      path.join(__dirname, 'debug_first_response.html'),
      firstResponse.data
    );

    const cookie =
      firstResponse.headers['set-cookie']?.join('; ') || '';

    console.log('cookie:', cookie);

    // hidden input取得
    const $ = cheerio.load(firstResponse.data);

    const execution = $('input[name="execution"]').val();
    const flowKey = $('input[name="_flowExecutionKey"]').val();

    console.log('execution:', execution);
    console.log('_flowExecutionKey:', flowKey);

    // POST
    const params = new URLSearchParams();

    params.append('displayDateStr', formattedDate);

    if (execution) {
      params.append('execution', execution);
    }

    if (flowKey) {
      params.append('_flowExecutionKey', flowKey);
    }

    params.append('_eventId', 'search');

    console.log('POST params:', params.toString());

    const response = await axios.post(
      'https://csweb.u-aizu.ac.jp/campusweb/campussquare.do?_flowId=KHW0001310-flow',
      params,
      {
        headers: {
          Cookie: cookie,
          'Content-Type':
            'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          Referer:
            'https://csweb.u-aizu.ac.jp/campusweb/campussquare.do?_flowId=KHW0001310-flow',
        },
        timeout: 10000,
        maxRedirects: 5,
      }
    );

    console.log('POST success');

    fs.writeFileSync(
      path.join(__dirname, 'debug_post_response.html'),
      response.data
    );

    if (response.data.includes('F1会議室')) {
      console.log('F1会議室 FOUND');
    } else {
      console.log('F1会議室 NOT FOUND');
    }

    console.log('===== fetchHtml END =====');

    return response.data;

  } catch (err) {
    console.error('===== fetchHtml ERROR =====');

    console.error(err.message);

    if (err.response?.data) {
      fs.writeFileSync(
        path.join(__dirname, 'debug_error_response.html'),
        err.response.data
      );
    }

    throw err;
  }
}

/**
 * HTML解析
 */
function analyzeAvailability(html, checkTime) {
  const $ = cheerio.load(html);

  const DISPLAY_START = timeToIndex('09:00');

  const startIdx = timeToIndex(checkTime.start);
  const endIdx = timeToIndex(checkTime.end);

  const rows = $('tr').toArray();

  // F1会議室行を探す
  const targetRow = rows.find(row =>
    $(row).text().includes('F1会議室')
  );

  if (!targetRow) {
    return {
      error: 'F1会議室の行が見つかりません',
    };
  }

  console.log('===== TARGET ROW =====');
  console.log($.html(targetRow));

  // 占有状況生成
  const occupied = [];

  $(targetRow)
    .find('td')
    .each((_, cell) => {
      const $cell = $(cell);

      // 会議室名セル除外
      if ($cell.hasClass('kyuko-shi-shisetsunm')) {
        return;
      }

      const colspan = parseInt(
        $cell.attr('colspan') || '1'
      );

      const isOccupied =
        $cell.hasClass('kyuko-shi-jugyo');

      for (let i = 0; i < colspan; i++) {
        occupied.push(isOccupied);
      }
    });

  console.log('occupied length:', occupied.length);

  console.log(
    occupied.map(v => (v ? '■' : '□')).join('')
  );

  // 指定時間帯が埋まってるか
  const isOccupied = occupied
    .slice(startIdx, endIdx)
    .some(v => v);

  // 空いてる
  if (!isOccupied) {
    return {
      status: 'Open',
    };
  }

  // 空き時間列挙
  const freeSlots = [];

  let freeStart = null;

  for (let i = 0; i <= occupied.length; i++) {
    if (
      i < occupied.length &&
      !occupied[i] &&
      freeStart === null
    ) {
      freeStart = i;
    } else if (
      (i === occupied.length || occupied[i]) &&
      freeStart !== null
    ) {
      freeSlots.push(
        `${indexToTime(freeStart)}~${indexToTime(i)}`
      );

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
      message: `${checkTime.start}〜21:00 は空きがありません`,
    };
  }

  return {
    status: 'Occupied',
    allOccupied: false,
    freeSlots: filteredSlots,
  };
}

/**
 * 複数チェック
 */
async function checkAvailabilityList(
  requests,
  onResult
) {
  for (const {
    date,
    checkTime,
    originalLine,
  } of requests) {
    try {
      const html = await fetchHtml(date);

      const result = analyzeAvailability(
        html,
        checkTime
      );

      await onResult(
        originalLine,
        date,
        checkTime,
        result
      );

    } catch (err) {
      await onResult(
        originalLine,
        date,
        checkTime,
        {
          error: err.message,
        }
      );
    }
  }
}

// export
module.exports = {
  parseRequest,
  checkAvailabilityList,
};