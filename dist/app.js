const DATA = window.TRIP_DATA || {};
const state = {
  view: 'today',
  planDate: DATA.trip?.startDate || '2026-10-09',
  bookingFilter: 'all',
  mapFilter: 'all',
  mapSearch: '',
  selectedPlace: null,
  map: null,
  markers: [],
  userMarker: null,
  userLocation: null,
  mapLocateAttempted: false,
  mapSheetExpanded: true,
  installPrompt: null
};

const views = [...document.querySelectorAll('.view')];
const navButtons = [...document.querySelectorAll('.bottom-nav [data-tab]')];
const detailView = document.querySelector('#detail-view');
const detailContent = document.querySelector('#detail-content');
const toast = document.querySelector('.toast');
const planEditor = document.querySelector('#plan-editor');
const planEditorForm = document.querySelector('#plan-editor-form');
const quickLinkEditor = document.querySelector('#quick-link-editor');
const quickLinkForm = document.querySelector('#quick-link-form');
let toastTimer;

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const safeUrl = (value = '') => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
};

const number = (value) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseSheetDate = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  const bits = String(value).split('/').map(Number);
  if (bits.length !== 3) return null;
  const [month, day, year] = bits;
  return new Date(Date.UTC(year, month - 1, day));
};

const isoDate = (date) => date ? date.toISOString().slice(0, 10) : '';
const japanNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
const japanToday = () => {
  const now = japanNow();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};
const formatDate = (date, options = {}) => date
  ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Tokyo', ...options }).format(date)
  : 'ยังไม่ระบุ';
const money = (value, unit = 'THB') => {
  const amount = number(value);
  if (!amount && value !== 0 && value !== '0') return 'ยังไม่ระบุ';
  return unit === 'JPY'
    ? '¥' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '฿' + amount.toLocaleString('th-TH', { maximumFractionDigits: 2 });
};
const statusClass = (status = '') => {
  const text = String(status).toLowerCase();
  if (/(need|not booked|to do|high|overdue)/.test(text)) return 'warning';
  if (/(paid|confirmed|booked|done|completed)/.test(text)) return 'confirmed';
  return '';
};
const statusThai = (status = '') => ({
  Paid: 'ชำระแล้ว', Confirmed: 'ยืนยันแล้ว', 'Not booked': 'ยังไม่จอง',
  'Needs booking': 'ต้องจอง', 'Needs confirmation': 'ต้องยืนยัน',
  Suggested: 'แนะนำ', Planned: 'วางแผนแล้ว', Optional: 'ตัวเลือก',
  'Must do': 'ต้องทำ', 'To do': 'ต้องทำ', Preferred: 'แนะนำ',
  Alternative: 'ตัวเลือก', 'Estimate needed': 'รอตั้งงบ'
}[status] || status || 'ยังไม่ระบุ');
const iconFor = (value = '') => {
  const text = String(value).toLowerCase();
  if (/hotel|ที่พัก/.test(text)) return '🏨';
  if (/flight|airport|เที่ยวบิน/.test(text)) return '✈️';
  if (/bus|transport|รถ|rail|metro|เดินทาง/.test(text)) return '🚆';
  if (/luggage|กระเป๋|สัมภาระ/.test(text)) return '🧳';
  if (/food|อาหาร|cafe|restaurant/.test(text)) return '🍜';
  if (/shopping|wishlist|shop/.test(text)) return '🛍';
  if (/video|youtube|tiktok|instagram/.test(text)) return '▶';
  if (/pass|ticket|activity|theme|usj/.test(text)) return '🎟️';
  if (/document|passport|เอกสาร/.test(text)) return '▣';
  return '📍';
};

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function syncLabel() {
  if (DATA.source?.mode !== 'live_google_sheets') return 'ยังไม่ได้ Sync แบบสด';
  const date = new Date(DATA.source.syncedAt);
  return Number.isNaN(date.getTime()) ? 'Google Sheets ล่าสุด' : 'ล่าสุด ' +
    new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    }).format(date);
}

function itineraryFor(dateValue) {
  const key = typeof dateValue === 'string' ? dateValue.slice(0, 10) : isoDate(dateValue);
  return (DATA.itinerary || []).filter((item) =>
    item.Start_DateTime_ISO?.slice(0, 10) === key || isoDate(parseSheetDate(item.Date)) === key
  );
}

function dueTasks() {
  return (DATA.tasks || []).filter((task) => !/done|completed/i.test(task.Status || ''))
    .sort((a, b) => (parseSheetDate(a.Due_Date) || new Date('2999-01-01')) - (parseSheetDate(b.Due_Date) || new Date('2999-01-01')));
}

function activeHotel(date) {
  const time = date.getTime();
  return (DATA.hotels || []).find((hotel) => {
    const start = parseSheetDate(hotel.Check_in_Date);
    const end = parseSheetDate(hotel.Check_out_Date);
    return start && end && time >= start.getTime() && time < end.getTime();
  }) || (DATA.hotels || [])[date < parseSheetDate(DATA.trip?.startDate) ? 0 : 1] || {};
}

function currentOrNextItem(items) {
  if (!items.length) return null;
  const now = japanNow();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return items.find((item) => {
    const match = String(item.End_Time || item.Start_Time || '').match(/(\d{1,2}):(\d{2})/);
    return match && Number(match[1]) * 60 + Number(match[2]) >= minutes;
  }) || items[items.length - 1];
}

