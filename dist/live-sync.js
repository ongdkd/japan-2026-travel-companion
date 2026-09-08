(function () {
  'use strict';

  const CLIENT_ID = '474116203549-pkde074ah3jn44favpipl6tu9g05tspv.apps.googleusercontent.com';
  const SPREADSHEET_ID = '10Zxakb-YtuX3SJqmPNMzMNPUIvprJuriqj9NZyAYKLM';
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const CACHE_KEY = 'japan2026.sheetData.v1';
  const TOKEN_KEY = 'japan2026.googleToken.write.v2';
  const ITINERARY_SHEET = '02_Daily Itinerary';
  const QUICK_LINK_SHEETS = {
    food: { title: '08_Food', id: 'Food_ID', prefix: 'FOOD' },
    videos: { title: '09_Video & Social Links', id: 'Video_ID', prefix: 'VIDEO' }
  };
  const SHEETS = [
    ['itinerary', '02_Daily Itinerary'],
    ['hotels', '03_Hotels'],
    ['flights', '04_Flights'],
    ['transport', '05_Transport'],
    ['luggage', '06_Luggage'],
    ['places', '07_Places'],
    ['food', '08_Food'],
    ['videos', '09_Video & Social Links'],
    ['bookings', '10_Bookings & Tickets'],
    ['budget', '11_Budget'],
    ['documents', '12_Documents'],
    ['contacts', '13_Contacts'],
    ['tasks', '14_Open Tasks'],
    ['weather', '15_Weather'],
    ['wishlist', '16_Shopping & Wishlist'],
    ['emergency', '17_Emergency']
  ];

  function rowsToObjects(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = values[0];
    return values.slice(1)
      .filter((row) => row.some((value) => value !== null && value !== undefined && value !== ''))
      .map((row) => {
        const record = {};
        headers.forEach((header, index) => {
          if (header && row[index] !== undefined && row[index] !== null && row[index] !== '') {
            record[header] = row[index];
          }
        });
        return record;
      });
  }

  function mask(value) {
    if (!value) return undefined;
    const text = String(value);
    return '•••• ' + text.slice(-4);
  }

  function sanitize(data) {
    (data.hotels || []).forEach((item) => {
      item.Booking_No_Masked = mask(item.Booking_No);
      delete item.Booking_No;
    });
    (data.flights || []).forEach((item) => {
      item.Booking_Ref_Masked = mask(item.Booking_Ref);
      delete item.Booking_Ref;
    });
    (data.bookings || []).forEach((item) => {
      item.Booking_Ref_Masked = mask(item.Booking_Ref);
      delete item.Booking_Ref;
    });
    Object.values(data).filter(Array.isArray).flat().forEach((item) => {
      if (item.Notes) {
        item.Notes = String(item.Notes)
          .replace(/Booking ref\s+([A-Z0-9-]+)/gi, (_, ref) => 'Booking ref •••• ' + ref.slice(-4))
          .replace(/\b\d{12,}\b/g, (number) => '•••• ' + number.slice(-4));
      }
    });
    return data;
  }

  function mergeData(next) {
    const target = window.TRIP_DATA || (window.TRIP_DATA = {});
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, next);
  }

  function restoreCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached?.source?.spreadsheetId === SPREADSHEET_ID) mergeData(cached);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }

  function savedToken() {
    try {
      const token = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
      return token?.access_token && token.expires_at > Date.now() + 60000 ? token : null;
    } catch {
      return null;
    }
  }

  function waitForGoogle(timeout = 12000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error('โหลด Google Sign-In ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต'));
        }
      }, 100);
    });
  }

  async function requestToken() {
    const current = savedToken();
    if (current) return current.access_token;
    await waitForGoogle();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description || response.error || 'ไม่ได้รับอนุญาตจาก Google'));
            return;
          }
          try {
            sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
              access_token: response.access_token,
              expires_at: Date.now() + Number(response.expires_in || 3600) * 1000
            }));
          } catch {
            // Continue with the in-memory token when browser storage is unavailable.
          }
          resolve(response.access_token);
        },
        error_callback: () => reject(new Error('หน้าต่าง Google Sign-In ถูกปิดหรือถูกบล็อก'))
      });
      client.requestAccessToken({ prompt: 'consent' });
    });
  }

  async function fetchSheetData(accessToken) {
    const params = new URLSearchParams();
    SHEETS.forEach(([, title]) => params.append('ranges', "'" + title.replace(/'/g, "''") + "'!A1:Y200"));
    params.set('majorDimension', 'ROWS');
    params.set('valueRenderOption', 'FORMATTED_VALUE');
    const response = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID + '/values:batchGet?' + params,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error?.message || 'Google Sheets ตอบกลับด้วยรหัส ' + response.status);
    }
    const payload = await response.json();
    const next = {
      source: {
        title: 'Japan 2026 Travel Database v1',
        spreadsheetId: SPREADSHEET_ID,
        url: 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit',
        syncedAt: new Date().toISOString(),
        mode: 'live_google_sheets'
      },
      trip: {
        id: 'TRIP001',
        name: 'Japan 2026 | Osaka – Kyoto – Nara – Tokyo',
        startDate: '2026-10-09',
        endDate: '2026-10-18',
        travelers: 2,
        jpyToThb: 0.23
      }
    };
    SHEETS.forEach(([key], index) => {
      next[key] = rowsToObjects(payload.valueRanges?.[index]?.values || []);
    });
    return sanitize(next);
  }

  async function sheetsRequest(path, options = {}) {
    const token = await requestToken();
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error?.message || 'บันทึก Google Sheets ไม่สำเร็จ (' + response.status + ')');
    }
    return response.status === 204 ? null : response.json().catch(() => null);
  }

  async function sheetGrid(title) {
    const token = await requestToken();
    const range = encodeURIComponent("'" + title + "'!A1:Y");
    const response = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID + '/values/' + range + '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    if (!response.ok) throw new Error('อ่านแผนการเดินทางเพื่อบันทึกไม่สำเร็จ');
    const payload = await response.json();
    return { headers: payload.values?.[0] || [], rows: payload.values?.slice(1) || [] };
  }

  // Sheets' :append picks its own target by "detecting a table", and that detection is what walked
  // new quick-add rows sideways into columns I:AH. Writing to an explicit A<row>:<lastCol><row>
  // range removes the guessing — it is the same PUT the itinerary edit path already used.
  function columnLetter(count) {
    let letter = '';
    for (let n = count; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
    return letter;
  }

  function rowRange(title, rowNumber, width) {
    return encodeURIComponent("'" + title + "'!A" + rowNumber + ':' + columnLetter(width) + rowNumber);
  }

  async function writeRow(title, rowNumber, values) {
    // ponytail: values.update writes into the existing grid, it does not grow it — fine while the
    // tabs keep Sheets' default 1000 rows; add an appendDimension batchUpdate if a tab is ever
    // trimmed down to exactly its data.
    await sheetsRequest('/values/' + rowRange(title, rowNumber, values.length) + '?valueInputOption=USER_ENTERED', {
      method: 'PUT', body: JSON.stringify({ majorDimension: 'ROWS', values: [values] })
    });
  }

  // Deletes clear a row's cells rather than removing the row, so reuse the first blanked-out row
  // before growing the sheet.
  function nextRowNumber(rows) {
    const blank = rows.findIndex((row) => !row.some((cell) => String(cell ?? '').trim()));
    return (blank < 0 ? rows.length : blank) + 2;
  }

  const itineraryGrid = () => sheetGrid(ITINERARY_SHEET);

  function dateForSheet(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    return year && month && day ? month + '/' + day + '/' + year : value;
  }

  function thaiDay(value) {
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const date = new Date(String(value || '') + 'T12:00:00+09:00');
    return Number.isNaN(date.getTime()) ? '' : days[date.getDay()];
  }

  function periodFor(time) {
    const hour = Number(String(time || '').split(':')[0]);
    if (!Number.isFinite(hour)) return '';
    if (hour < 6) return 'เช้ามืด';
    if (hour < 12) return 'เช้า';
    if (hour < 17) return 'บ่าย';
    return 'เย็น';
  }

  function isoInJapan(date, time) {
    return date && time ? date + 'T' + time + ':00+09:00' : '';
  }

  function nextItineraryId(rows) {
    const maximum = rows.reduce((max, row) => {
      const match = String(row[0] || '').match(/^ITI(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return 'ITI' + String(maximum + 1).padStart(3, '0');
  }

  async function saveItinerary(record) {
    const grid = await itineraryGrid();
    if (!grid.headers.length) throw new Error('ไม่พบหัวตารางแผนการเดินทาง');
    const existingIndex = grid.rows.findIndex((row) => row[0] === record.Itinerary_ID);
    const id = record.Itinerary_ID || nextItineraryId(grid.rows);
    const current = existingIndex >= 0 ? rowsToObjects([grid.headers, grid.rows[existingIndex]])[0] : {};
    const merged = {
      ...current,
      ...record,
      Itinerary_ID: id,
      Trip_ID: current.Trip_ID || 'TRIP001',
      Date: dateForSheet(record.Date),
      Day: thaiDay(record.Date),
      Period: periodFor(record.Start_Time),
      Start_DateTime_ISO: isoInJapan(record.Date, record.Start_Time),
      End_DateTime_ISO: isoInJapan(record.Date, record.End_Time)
    };
    const values = grid.headers.map((header) => merged[header] ?? '');
    await writeRow(ITINERARY_SHEET, existingIndex >= 0 ? existingIndex + 2 : nextRowNumber(grid.rows), values);
    return id;
  }

  async function deleteItinerary(id) {
    const grid = await itineraryGrid();
    const index = grid.rows.findIndex((row) => row[0] === id);
    if (index < 0) throw new Error('ไม่พบรายการที่ต้องการลบ');
    const range = rowRange(ITINERARY_SHEET, index + 2, grid.headers.length);
    await sheetsRequest('/values/' + range + ':clear', { method: 'POST', body: '{}' });
  }

  // Two quick-adds fired close together (tap "add", then add another before the first finishes)
  // each independently read the sheet, saw the same last-used id, and appended with the SAME next
  // id — this is exactly how three unrelated saved videos all ended up as "VIDEO023" at once. The
  // sheet read can't be made atomic from here, but everything in one browser tab runs on a single
  // JS thread, so remembering the highest id handed out THIS SESSION and never handing out anything
  // lower closes that race for the common case (fast repeated taps in the same tab/session).
  const reservedRecordIds = {};

  function nextRecordId(rows, idIndex, prefix) {
    const sheetMax = rows.reduce((max, row) => {
      const match = String(row[idIndex] || '').match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const next = Math.max(sheetMax, reservedRecordIds[prefix] || 0) + 1;
    reservedRecordIds[prefix] = next;
    return prefix + String(next).padStart(3, '0');
  }

  async function saveQuickLink(kind, detected) {
    const config = QUICK_LINK_SHEETS[kind];
    if (!config) throw new Error('รองรับเฉพาะลิงก์อาหารและวิดีโอ');
    const grid = await sheetGrid(config.title);
    if (!grid.headers.length) throw new Error('ไม่พบหัวตาราง ' + config.title);
    const idIndex = grid.headers.indexOf(config.id);
    if (idIndex < 0) throw new Error('ไม่พบคอลัมน์ ' + config.id);
    const id = nextRecordId(grid.rows, idIndex, config.prefix);
    const aliases = {
      Food_ID: id, Video_ID: id,
      Place_Name: detected.name, Place: detected.name, Name: detected.name, Title: detected.name,
      Video_Name: detected.name, Video_Title: detected.name,
      Thumbnail_URL: detected.thumbnailUrl, Thumbnail: detected.thumbnailUrl,
      Platform: detected.platform, Link: detected.url, URL: detected.url,
      Category: detected.category, Area: detected.area, City: detected.city,
      Address: detected.address, Latitude: detected.latitude, Longitude: detected.longitude,
      Google_Maps_URL: kind === 'food' ? detected.url : detected.googleMapsUrl,
      Related_Place_ID: detected.relatedPlaceId,
      Note: detected.note, Notes: detected.note,
      Priority: detected.priority || 'Saved', Status: detected.status || 'Saved',
      Added_At: new Date().toISOString(), Created_At: new Date().toISOString()
    };
    // The exact header names above are a guess at what the real sheet calls each column — when a
    // header doesn't match any of them exactly, guess from what the header text looks like instead
    // of silently leaving that column blank (this is what was happening for name/link columns whose
    // real header text didn't match any alias, e.g. a saved video showing up with no title or link).
    function fuzzyValueFor(header) {
      const key = String(header || '').toLowerCase();
      if (/map/.test(key)) return kind === 'food' ? detected.url : (detected.googleMapsUrl || '');
      if (/link|url|เว็บ|ลิงก์/.test(key)) return detected.url;
      if (/thumbnail|cover|image|รูป|ภาพ/.test(key)) return detected.thumbnailUrl;
      if (/platform|แพลตฟอร์ม/.test(key)) return detected.platform;
      if (/name|title|place|item|caption|description|ชื่อ/.test(key)) return detected.name;
      if (/category|type|ประเภท/.test(key)) return detected.category;
      if (/area|เขต|ย่าน/.test(key)) return detected.area;
      if (/city|เมือง/.test(key)) return detected.city;
      if (/address|ที่อยู่/.test(key)) return detected.address;
      if (/^lat|latitude/.test(key)) return detected.latitude;
      if (/^lon|^lng|longitude/.test(key)) return detected.longitude;
      if (/related/.test(key)) return detected.relatedPlaceId;
      if (/note|หมายเหตุ/.test(key)) return detected.note;
      if (/priority/.test(key)) return detected.priority || 'Saved';
      if (/status|สถานะ/.test(key)) return detected.status || 'Saved';
      if (/added|created|date|time|เวลา|วันที่/.test(key)) return new Date().toISOString();
      return '';
    }
    const unmatchedHeaders = [];
    const values = grid.headers.map((header) => {
      if (Object.prototype.hasOwnProperty.call(aliases, header)) return aliases[header] ?? '';
      const guessed = fuzzyValueFor(header);
      if (guessed === '') unmatchedHeaders.push(header);
      return guessed;
    });
    if (unmatchedHeaders.length) {
      console.warn('[saveQuickLink] could not confidently fill these columns for ' + config.title + ':', unmatchedHeaders);
    }
    await writeRow(config.title, nextRowNumber(grid.rows), values);
    return id;
  }

  async function deleteQuickLink(kind, id) {
    const config = QUICK_LINK_SHEETS[kind];
    if (!config) throw new Error('รองรับเฉพาะลิงก์อาหารและวิดีโอ');
    const grid = await sheetGrid(config.title);
    const idIndex = grid.headers.indexOf(config.id);
    if (idIndex < 0) throw new Error('ไม่พบคอลัมน์ ' + config.id);
    const index = grid.rows.findIndex((row) => row[idIndex] === id);
    if (index < 0) throw new Error('ไม่พบรายการที่ต้องการลบ');
    const range = rowRange(config.title, index + 2, grid.headers.length);
    await sheetsRequest('/values/' + range + ':clear', { method: 'POST', body: '{}' });
  }

  async function sync() {
    const token = await requestToken();
    const data = await fetchSheetData(token);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // Live data still works for this session when offline storage is unavailable.
    }
    mergeData(data);
    return data;
  }

  restoreCache();
  window.SheetsSync = {
    sync,
    saveItinerary,
    deleteItinerary,
    saveQuickLink,
    deleteQuickLink,
    hasLiveCache: () => window.TRIP_DATA?.source?.mode === 'live_google_sheets',
    hasSessionToken: () => Boolean(savedToken()),
    lastSyncedAt: () => window.TRIP_DATA?.source?.syncedAt || null
  };
})();
