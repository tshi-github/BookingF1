// 環境変数を読み込む（.envファイル）
        ) {
          occupied[i] = true;
        }
      }

      colIndex += colspan;
    });

  const isOccupied = occupied
    .slice(startIdx, endIdx)
    .some(v => v);

  if (!isOccupied) {
    return {
      status: 'Open',
    };
  }

  const freeSlots = [];

  let freeStart = null;

  for (let i = 0; i <= TOTAL_SLOTS; i++) {
    if (i < TOTAL_SLOTS && !occupied[i] && freeStart === null) {
      freeStart = i;
    } else if ((i === TOTAL_SLOTS || occupied[i]) && freeStart !== null) {
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
 * 複数リクエストの空き状況をチェック
 */
async function checkAvailabilityList(requests, onResult) {
  for (const { date, checkTime, originalLine } of requests) {
    try {
      const html = await fetchHtml(date);

      const result = analyzeAvailability(html, checkTime);

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
        { error: err.message }
      );
    }
  }
}

// 外部から使えるようにエクスポート
module.exports = {
  parseRequest,
  checkAvailabilityList,
};