function renderToday() {
  const view = document.querySelector('#today-view');
  const today = japanToday();
  const start = parseSheetDate(DATA.trip?.startDate);
  const end = parseSheetDate(DATA.trip?.endDate);
  const before = start && today < start;
  const after = end && today > end;
  const items = before || after ? [] : itineraryFor(today);
  const next = before
    ? (DATA.flights || []).find((flight) => flight.Direction === 'Outbound')
    : currentOrNextItem(items);
  const hotel = activeHotel(today);
  const tasks = dueTasks();
  const days = start ? Math.max(0, Math.ceil((start - today) / 86400000)) : 0;
  const weather = (DATA.weather || []).find((row) => isoDate(parseSheetDate(row.Date)) === isoDate(before ? start : today)) || {};
  const weatherReady = weather.Temperature_Max || weather.Temp_Max || weather.Max_C;
  const nextTime = before ? next?.Departure_Time : (next?.Start_Time || next?.Period);
  const nextTitle = before
    ? `${next?.Origin_Airport || 'DMK'} → ${next?.Destination_Airport || 'KIX'}`
    : next?.Activity;
  const nextMeta = before
    ? `${formatDate(parseSheetDate(next?.Date), { weekday: 'short', day: 'numeric', month: 'short' })} · Terminal ${next?.Origin_Terminal || 'รอยืนยัน'}`
    : next?.Place_Name;
  view.innerHTML = `
    <header class="topbar">
      <div><p class="eyebrow">${before ? `อีก ${days} วัน · OSAKA` : after ? 'TRIP COMPLETE' : `วันนี้ · ${items[0]?.City || 'JAPAN'}`}</p><h1 id="today-title">Japan <span>2026</span></h1></div>
      <button class="weather-pill" data-resource="weather" aria-label="ดูพยากรณ์อากาศ"><span>${weatherReady ? '☀' : '◌'}</span> ${weatherReady ? weatherReady + '°' : 'พยากรณ์'}</button>
    </header>
    <div class="date-row">
      <div><strong>${before ? 'เตรียมตัวก่อนเดินทาง' : formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span>เวลาท้องถิ่นญี่ปุ่น</span></div>
      <button class="icon-button" data-tab="plan" aria-label="เปิดปฏิทิน">⌄</button>
    </div>
    <article class="next-card">
      <div class="next-card__top"><span class="live-dot"></span><span>${before ? 'เริ่มทริป' : 'รายการถัดไป'}</span><span class="time-left">${before ? formatDate(start, { day: 'numeric', month: 'short' }) : 'เวลาญี่ปุ่น'}</span></div>
      <div class="next-card__body">
        <div><p class="big-time">${esc(nextTime || '—')}</p><p class="muted-light">${before ? 'เวลาออกเดินทาง' : 'เวลาเริ่ม'}</p></div>
        <div class="route-line"><span class="route-icon">${iconFor(nextTitle)}</span><div><h2>${esc(nextTitle || (after ? 'เดินทางเรียบร้อยแล้ว' : 'ไม่มีรายการต่อไป'))}</h2><p>${esc(nextMeta || '')}</p></div></div>
      </div>
      <button class="light-button" data-tab="plan">ดูแผนทั้งหมด <span>→</span></button>
    </article>
    <div class="section-heading"><h2>ภาพรวม</h2><span>ข้อมูลจริงจากชีต</span></div>
    <div class="split-cards">
      <article class="mini-card">
        <div class="mini-card__head"><span class="emoji-chip">🏨</span><span class="status ${statusClass(hotel.Status)}">${statusThai(hotel.Status)}</span></div>
        <p class="card-label">${esc(hotel.City || 'HOTEL')} · ${esc(hotel.Check_in_Time || '')}</p>
        <h3>${esc(hotel.Hotel_Name || 'ยังไม่มีโรงแรม')}</h3>
        <p class="card-meta">${money(hotel.Price_THB)} · ${hotel.Self_Check_in ? 'Self check-in' : 'Check-in'}</p>
        <div class="button-row"><button data-url="${safeUrl(hotel.Google_Maps_URL)}">แผนที่</button><button data-resource="hotels">รายละเอียด</button></div>
      </article>
      ${discoveryMiniCard()}
    </div>
    <div class="section-heading"><h2>${before ? 'ต้องทำก่อนเดินทาง' : 'แผนวันนี้'}</h2><button class="text-button" data-tab="plan">ดูทั้งหมด</button></div>
    <article class="timeline-card">
      ${(before ? tasks.slice(0, 5) : items).map((item, index) => `
        <div class="timeline-item ${index === 0 ? 'current' : ''}">
          <time>${esc(item.Start_Time || (item.Due_Date ? formatDate(parseSheetDate(item.Due_Date), { day: 'numeric', month: 'short' }) : '—'))}</time>
          <span class="timeline-dot"></span>
          <div><strong>${esc(item.Activity || item.Task)}</strong><p>${esc(item.Place_Name || item.Category || '')}</p></div>
          ${safeUrl(item.Link) !== '#' ? `<button data-url="${safeUrl(item.Link)}" aria-label="เปิดข้อมูล">↗</button>` : ''}
        </div>`).join('') || '<div class="empty-state">ยังไม่มีรายการสำหรับวันนี้</div>'}
    </article>
    <figure class="photo-card">
      <img src="https://www.koba.photo/data/wp-content/uploads/moved/blog_import_54f5b70009ac1.jpg" alt="อาคารอิฐแดงของสถานีโตเกียวในยามเช้า" />
      <figcaption><span>Tokyo morning</span><a href="https://www.koba.photo/blog/184.php" target="_blank" rel="noreferrer">Photo source ↗</a></figcaption>
    </figure>
    <div class="sync-note ${DATA.source?.mode === 'live_google_sheets' ? 'is-live' : ''}"><span>${DATA.source?.mode === 'live_google_sheets' ? '✓' : '↻'}</span><div><strong>${DATA.source?.mode === 'live_google_sheets' ? 'เชื่อมต่อ Google Sheets แล้ว' : 'เชื่อม Google Sheets เพื่อรับข้อมูลล่าสุด'}</strong><p>${esc(syncLabel())} · มีสำเนาออฟไลน์</p></div><button data-sync-sheet>${DATA.source?.mode === 'live_google_sheets' ? 'Sync' : 'เชื่อม'}</button></div>
  `;
}

function renderPlan() {
  const view = document.querySelector('#plan-view');
  const start = parseSheetDate(DATA.trip?.startDate) || new Date(Date.UTC(2026, 9, 9));
  const dates = Array.from({ length: 10 }, (_, index) => new Date(start.getTime() + index * 86400000));
  const items = itineraryFor(state.planDate);
  const estimated = items.reduce((sum, item) => sum + number(item.Budget_JPY), 0);
  view.innerHTML = `
    <header class="simple-header"><div><p class="eyebrow">9–18 OCTOBER 2026</p><h1 id="plan-title">แผนการเดินทาง</h1></div><button class="round-add" data-add-plan aria-label="เพิ่มกิจกรรม">＋</button></header>
    <div class="date-strip" role="tablist" aria-label="เลือกวันที่">
      ${dates.map((date) => `<button class="${isoDate(date) === state.planDate ? 'selected' : ''}" data-plan-date="${isoDate(date)}"><span>${formatDate(date, { weekday: 'short' })}</span><b>${date.getUTCDate()}</b></button>`).join('')}
    </div>
    <div class="summary-band"><div><span>📍</span><p><strong>${esc(items[0]?.City || 'Japan')}</strong><small>${items.length} กิจกรรม</small></p></div><div><span>งบในรายการ</span><strong>${estimated ? money(estimated, 'JPY') : 'ยังไม่ระบุ'}</strong></div></div>
    <div class="plan-list">
      ${items.length ? items.map((item) => `
        <article class="plan-item">
          <time>${esc(item.Start_Time || item.Period || '—')}</time><div class="plan-marker">${iconFor(item.Activity)}</div>
          <div class="plan-content">
            <div class="plan-title-row"><h3>${esc(item.Activity)}</h3><span class="status ${statusClass(item.Status)}">${statusThai(item.Status)}</span></div>
            <p>${esc(item.Place_Name || item.City || '')}</p>
            <div class="tag-row">${item.End_Time ? `<span>ถึง ${esc(item.End_Time)}</span>` : ''}${item.Budget_JPY ? `<span>${money(item.Budget_JPY, 'JPY')}</span>` : ''}${item.Transport_ID ? '<span>มีข้อมูลการเดินทาง</span>' : ''}</div>
            ${item.Notes ? `<details><summary>หมายเหตุ</summary><p>${esc(item.Notes)}</p></details>` : ''}
            <div class="action-row">${safeUrl(item.Link) !== '#' ? `<button data-url="${safeUrl(item.Link)}">ข้อมูลเพิ่มเติม ↗</button>` : ''}${item.Place_ID ? `<button data-place-id="${esc(item.Place_ID)}">ดูบนแผนที่</button>` : ''}<button data-edit-plan="${esc(item.Itinerary_ID)}">แก้ไข</button><button class="danger-action" data-delete-plan="${esc(item.Itinerary_ID)}">ลบ</button></div>
          </div>
        </article>`).join('') : '<div class="empty-panel"><strong>ยังไม่มีแผนวันนี้</strong><p>เพิ่มกิจกรรมได้จากหน้านี้และบันทึกลง Google Sheets</p><button data-add-plan>＋ เพิ่มกิจกรรม</button></div>'}
    </div>
  `;
}

const FALLBACK_COORDS = {
  PLACE001:[34.6873,135.5262],PLACE002:[34.6545,135.4289],PLACE003:[34.9949,135.7850],
  PLACE004:[34.9980,135.7807],PLACE005:[35.0037,135.7786],PLACE006:[35.0030,135.7754],
  PLACE007:[34.6850,135.8430],PLACE008:[34.6890,135.8398],PLACE009:[34.6814,135.8484],
  PLACE010:[34.6811,135.8277],PLACE011:[34.6654,135.4323],PLACE012:[35.6812,139.7671],
  PLACE013:[35.6810,139.7630],PLACE014:[35.7101,139.8107],PLACE015:[35.7148,139.7967],
  PLACE016:[35.7138,139.7773],PLACE017:[35.7090,139.7747],PLACE018:[35.6984,139.7731],
  PLACE019:[35.6764,139.6993],PLACE020:[35.6702,139.7027],PLACE021:[35.6595,139.7005],
  PLACE022:[35.6938,139.7034],PLACE023:[35.7092,139.6657],PLACE024:[35.7295,139.7109],
  PLACE025:[35.7720,140.3929],PLACE026:[34.6687,135.5013],PLACE029:[34.4347,135.2441],
  HOTEL001:[34.6705,135.5488],HOTEL002:[35.6968,139.8143],LUG001:[35.6808,139.7701],
  LUG002:[35.6788,139.7710]
};

