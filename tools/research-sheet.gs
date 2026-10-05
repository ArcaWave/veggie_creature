// Veggie Creature 연구 기록 → 이 구글 시트 (docs/RESEARCH.md "구글 시트").
// 시트의 [확장 프로그램 → Apps Script]에 이 파일 전체를 붙여 넣고, [배포 → 새 배포 → 웹 앱]
// (실행: 나 / 액세스: 모든 사용자)로 배포한 뒤, 웹 앱 URL을 Vercel 환경변수 RESEARCH_SHEET_URL에 넣습니다.
//
// 서버가 세션을 보낼 때마다 participant_id 한 줄을 고치거나 새로 붙입니다(시간은 한국 시간).
// - 원본은 서버(Supabase)에 있습니다. 시트는 사본이라, 서버가 보내는 칸을 시트에서 고치면 다음 전송 때 덮어씁니다.
//   메모·추가 코딩은 콘솔에 쓰거나, 시트 오른쪽에 새 열을 만들어 쓰세요(서버가 모르는 열은 그대로 둡니다).
// - 조건 열(condition, animation_pair, animation_id, block…)은 처음에 숨겨 둡니다(맹검). 열 머리를 우클릭해 보이게 할 수 있어요.

const SHEET_NAME = "sessions";
const BLIND = ["condition", "animation_pair", "animation_id", "block", "block_pos", "block_size"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const msg = JSON.parse(e.postData.contents);
    const n = upsert(msg.columns, msg.rows);
    return json({ ok: true, n: n });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  } finally {
    lock.releaseLock();
  }
}

function upsert(cols, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  // header: the server's columns, in its order; new ones go on the right
  let head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  const missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    const first = head.length + 1;
    if (sh.getMaxColumns() < head.length + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length + missing.length - sh.getMaxColumns());
    sh.getRange(1, first, 1, missing.length).setValues([missing]).setFontWeight("bold");
    head = head.concat(missing);
    sh.setFrozenRows(1);
    missing.forEach(function (c, i) {
      const col = first + i;
      if (/_time$|^participant_id$/.test(c)) sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat("@");
      if (BLIND.indexOf(c) >= 0) sh.hideColumns(col);
    });
    sh.getRange(1, 1, 1, head.length).setNumberFormat("@");
  }
  const idCol = head.indexOf("participant_id"), verCol = head.indexOf("row_version");
  const W = head.length;

  const count = sh.getLastRow() - 1;
  const data = count > 0 ? sh.getRange(2, 1, count, W).getValues() : [];
  const at = {};
  data.forEach(function (r, i) { at[String(r[idCol])] = i; });

  const changed = [];
  rows.forEach(function (row) {
    const id = String(row[cols.indexOf("participant_id")]);
    const ver = Number(row[cols.indexOf("row_version")]) || 0;
    let i = at[id];
    if (i === undefined) { i = data.length; at[id] = i; data.push(head.map(function () { return ""; })); }
    else if ((Number(data[i][verCol]) || 0) > ver) return; // (the sheet already has a newer copy)
    cols.forEach(function (c, k) { const v = row[k]; data[i][head.indexOf(c)] = v === null || v === undefined ? "" : v; });
    changed.push(i);
  });
  if (!changed.length) return 0;
  const need = data.length + 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), Math.max(need, 200));

  // a few rows: write those rows; many (a full re-send): write the block once
  if (changed.length > 20) sh.getRange(2, 1, data.length, W).setValues(data);
  else changed.forEach(function (i) { sh.getRange(i + 2, 1, 1, W).setValues([data[i]]); });
  return changed.length;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// (편집기에서 한 번 실행해 권한을 허락하는 용도: 시트에 test 줄을 만들지 않고 연결만 확인합니다)
function checkSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("OK: " + ss.getName());
}