const FOOD_COORDS = {
  FOOD001:[34.6646,135.5016],FOOD002:[34.6712,135.4976],FOOD003:[35.0265,135.7950],
  FOOD004:[34.6858,135.8414],FOOD005:[34.6811,135.8285],FOOD006:[35.7101,139.8107],
  FOOD007:[35.7101,139.8107],FOOD008:[35.7006,139.7709],FOOD009:[35.6952,139.8146],
  FOOD010:[35.7104,139.8140]
};

const AREA_SEARCH = {
  asakusa:{ label:'Asakusa', coords:[35.7148,139.7967], radius:4 }, 'อาซากุสะ':{ label:'Asakusa', coords:[35.7148,139.7967], radius:4 },
  kinshicho:{ label:'Kinshicho', coords:[35.6968,139.8143], radius:3 }, 'คินชิโจ':{ label:'Kinshicho', coords:[35.6968,139.8143], radius:3 },
  skytree:{ label:'Tokyo Skytree', coords:[35.7101,139.8107], radius:3 }, 'สกายทรี':{ label:'Tokyo Skytree', coords:[35.7101,139.8107], radius:3 },
  akihabara:{ label:'Akihabara', coords:[35.6984,139.7731], radius:3 }, 'อากิฮาบาระ':{ label:'Akihabara', coords:[35.6984,139.7731], radius:3 },
  ueno:{ label:'Ueno', coords:[35.7138,139.7773], radius:3 }, 'อุเอโนะ':{ label:'Ueno', coords:[35.7138,139.7773], radius:3 },
  shibuya:{ label:'Shibuya', coords:[35.6595,139.7005], radius:4 }, 'ชิบูยะ':{ label:'Shibuya', coords:[35.6595,139.7005], radius:4 },
  shinjuku:{ label:'Shinjuku', coords:[35.6938,139.7034], radius:4 }, 'ชินจูกุ':{ label:'Shinjuku', coords:[35.6938,139.7034], radius:4 },
  namba:{ label:'Namba', coords:[34.6687,135.5013], radius:4 }, 'นัมบะ':{ label:'Namba', coords:[34.6687,135.5013], radius:4 },
  nara:{ label:'Nara', coords:[34.6850,135.8430], radius:6 }, 'นารา':{ label:'Nara', coords:[34.6850,135.8430], radius:6 },
  kyoto:{ label:'Kyoto', coords:[35.0037,135.7786], radius:7 }, 'เกียวโต':{ label:'Kyoto', coords:[35.0037,135.7786], radius:7 }
};

function distanceKm(from, to) {
  if (!from || !to) return Number.POSITIVE_INFINITY;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(to[0] - from[0]);
  const dLng = rad(to[1] - from[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from[0])) * Math.cos(rad(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceLabel(value) {
  if (!Number.isFinite(value)) return '';
  return value < 1 ? Math.max(10, Math.round(value * 1000 / 10) * 10) + ' ม.' : value.toFixed(value < 10 ? 1 : 0) + ' กม.';
}

function allPlaces() {
  const normalize = (item, type, idKey, nameKey) => {
    const id = item[idKey];
    const fallback = FALLBACK_COORDS[id] || FOOD_COORDS[id] || FALLBACK_COORDS[item.Related_Place_ID];
    const latitude = number(item.Latitude) || fallback?.[0];
    const longitude = number(item.Longitude) || fallback?.[1];
    return { ...item, _id: id, _type: type, _name: item[nameKey], _lat: latitude, _lng: longitude };
  };
  return [
    ...(DATA.places || []).map((item) => normalize(item, item.Category || 'Place', 'Place_ID', 'Place_Name')),
    ...(DATA.hotels || []).map((item) => normalize(item, 'Hotel', 'Hotel_ID', 'Hotel_Name')),
    ...(DATA.luggage || []).map((item) => normalize(item, 'Luggage', 'Luggage_ID', 'Place_Name')),
    ...(DATA.food || []).map((item) => normalize(item, 'Food', 'Food_ID', 'Place_Name'))
  ].filter((item) => item._lat && item._lng);
}

function mapCategory(item) {
  const value = (item._type || '').toLowerCase();
  if (value.includes('hotel')) return 'hotel';
  if (value.includes('luggage')) return 'luggage';
  if (value.includes('food')) return 'food';
  if (value.includes('shopping')) return 'shopping';
  return 'sightseeing';
}

function renderMap() {
  const view = document.querySelector('#map-view');
  const places = allPlaces();
  view.innerHTML = `
    <div id="real-map" aria-label="แผนที่สถานที่ที่บันทึกไว้"></div>
    <section class="map-results-panel ${state.mapSheetExpanded ? 'expanded' : 'collapsed'}" id="map-results-panel" aria-label="รายการสถานที่บนแผนที่">
      <button class="drag-handle" type="button" aria-label="${state.mapSheetExpanded ? 'ลากลงเพื่อดูแผนที่' : 'ลากขึ้นเพื่อดูรายการทั้งหมด'}" aria-expanded="${state.mapSheetExpanded}"><span></span></button>
      <div class="map-controls">
        <div class="search-box"><span>⌕</span><input id="place-search" aria-label="ค้นหาสถานที่หรือย่าน" placeholder="ค้นหา เช่น Asakusa, Akihabara" value="${esc(state.mapSearch)}" /><button data-clear-map-search aria-label="ล้างคำค้นหา" ${state.mapSearch ? '' : 'hidden'}>×</button></div>
        <div class="filter-row">
          ${[['all','ทั้งหมด'],['sightseeing','🏯 ที่เที่ยว'],['food','🍜 อาหาร'],['hotel','🏨 โรงแรม'],['shopping','🛍 ช้อป']].map(([value,label]) => `<button class="${state.mapFilter === value ? 'active' : ''}" data-map-filter="${value}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="map-results-heading"><div><strong id="map-results-title">สถานที่ใกล้คุณ</strong><span id="map-results-count">${places.length} แห่ง</span></div><button data-my-location>ใช้ตำแหน่งฉัน</button></div>
      <div class="map-results-list" id="map-results-list"></div>
    </section>
  `;
  setTimeout(initMap, 0);
}

function mapSearchContext() {
  const query = state.mapSearch.trim().toLowerCase();
  return Object.entries(AREA_SEARCH).find(([key]) => query.includes(key))?.[1] || null;
}

function mapResults() {
  const query = state.mapSearch.trim().toLowerCase();
  const area = mapSearchContext();
  const origin = area?.coords || state.userLocation;
  let rows = allPlaces().filter((place) => state.mapFilter === 'all' || mapCategory(place) === state.mapFilter);
  if (area) {
    rows = rows.filter((place) => distanceKm(area.coords, [place._lat, place._lng]) <= area.radius);
  } else if (query) {
    rows = rows.filter((place) => [place._name, place.City, place.Area, place.Address, place.Category, place.Notes]
      .join(' ').toLowerCase().includes(query));
  }
  return rows.map((place) => ({ ...place, _distance: distanceKm(origin, [place._lat, place._lng]) }))
    .sort((a, b) => a._distance - b._distance || a._name.localeCompare(b._name));
}

function renderMapResults(rows = mapResults()) {
  const list = document.querySelector('#map-results-list');
  const title = document.querySelector('#map-results-title');
  const count = document.querySelector('#map-results-count');
  if (!list || !title || !count) return;
  const area = mapSearchContext();
  title.textContent = area ? `ใกล้ ${area.label}` : state.mapSearch ? 'ผลการค้นหา' : state.userLocation ? 'ใกล้ตำแหน่งของคุณ' : 'สถานที่แนะนำ';
  count.textContent = rows.length + ' แห่ง' + (!state.userLocation && !area ? ' · แตะ “ใช้ตำแหน่งฉัน” เพื่อเรียงใกล้สุด' : '');
  list.innerHTML = rows.length ? rows.map((place, index) => `
    <article class="map-result ${state.selectedPlace?._id === place._id ? 'selected' : ''}" data-map-result-id="${esc(place._id)}" tabindex="0">
      <span class="map-result-rank">${index + 1}</span>
      <span class="map-result-icon ${mapCategory(place)}">${iconFor(place._type)}</span>
      <div class="map-result-copy"><div><h2>${esc(place._name)}</h2>${Number.isFinite(place._distance) ? `<b>${distanceLabel(place._distance)}</b>` : ''}</div><p>${esc(place.Area || place.City || place.Address || '')}</p><small>${esc(place.Category || place._type)}${place.Price_Range ? ' · ' + esc(place.Price_Range) : ''}</small></div>
      ${safeUrl(place.Google_Maps_URL) !== '#' ? `<button data-url="${safeUrl(place.Google_Maps_URL)}" aria-label="เปิดเส้นทางไป ${esc(place._name)}">นำทาง</button>` : ''}
    </article>`).join('') : '<div class="empty-map-results"><strong>ไม่พบสถานที่ใกล้บริเวณนี้</strong><p>ลองล้างตัวกรองหรือค้นหาชื่อสถานที่โดยตรง</p></div>';
}

function selectMapPlace(place, zoom = 16) {
  if (!place || !state.map) return;
  state.selectedPlace = place;
  setMapSheetExpanded(false);
  state.map.setView([place._lat, place._lng], zoom, { animate: false });
  renderMapResults();
  document.querySelector(`[data-map-result-id="${CSS.escape(place._id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function centerPlaceInVisibleMap(place, animate = true) {
  const container = document.querySelector('#real-map');
  const panel = document.querySelector('#map-results-panel');
  if (!place || !state.map || !container || !panel || state.mapSheetExpanded) return;
  const mapRect = container.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const visibleBottom = Math.min(mapRect.bottom, Math.max(mapRect.top, panelRect.top));
  const visibleHeight = visibleBottom - mapRect.top;
  if (visibleHeight < 80) return;
  const current = state.map.latLngToContainerPoint([place._lat, place._lng]);
  const target = L.point(mapRect.width / 2, visibleHeight / 2);
  const offset = current.subtract(target);
  if (Math.abs(offset.x) > 1 || Math.abs(offset.y) > 1) state.map.panBy(offset, { animate, duration: 0.25 });
}

function setMapSheetExpanded(expanded) {
  const panel = document.querySelector('#map-results-panel');
  if (!panel) return;
  state.mapSheetExpanded = expanded;
  panel.classList.toggle('expanded', expanded);
  panel.classList.toggle('collapsed', !expanded);
  panel.style.removeProperty('transform');
  const handle = panel.querySelector('.drag-handle');
  if (handle) {
    handle.setAttribute('aria-expanded', String(expanded));
    handle.setAttribute('aria-label', expanded ? 'ลากลงเพื่อดูแผนที่' : 'ลากขึ้นเพื่อดูรายการทั้งหมด');
  }
  setTimeout(() => {
    state.map?.invalidateSize();
    if (!expanded && state.selectedPlace) centerPlaceInVisibleMap(state.selectedPlace);
  }, 280);
}

function initMapSheetDrag() {
  const panel = document.querySelector('#map-results-panel');
  const handle = panel?.querySelector('.drag-handle');
  if (!panel || !handle) return;
  let startY = 0;
  let startOffset = 0;
  let currentOffset = 0;
  let moved = false;
  let ignoreClick = false;
  const maxOffset = () => Math.max(0, panel.offsetHeight - Math.min(window.innerHeight * 0.44, 400));

  handle.addEventListener('pointerdown', (event) => {
    startY = event.clientY;
    startOffset = state.mapSheetExpanded ? 0 : maxOffset();
    currentOffset = startOffset;
    moved = false;
    panel.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientY - startY;
    moved ||= Math.abs(delta) > 6;
    currentOffset = Math.min(maxOffset(), Math.max(0, startOffset + delta));
    panel.style.transform = `translateY(${currentOffset}px)`;
  });
  const finishDrag = (event) => {
    const captured = handle.hasPointerCapture(event.pointerId);
    if (!captured && event.type !== 'pointercancel') return;
    if (captured) handle.releasePointerCapture(event.pointerId);
    panel.classList.remove('dragging');
    ignoreClick = moved;
    if (moved) setMapSheetExpanded(currentOffset < maxOffset() * 0.48);
    else panel.style.removeProperty('transform');
  };
  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  handle.addEventListener('click', () => {
    if (ignoreClick) { ignoreClick = false; return; }
    setMapSheetExpanded(!state.mapSheetExpanded);
  });
}

function initMap() {
  const container = document.querySelector('#real-map');
  if (!container || !window.L) {
    container?.classList.add('map-unavailable');
    if (container) container.innerHTML = '<div><strong>โหลดแผนที่ไม่ได้</strong><p>รายการและลิงก์ Google Maps ยังใช้งานได้</p></div>';
    return;
  }
  if (state.map) state.map.remove();
  state.map = L.map(container, { zoomControl: false, attributionControl: true }).setView([35.6812, 139.7671], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
  if (state.userLocation) {
    state.userMarker = L.circleMarker(state.userLocation, { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
      .addTo(state.map).bindPopup('ตำแหน่งของคุณ');
  }
  updateMapMarkers();
  initMapSheetDrag();
}

function updateMapMarkers() {
  if (!state.map) return;
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
  const filtered = mapResults();
  filtered.forEach((place) => {
    const marker = L.marker([place._lat, place._lng], {
      icon: L.divIcon({ className: 'map-marker-wrap', html: `<span class="map-marker ${mapCategory(place)}"><b>${iconFor(place._type)}</b></span>`, iconSize: [42, 48], iconAnchor: [21, 44] })
    }).addTo(state.map);
    marker.on('click', () => {
      selectMapPlace(place, 16);
    });
    state.markers.push(marker);
  });
  renderMapResults(filtered);
  if (filtered.length && (state.mapSearch || state.mapFilter !== 'all')) {
    const bounds = L.latLngBounds(filtered.map((place) => [place._lat, place._lng]));
    state.map.fitBounds(bounds, { paddingTopLeft: [45, 150], paddingBottomRight: [45, 300], maxZoom: 14 });
  }
}

function requestMyLocation(silent = false) {
  state.mapLocateAttempted = true;
  if (!navigator.geolocation) {
    if (!silent) showToast('อุปกรณ์นี้ไม่รองรับตำแหน่ง');
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    const latlng = [position.coords.latitude, position.coords.longitude];
    state.userLocation = latlng;
    if (state.userMarker) state.userMarker.remove();
    state.userMarker = L.circleMarker(latlng, { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
      .addTo(state.map).bindPopup('ตำแหน่งของคุณ');
    state.mapSearch = '';
    const input = document.querySelector('#place-search');
    if (input) input.value = '';
    const clear = document.querySelector('[data-clear-map-search]');
    if (clear) clear.hidden = true;
    updateMapMarkers();
    const nearest = mapResults()[0];
    if (nearest) state.map.fitBounds(L.latLngBounds([latlng, [nearest._lat, nearest._lng]]), { padding: [70, 120], maxZoom: 15 });
    if (!silent) showToast('เรียงสถานที่ใกล้คุณก่อนแล้ว');
  }, () => {
    renderMapResults();
    if (!silent) showToast('ไม่สามารถอ่านตำแหน่งได้ กรุณาอนุญาต Location');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function bookingGroup(category = '') {
  if (/hotel/i.test(category)) return 'hotel';
  if (/bus|flight|luggage|transport/i.test(category)) return 'transport';
  return 'ticket';
}

function renderBookings() {
  const view = document.querySelector('#saved-view');
  const bookings = DATA.bookings || [];
  const shown = bookings.filter((item) => state.bookingFilter === 'all' || bookingGroup(item.Category) === state.bookingFilter);
  const actionCount = bookings.filter((item) => /not booked|needs/i.test(item.Status || '')).length;
  view.innerHTML = `
    <header class="simple-header"><div><p class="eyebrow">TRIP WALLET</p><h1 id="saved-title">การจอง</h1></div><button class="icon-button" data-url="${safeUrl(DATA.source?.url)}" aria-label="เปิด Google Sheets">↗</button></header>
    <button class="alert-card" data-resource="tasks"><span>!</span><div><strong>มี ${actionCount} รายการที่ต้องจัดการ</strong><p>ตรวจตั๋ว การเดินทาง และสัมภาระ</p></div><b>ดู</b></button>
    <div class="segmented">${[['all','ทั้งหมด'],['ticket','ตั๋ว'],['hotel','ที่พัก'],['transport','เดินทาง']].map(([value,label]) => `<button class="${state.bookingFilter === value ? 'active' : ''}" data-booking-filter="${value}">${label}</button>`).join('')}</div>
    <div class="booking-list">
      ${shown.map((item) => `
        <article class="booking-card accent-${statusClass(item.Status) === 'warning' ? 'red' : 'indigo'}">
          <div class="booking-icon">${iconFor(item.Category)}</div>
          <div class="booking-main"><div><p>${esc((item.Category || '').toUpperCase())} · ${esc(item.Service_Date || '')}</p><h3>${esc(item.Item)}</h3><small>${esc(item.Booking_Ref_Masked || item.Provider || '')}</small></div><span class="status ${statusClass(item.Status)}">${statusThai(item.Status)}</span></div>
          <button data-booking-id="${esc(item.Booking_ID)}" aria-label="ดูรายละเอียด">›</button>
        </article>`).join('') || '<div class="empty-panel">ไม่มีรายการในหมวดนี้</div>'}
    </div>
    <div class="privacy-note"><span>🔒</span><p><strong>ข้อมูลสำคัญถูกปกป้อง</strong><br>เลขอ้างอิงถูกซ่อน และไม่มีเลข Passport เต็มในแอป</p></div>
  `;
}

const RESOURCE_META = [
  ['budget','¥','งบประมาณ','Budget เทียบค่าใช้จ่ายจริง'],
  ['tasks','✓','งานที่ต้องทำ','กำหนดเวลาและสิ่งที่ต้องยืนยัน'],
  ['transport','🚆','การเดินทาง','รถไฟ รถบัส และ Airport transfer'],
  ['hotels','🏨','ที่พัก','รายละเอียดและ Self check-in'],
  ['food','🍜','อาหาร','ร้านอาหารและคาเฟ่ที่บันทึกไว้'],
  ['wishlist','袋','Shopping Wishlist','Pokémon และสินค้าอนิเมะ'],
  ['videos','▶','วิดีโอที่บันทึก','TikTok · YouTube · Instagram'],
  ['documents','▣','เอกสาร','ลิงก์ไฟล์สำคัญที่จำกัดสิทธิ์'],
  ['contacts','☎','ผู้ติดต่อ','โรงแรม สายการบิน และผู้ให้บริการ'],
  ['weather','☀','สภาพอากาศ','พยากรณ์ตามเมืองและวันเดินทาง'],
  ['emergency','十','ข้อมูลฉุกเฉิน','โทรด่วนและขั้นตอนสำคัญ']
];

function resourceCount(key) {
  return (DATA[key] || []).length;
}

function quickAddPanel(kind) {
  const isFood = kind === 'food';
  return `<button class="quick-add-link" data-quick-link="${kind}"><span>${isFood ? '🍜' : '▶'}</span><div><strong>${isFood ? 'เพิ่มร้านจาก Google Maps' : 'เพิ่มวิดีโอจากลิงก์'}</strong><small>วางเพียงลิงก์เดียว · แอปช่วยเติมข้อมูลให้</small></div><b>＋</b></button>`;
}

function renderMore() {
  const view = document.querySelector('#more-view');
  view.innerHTML = `
    <header class="simple-header"><div><p class="eyebrow">JAPAN 2026</p><h1 id="more-title">เพิ่มเติม</h1></div></header>
    <div class="profile-card"><div class="trip-seal">日</div><div><strong>Osaka → Tokyo</strong><p>9–18 ต.ค. 2026 · ${DATA.trip?.travelers || 2} คน</p></div><span>10 วัน</span></div>
    <div class="menu-section"><h2>ข้อมูลทริป</h2>
      ${RESOURCE_META.map(([key,icon,title,description]) => `<button data-resource="${key}"><span>${icon}</span><div><strong>${title}</strong><small>${description} · ${resourceCount(key)} รายการ</small></div><b>›</b></button>`).join('')}
    </div>
    <div class="menu-section"><h2>แอปและความเป็นส่วนตัว</h2>
      <button data-sync-sheet><span>↻</span><div><strong>Google Sheets Sync</strong><small>${esc(syncLabel())}</small></div><b>›</b></button>
      <button data-install-app><span>＋</span><div><strong>ติดตั้งแอป</strong><small>เพิ่ม Japan 2026 ไว้บนหน้าจอหลัก</small></div><b>›</b></button>
      <button data-clear-data><span>⌫</span><div><strong>ออกจากระบบและล้างข้อมูล</strong><small>ลบ Token และสำเนาออฟไลน์จากอุปกรณ์นี้</small></div><b>›</b></button>
    </div>
    <a class="data-source" href="${safeUrl(DATA.source?.url)}" target="_blank" rel="noreferrer"><span class="sync-ring"></span><div><strong>${esc(DATA.source?.title || 'Japan Travel Database v1')}</strong><p>${esc(syncLabel())} · เปิด Google Sheets ↗</p></div></a>
  `;
}

function detailCard(title, subtitle, meta, icon = '📍', actions = '') {
  return `<article class="resource-card"><div class="resource-icon">${icon}</div><div class="resource-body"><h3>${esc(title)}</h3><p>${esc(subtitle || '')}</p>${meta ? `<small>${esc(meta)}</small>` : ''}${actions}</div></article>`;
}

function budgetTHB(item, field) {
  const direct = number(item[field + '_THB']);
  const amount = number(item[field + '_Amount']);
  if (item.Currency === 'JPY') {
    const converted = amount * number(DATA.trip?.jpyToThb || 0.23);
    return !direct || direct > converted * 10 ? converted : direct;
  }
  return direct || amount;
}

function openResource(key) {
  const meta = RESOURCE_META.find((item) => item[0] === key);
  document.querySelector('#detail-eyebrow').textContent = meta?.[2]?.toUpperCase() || 'JAPAN 2026';
  document.querySelector('#detail-title').textContent = meta?.[2] || 'รายละเอียด';
  let content = '';
  if (key === 'budget') {
    const rows = DATA.budget || [];
    const planned = rows.reduce((sum, item) => sum + budgetTHB(item, 'Planned'), 0);
    const actual = rows.reduce((sum, item) => sum + budgetTHB(item, 'Actual'), 0);
    const percent = planned ? Math.min(100, Math.round(actual / planned * 100)) : 0;
    content = `<div class="budget-hero"><p>จ่ายแล้ว</p><strong>${money(actual)}</strong><span>จากแผน ${money(planned)}</span><div class="progress"><i style="width:${percent}%"></i></div></div>` +
      rows.map((item) => detailCard(item.Item, item.Category, `${money(budgetTHB(item,'Actual'))} / ${money(budgetTHB(item,'Planned'))} · ${statusThai(item.Status)}`, iconFor(item.Category))).join('');
  } else if (key === 'tasks') {
    const rows = dueTasks();
    content = `<div class="section-summary"><strong>${rows.length} งานค้าง</strong><span>${rows.filter((item) => item.Priority === 'High').length} งานสำคัญ</span></div>` +
      rows.map((item) => detailCard(item.Task, `${item.Category} · ${item.Priority}`, `${item.Due_Date ? formatDate(parseSheetDate(item.Due_Date), { day:'numeric', month:'short' }) : 'ไม่มีกำหนด'} · ${item.Details || ''}`, '✓')).join('');
  } else if (key === 'hotels') {
    content = (DATA.hotels || []).map((item) => detailCard(item.Hotel_Name, `${item.Check_in_Date} → ${item.Check_out_Date}`, `${item.Address || ''} · ${item.Notes || ''}`, '🏨', `<div class="resource-actions"><button data-url="${safeUrl(item.Google_Maps_URL)}">แผนที่</button></div>`)).join('');
  } else if (key === 'transport') {
    content = (DATA.transport || []).map((item) => detailCard(item.Route, `${item.Type} · ${item.Operator || ''}`, `${item.Departure_Time || ''} → ${item.Arrival_Time || ''} · ${item.Baggage_Rule || item.Notes || ''}`, '🚆')).join('');
  } else if (key === 'food') {
    content = quickAddPanel('food') + (resourceList(DATA.food, 'Place_Name', 'Area', 'Notes', 'Food_ID') || '<div class="empty-panel"><strong>ยังไม่มีร้านที่บันทึก</strong><p>เริ่มได้ด้วยลิงก์ Google Maps</p></div>');
  } else if (key === 'wishlist') {
    content = resourceList(DATA.wishlist, 'Item', 'Store', 'Expected_Price', 'Wishlist_ID');
  } else if (key === 'videos') {
    content = quickAddPanel('videos') + (resourceList(DATA.videos, 'Place', 'Platform', 'Note', 'Video_ID', 'Link') || '<div class="empty-panel"><strong>ยังไม่มีวิดีโอที่บันทึก</strong><p>รองรับ TikTok, YouTube และ Instagram</p></div>');
  } else if (key === 'documents') {
    content = (DATA.documents || []).map((item) => detailCard(item.Document_Type || item.Document || item.Name, item.Traveler || item.Owner, item.Expiry ? `หมดอายุ ${item.Expiry}` : item.Status, '▣', safeUrl(item.File_Link || item.Link) !== '#' ? `<div class="resource-actions"><button data-url="${safeUrl(item.File_Link || item.Link)}">เปิดไฟล์ที่จำกัดสิทธิ์ ↗</button></div>` : '')).join('');
  } else if (key === 'contacts') {
    content = (DATA.contacts || []).map((item) => detailCard(item.Name || item.Contact_Name, item.Type || item.Category, item.Phone || item.Email || item.Notes, '☎', `<div class="resource-actions">${item.Phone ? `<button data-phone="${esc(item.Phone)}">โทร</button>` : ''}${safeUrl(item.URL || item.Link) !== '#' ? `<button data-url="${safeUrl(item.URL || item.Link)}">เว็บไซต์</button>` : ''}</div>`)).join('');
  } else if (key === 'weather') {
    content = renderWeather();
  } else if (key === 'emergency') {
    content = (DATA.emergency || []).map((item) => detailCard(item.Name, item.Phone || item.Action, item.Notes || '', '十', `<div class="resource-actions">${item.Phone ? `<button data-phone="${esc(item.Phone)}">โทร</button>` : ''}${safeUrl(item.Source_URL) !== '#' ? `<button data-url="${safeUrl(item.Source_URL)}">คู่มือ</button>` : ''}</div>`)).join('');
  }
  detailContent.innerHTML = content || `<div class="empty-panel"><strong>ยังไม่มีข้อมูล</strong><p>เพิ่มรายการใน Google Sheets แล้วกด Sync</p><button data-url="${safeUrl(DATA.source?.url)}">เปิด Google Sheets ↗</button></div>`;
  detailView.hidden = false;
  document.querySelector('.bottom-nav').classList.add('behind-detail');
  detailView.scrollTop = 0;
}

function resourceList(rows = [], titleKey, subtitleKey, metaKey, idKey, linkKey) {
  return rows.map((item) => {
    const link = item[linkKey] || item.Google_Maps_URL || item.Link;
    const title = item[titleKey] || item.Video_Name || item.Video_Title || item.Place_Name || item.Title || item.Name || item.Item || item[idKey];
    return detailCard(title, item[subtitleKey], item[metaKey],
      iconFor(item.Category || item.Type || titleKey),
      safeUrl(link) !== '#' ? `<div class="resource-actions"><button data-url="${safeUrl(link)}">เปิด ↗</button></div>` : '');
  }).join('');
}

function renderWeather() {
  const rows = DATA.weather || [];
  return `<div class="info-banner"><strong>พยากรณ์อากาศจะพร้อมประมาณ 10–16 วันก่อนเดินทาง</strong><p>แอปจะแสดงข้อมูลจากชีตหลัง Sync โดยไม่เดาสภาพอากาศล่วงหน้า</p></div>` +
    rows.map((item) => detailCard(item.City, formatDate(parseSheetDate(item.Date), { weekday:'short', day:'numeric', month:'short' }),
      item.Temperature_Max ? `${item.Temperature_Min || '—'}–${item.Temperature_Max}° · ${item.Forecast || ''}` : statusThai(item.Forecast_Status), '☀')).join('');
}

const WEATHER_COORDS = {
  Osaka:[34.6937,135.5023], Kyoto:[35.0116,135.7681], Nara:[34.6851,135.8048],
  Tokyo:[35.6762,139.6503], Chiba:[35.6074,140.1065]
};
const weatherText = (code) => {
  if (code === 0) return 'ท้องฟ้าแจ่มใส';
  if (code <= 3) return 'มีเมฆบางส่วน';
  if (code <= 48) return 'มีหมอก';
  if (code <= 67) return 'มีฝน';
  if (code <= 77) return 'หิมะ';
  if (code <= 82) return 'ฝนตกเป็นช่วง';
  return 'พายุฝนฟ้าคะนอง';
};

async function refreshWeather() {
  const rows = DATA.weather || [];
  const today = japanToday();
  const limit = new Date(today.getTime() + 15 * 86400000);
  const eligible = rows.filter((item) => {
    const date = parseSheetDate(item.Date);
    return date && date >= today && date <= limit;
  });
  const cities = [...new Set(eligible.map((item) => String(item.City || '').split(/\s*\/\s*/)[0]))];
  if (!cities.length) return;
  await Promise.all(cities.map(async (city) => {
    const coords = WEATHER_COORDS[city];
    if (!coords) return;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords[0]}&longitude=${coords[1]}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=16`;
      const response = await fetch(url);
      if (!response.ok) return;
      const payload = await response.json();
      rows.filter((item) => String(item.City || '').startsWith(city)).forEach((item) => {
        const index = payload.daily?.time?.indexOf(isoDate(parseSheetDate(item.Date)));
        if (index < 0) return;
        item.Temperature_Max = Math.round(payload.daily.temperature_2m_max[index]);
        item.Temperature_Min = Math.round(payload.daily.temperature_2m_min[index]);
        item.Rain_Chance = payload.daily.precipitation_probability_max[index];
        item.Forecast = `${weatherText(payload.daily.weather_code[index])} · ฝน ${item.Rain_Chance}%`;
        item.Forecast_Status = 'Available';
      });
    } catch {
      // The saved sheet forecast remains visible if live weather is unavailable.
    }
  }));
  try {
    if (DATA.source?.mode === 'live_google_sheets') localStorage.setItem('japan2026.sheetData.v1', JSON.stringify(DATA));
  } catch {}
  renderToday();
  if (!detailView.hidden && document.querySelector('#detail-title').textContent === 'สภาพอากาศ') openResource('weather');
}

function openBooking(id) {
  const item = (DATA.bookings || []).find((row) => row.Booking_ID === id);
  if (!item) return;
  document.querySelector('#detail-eyebrow').textContent = item.Category || 'BOOKING';
  document.querySelector('#detail-title').textContent = item.Item || 'การจอง';
  detailContent.innerHTML = `
    <div class="booking-detail-hero"><span class="booking-icon large">${iconFor(item.Category)}</span><span class="status ${statusClass(item.Status)}">${statusThai(item.Status)}</span><h2>${esc(item.Item)}</h2><p>${esc(item.Provider || '')}</p></div>
    <dl class="detail-list">
      ${[['วันที่',item.Service_Date],['ผู้เดินทาง',item.Traveler],['อ้างอิง',item.Booking_Ref_Masked],['ราคา',item.Price_THB ? money(item.Price_THB) : item.Price_JPY ? money(item.Price_JPY,'JPY') : ''],['สิ่งที่ต้องทำ',item.Action],['หมายเหตุ',item.Notes]].filter(([,value]) => value).map(([label,value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}
    </dl>
    <button class="primary-wide" data-url="${safeUrl(DATA.source?.url)}">ตรวจสอบใน Google Sheets ↗</button>
  `;
  detailView.hidden = false;
  document.querySelector('.bottom-nav').classList.add('behind-detail');
}

function openPlaceDetail(id) {
  const place = allPlaces().find((item) => item._id === id);
  if (!place) return;
  document.querySelector('#detail-eyebrow').textContent = place._type || 'PLACE';
  document.querySelector('#detail-title').textContent = place._name;
  const related = (DATA.videos || []).filter((video) => video.Related_Place_ID === id);
  detailContent.innerHTML = `
    <div class="place-detail-hero"><span>${iconFor(place._type)}</span><h2>${esc(place._name)}</h2><p>${esc(place.Address || place.Area || place.City || '')}</p></div>
    <dl class="detail-list">${[['เมือง',place.City],['ย่าน',place.Area],['ความสำคัญ',place.Priority],['หมายเหตุ',place.Notes]].filter(([,value]) => value).map(([label,value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    <div class="sheet-actions"><button class="primary-action" data-url="${safeUrl(place.Google_Maps_URL)}">เปิด Google Maps ↗</button><button data-url="${safeUrl(place.Official_URL)}">เว็บไซต์</button></div>
    <div class="section-heading"><h2>วิดีโอที่เกี่ยวข้อง</h2><span>${related.length} คลิป</span></div>
    ${resourceList(related,'Place','Platform','Note','Video_ID','Link') || '<div class="empty-panel">ยังไม่มีวิดีโอสำหรับสถานที่นี้</div>'}
  `;
  detailView.hidden = false;
  document.querySelector('.bottom-nav').classList.add('behind-detail');
}

function openPlanEditor(item = null) {
  if (!planEditor || !planEditorForm) return;
  const fields = ['Itinerary_ID','Date','City','Start_Time','End_Time','Activity','Place_Name','Status','Budget_JPY','Link','Notes'];
  const defaults = {
    Itinerary_ID: '', Date: state.planDate, City: itineraryFor(state.planDate)[0]?.City || '',
    Start_Time: '09:00', End_Time: '10:00', Activity: '', Place_Name: '', Status: 'Suggested',
    Budget_JPY: '', Link: '', Notes: ''
  };
  const values = item ? { ...defaults, ...item, Date: isoDate(parseSheetDate(item.Date)) || state.planDate } : defaults;
  fields.forEach((name) => {
    const control = planEditorForm.elements.namedItem(name);
    if (control) control.value = values[name] ?? '';
  });
  document.querySelector('#plan-editor-title').textContent = item ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม';
  planEditor.showModal();
  setTimeout(() => planEditorForm.elements.namedItem(item ? 'Activity' : 'City')?.focus(), 50);
}

function closePlanEditor() {
  if (planEditor?.open) planEditor.close();
}

function openQuickLink(kind = 'food') {
  if (!quickLinkEditor || !quickLinkForm) return;
  quickLinkForm.reset();
  quickLinkForm.elements.namedItem('Kind').value = kind;
  document.querySelector('#quick-link-title').textContent = kind === 'food' ? 'เพิ่มร้านจากลิงก์' : 'เพิ่มวิดีโอจากลิงก์';
  const detection = document.querySelector('#link-detection');
  detection.className = 'link-detection';
  detection.innerHTML = '<span>⌕</span><div><strong>พร้อมตรวจลิงก์</strong><p>ระบบจะระบุแพลตฟอร์ม ชื่อ พื้นที่ และพิกัดเท่าที่ลิงก์มีให้</p></div>';
  quickLinkEditor.showModal();
  setTimeout(() => quickLinkForm.elements.namedItem('URL')?.focus(), 50);
}

function closeQuickLink() {
  if (quickLinkEditor?.open) quickLinkEditor.close();
}

function areaFromText(value = '') {
  const text = String(value).toLowerCase();
  return Object.entries(AREA_SEARCH).find(([key]) => text.includes(key))?.[1] || null;
}

function cityForArea(area = '') {
  if (/namba/i.test(area)) return 'Osaka';
  if (/nara/i.test(area)) return 'Nara';
  if (/kyoto/i.test(area)) return 'Kyoto';
  return area ? 'Tokyo' : '';
}

async function oEmbedMetadata(url, platform) {
  const endpoint = platform === 'YouTube'
    ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url)
    : platform === 'TikTok'
      ? 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url)
      : '';
  if (!endpoint) return {};
  try {
    const response = await fetch(endpoint);
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
}

async function geocodeJapanPlace(name) {
  if (!name || /สถานที่จาก Google Maps/.test(name)) return null;
  try {
    const endpoint = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&q=' + encodeURIComponent(name);
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const result = (await response.json())?.[0];
    return result ? { latitude: result.lat, longitude: result.lon, address: result.display_name || '' } : null;
  } catch {
    return null;
  }
}

async function analyzeSharedLink(rawUrl, kind) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('รูปแบบลิงก์ไม่ถูกต้อง'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('กรุณาใช้ลิงก์ http หรือ https');
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  let platform = host;
  if (/youtu\.be|youtube\.com/.test(host)) platform = 'YouTube';
  else if (/tiktok\.com/.test(host)) platform = 'TikTok';
  else if (/instagram\.com/.test(host)) platform = 'Instagram';
  else if (/facebook\.com|fb\.watch/.test(host)) platform = 'Facebook';
  else if (/google\.[^/]+|goo\.gl/.test(host)) platform = 'Google Maps';

  const pathPlace = parsed.pathname.match(/\/place\/([^/]+)/i)?.[1];
  const queryPlace = parsed.searchParams.get('query') || parsed.searchParams.get('q');
  let name = decodeURIComponent(pathPlace || queryPlace || '').replace(/\+/g, ' ').trim();
  const coords = parsed.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const meta = await oEmbedMetadata(parsed.href, platform);
  if (meta.title) name = meta.title;
  if (!name) {
    const tail = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_+]/g, ' ');
    name = tail && !/^(maps|shorts|reel|p|watch)$/i.test(tail) ? tail : (kind === 'food' ? 'สถานที่จาก Google Maps' : `วิดีโอจาก ${platform}`);
  }
  const geocoded = kind === 'food' && !coords ? await geocodeJapanPlace(name) : null;
  const area = areaFromText([name, parsed.href, geocoded?.address].join(' '));
  const existingPlace = allPlaces().find((place) => {
    const needle = String(place._name || '').toLowerCase();
    return needle.length > 3 && String(name).toLowerCase().includes(needle);
  });
  const looksFood = /food|restaurant|cafe|coffee|ramen|sushi|อาหาร|ร้าน|คาเฟ่|ราเมง|ซูชิ/i.test(name);
  return {
    url: parsed.href, platform, name,
    category: kind === 'food' || looksFood ? 'Food' : 'Travel',
    area: area?.label || '', city: cityForArea(area?.label || ''),
    latitude: coords?.[1] || geocoded?.latitude || '', longitude: coords?.[2] || geocoded?.longitude || '', address: geocoded?.address || '',
    googleMapsUrl: existingPlace?.Google_Maps_URL || '', relatedPlaceId: existingPlace?._id || '',
    priority: 'Saved', status: 'Saved',
    note: `เพิ่มจาก ${platform} โดยอัตโนมัติ${meta.author_name ? ' · ' + meta.author_name : ''}`
  };
}

function showView(name) {
  state.view = name;
  detailView.hidden = true;
  document.querySelector('.bottom-nav').classList.remove('behind-detail');
  views.forEach((view) => view.classList.toggle('active', view.id === name + '-view'));
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  if (name === 'map') setTimeout(() => {
    state.map?.invalidateSize();
    if (!state.userLocation && !state.mapLocateAttempted) requestMyLocation(true);
  }, 80);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAll() {
  renderToday();
  renderPlan();
  renderDiscovery();
  renderMap();
  renderBookings();
  renderMore();
  showView(state.view);
}

document.addEventListener('input', (event) => {
  if (event.target.id === 'place-search') {
    state.mapSearch = event.target.value;
    if (!state.mapSheetExpanded) setMapSheetExpanded(true);
    const clear = document.querySelector('[data-clear-map-search]');
    if (clear) clear.hidden = !state.mapSearch;
    updateMapMarkers();
  }
});

document.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const row = event.target.closest('[data-map-result-id]');
  if (!row || event.target.closest('button')) return;
  event.preventDefault();
  const place = allPlaces().find((item) => item._id === row.dataset.mapResultId);
  selectMapPlace(place);
});

let mapResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    state.map?.invalidateSize();
    if (!state.mapSheetExpanded && state.selectedPlace) centerPlaceInVisibleMap(state.selectedPlace, false);
  }, 180);
});

planEditorForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = planEditorForm.querySelector('.save-plan');
  const values = Object.fromEntries(new FormData(planEditorForm).entries());
  saveButton.disabled = true;
  saveButton.textContent = 'กำลังบันทึก…';
  try {
    await window.SheetsSync.saveItinerary(values);
    await window.SheetsSync.sync();
    state.planDate = values.Date;
    closePlanEditor();
    renderAll();
    showView('plan');
    showToast(values.Itinerary_ID ? 'แก้ไขแผนแล้ว' : 'เพิ่มกิจกรรมแล้ว');
  } catch (error) {
    showToast(error.message || 'บันทึกแผนไม่สำเร็จ');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'บันทึกลง Google Sheets';
  }
});

quickLinkForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = quickLinkForm.querySelector('.save-link');
  const kind = quickLinkForm.elements.namedItem('Kind').value;
  const rawUrl = quickLinkForm.elements.namedItem('URL').value.trim();
  const detection = document.querySelector('#link-detection');
  saveButton.disabled = true;
  saveButton.textContent = 'กำลังตรวจ…';
  detection.className = 'link-detection loading';
  detection.innerHTML = '<span>↻</span><div><strong>กำลังอ่านลิงก์</strong><p>ตรวจชื่อ แพลตฟอร์ม พื้นที่ และพิกัด</p></div>';
  try {
    const detected = await analyzeSharedLink(rawUrl, kind);
    detection.className = 'link-detection success';
    detection.innerHTML = `<span>✓</span><div><strong>${esc(detected.name)}</strong><p>${esc([detected.platform, detected.area, detected.city].filter(Boolean).join(' · ') || 'ตรวจลิงก์แล้ว')}</p></div>`;
    saveButton.textContent = 'กำลังบันทึก…';
    await window.SheetsSync.saveQuickLink(kind, detected);
    await window.SheetsSync.sync();
    renderAll();
    closeQuickLink();
    openResource(kind);
    showToast(kind === 'food' ? 'เพิ่มร้านลง Food และแผนที่แล้ว' : 'เพิ่มวิดีโอแล้ว');
  } catch (error) {
    detection.className = 'link-detection error';
    detection.innerHTML = `<span>!</span><div><strong>ยังเพิ่มไม่ได้</strong><p>${esc(error.message || 'ตรวจลิงก์ไม่สำเร็จ')}</p></div>`;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'ตรวจและเพิ่ม';
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target;
  const syncButton = target.closest('[data-sync-sheet]');
  if (syncButton) {
    syncButton.disabled = true;
    syncButton.setAttribute('aria-busy', 'true');
    try {
      await window.SheetsSync.sync();
      renderAll();
      showToast('อัปเดตข้อมูลจาก Google Sheets แล้ว');
    } catch (error) {
      syncButton.disabled = false;
      syncButton.removeAttribute('aria-busy');
      showToast(error.message || 'Sync ไม่สำเร็จ');
    }
    return;
  }
  const tab = target.closest('[data-tab]');
  if (tab) { showView(tab.dataset.tab); return; }
  const date = target.closest('[data-plan-date]');
  if (date) { state.planDate = date.dataset.planDate; renderPlan(); return; }
  if (target.closest('[data-add-plan]')) { openPlanEditor(); return; }
  const quickLink = target.closest('[data-quick-link]');
  if (quickLink) { openQuickLink(quickLink.dataset.quickLink); return; }
  const editPlan = target.closest('[data-edit-plan]');
  if (editPlan) {
    const item = (DATA.itinerary || []).find((row) => row.Itinerary_ID === editPlan.dataset.editPlan);
    if (item) openPlanEditor(item);
    return;
  }
  const deletePlan = target.closest('[data-delete-plan]');
  if (deletePlan) {
    const item = (DATA.itinerary || []).find((row) => row.Itinerary_ID === deletePlan.dataset.deletePlan);
    if (!item || !window.confirm(`ลบ “${item.Activity}” ออกจากแผนและ Google Sheets?`)) return;
    deletePlan.disabled = true;
    try {
      await window.SheetsSync.deleteItinerary(item.Itinerary_ID);
      await window.SheetsSync.sync();
      renderAll();
      showView('plan');
      showToast('ลบกิจกรรมแล้ว');
    } catch (error) {
      deletePlan.disabled = false;
      showToast(error.message || 'ลบรายการไม่สำเร็จ');
    }
    return;
  }
  if (target.closest('[data-close-plan-editor]')) { closePlanEditor(); return; }
  if (target.closest('[data-close-quick-link]')) { closeQuickLink(); return; }
  const filter = target.closest('[data-booking-filter]');
  if (filter) { state.bookingFilter = filter.dataset.bookingFilter; renderBookings(); return; }
  const mapFilter = target.closest('[data-map-filter]');
  if (mapFilter) {
    state.mapFilter = mapFilter.dataset.mapFilter;
    setMapSheetExpanded(true);
    document.querySelectorAll('[data-map-filter]').forEach((button) => button.classList.toggle('active', button === mapFilter));
    updateMapMarkers();
    return;
  }
  if (target.closest('[data-clear-map-search]')) {
    state.mapSearch = '';
    setMapSheetExpanded(true);
    const input = document.querySelector('#place-search');
    if (input) { input.value = ''; input.focus(); }
    updateMapMarkers();
    return;
  }
  const mapResult = target.closest('[data-map-result-id]');
  if (mapResult && !target.closest('[data-url]')) {
    const place = allPlaces().find((item) => item._id === mapResult.dataset.mapResultId);
    selectMapPlace(place);
    return;
  }
  const resource = target.closest('[data-resource]');
  if (resource) { openResource(resource.dataset.resource); return; }
  const booking = target.closest('[data-booking-id]');
  if (booking) { openBooking(booking.dataset.bookingId); return; }
  const placeDetail = target.closest('[data-place-detail]');
  if (placeDetail) { openPlaceDetail(placeDetail.dataset.placeDetail); return; }
  const placeLink = target.closest('[data-place-id]');
  if (placeLink) {
    state.selectedPlace = allPlaces().find((item) => item._id === placeLink.dataset.placeId) || null;
    showView('map');
    if (state.selectedPlace && state.map) {
      selectMapPlace(state.selectedPlace, 15);
    }
    return;
  }
  if (target.closest('[data-close-detail]')) {
    detailView.hidden = true;
    document.querySelector('.bottom-nav').classList.remove('behind-detail');
    return;
  }
  const urlButton = target.closest('[data-url]');
  if (urlButton) {
    const url = urlButton.dataset.url;
    if (url && url !== '#') window.open(url, '_blank', 'noopener');
    else showToast('ยังไม่มีลิงก์ใน Google Sheets');
    return;
  }
  const phone = target.closest('[data-phone]');
  if (phone) { window.location.href = 'tel:' + phone.dataset.phone.replace(/\s/g, ''); return; }
  if (target.closest('[data-my-location]')) {
    requestMyLocation(false);
    return;
  }
  if (target.closest('[data-install-app]')) {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
    } else showToast('บน iPhone: กด Share แล้วเลือก Add to Home Screen');
    return;
  }
  if (target.closest('[data-clear-data]')) {
    if (!window.confirm('ออกจากระบบและลบสำเนาข้อมูลทริปที่เก็บไว้บนอุปกรณ์นี้?')) return;
    sessionStorage.removeItem('japan2026.googleToken.v1');
    sessionStorage.removeItem('japan2026.googleToken.write.v2');
    localStorage.removeItem('japan2026.sheetData.v1');
    clearGeminiKey();
    clearDiscoveryCache();
    showToast('ล้างข้อมูลบนอุปกรณ์นี้แล้ว');
    setTimeout(() => window.location.reload(), 700);
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}

renderAll();
refreshWeather();
if (window.SheetsSync?.hasSessionToken()) {
  window.SheetsSync.sync().then(() => {
    renderAll();
    refreshWeather();
    showToast('ข้อมูลล่าสุดพร้อมแล้ว');
  }).catch(() => {});
}
ensureDiscoveryLoaded();
