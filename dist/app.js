const DATA = window.TRIP_DATA || {};
const state = {
  view: 'today',
  planDate: DATA.trip?.startDate || '2026-10-09',
  bookingFilter: 'all',
  mapScope: 'city',
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
function activateNavButton(button) {
  showView(button.dataset.tab);
}
navButtons.forEach((button) => {
  button.addEventListener('click', () => activateNavButton(button));
});
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
      ${dates.map((date) => `<button role="tab" aria-selected="${isoDate(date) === state.planDate}" class="${isoDate(date) === state.planDate ? 'selected' : ''}" data-plan-date="${isoDate(date)}"><span>${formatDate(date, { weekday: 'short' })}</span><b>${date.getUTCDate()}</b></button>`).join('')}
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
        <div class="map-scope-row" aria-label="ขอบเขตสถานที่">
          ${[['today','วันนี้'],['city','เมืองถัดไป'],['plan','ในแผน'],['all','ทั้งหมด']].map(([value,label]) => `<button class="${state.mapScope === value ? 'active' : ''}" data-map-scope="${value}" aria-pressed="${state.mapScope === value}">${label}</button>`).join('')}
        </div>
        <div class="filter-row">
          ${[['all','ทั้งหมด'],['sightseeing','🏯 ที่เที่ยว'],['food','🍜 อาหาร'],['hotel','🏨 โรงแรม'],['shopping','🛍 ช้อป']].map(([value,label]) => `<button class="${state.mapFilter === value ? 'active' : ''}" data-map-filter="${value}" aria-pressed="${state.mapFilter === value}">${label}</button>`).join('')}
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
  const scopeItems = state.mapScope === 'today' ? itineraryFor(japanToday()) : (DATA.itinerary || []);
  const tripCity = typeof tripCityForToday === 'function' ? tripCityForToday() : '';
  if (state.mapScope === 'today' || state.mapScope === 'plan') {
    rows = rows.filter((place) => scopeItems.some((item) => {
      const planText = [item.Place_Name, item.Activity, item.City, item.Area].join(' ').toLowerCase();
      const name = String(place._name || '').toLowerCase();
      return name.length > 3 && (planText.includes(name) || planText.split(/\s*[→/&]\s*/).some((part) => part.length > 3 && name.includes(part)));
    }));
  } else if (state.mapScope === 'city' && tripCity) {
    rows = rows.filter((place) => [place.City, place.Area, place.Address].join(' ').toLowerCase().includes(tripCity.toLowerCase()));
  }
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
  const scopeTitle = { today: 'สถานที่ในแผนวันนี้', city: 'สถานที่ในเมืองถัดไป', plan: 'สถานที่ในแผนทริป', all: 'สถานที่ทั้งหมด' }[state.mapScope];
  title.textContent = area ? `ใกล้ ${area.label}` : state.mapSearch ? 'ผลการค้นหา' : state.userLocation ? 'ใกล้ตำแหน่งของคุณ' : scopeTitle;
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
      title: place._name,
      alt: 'เปิด ' + place._name,
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

function mapsKeySetupMarkup() {
  if (getMapsKey()) return '';
  return `
    <article class="setup-card">
      <div class="setup-card__icon">◎</div>
      <h3>เชื่อม Google Maps</h3>
      <p>วาง API Key ครั้งเดียว แอปจะจำไว้ในเครื่องนี้ แล้วเติมชื่อร้าน ที่อยู่ เบอร์โทร เวลาเปิด-ปิด ระดับราคา และรูปจาก Google ให้อัตโนมัติ</p>
      <a class="setup-card__link" href="https://console.cloud.google.com/apis/library/places.googleapis.com" target="_blank" rel="noreferrer">เปิด Places API (New) แล้วสร้าง API Key ↗</a>
      <div class="setup-card__row">
        <input id="maps-key-input" type="password" placeholder="วาง API Key ที่นี่" autocomplete="off" spellcheck="false" />
        <button data-save-maps-key>เชื่อม</button>
      </div>
    </article>`;
}

function quickAddPanel(kind) {
  const isFood = kind === 'food';
  const button = `<button class="quick-add-link" data-quick-link="${kind}"><span>${isFood ? '🍜' : '▶'}</span><div><strong>${isFood ? 'เพิ่มร้านจาก Google Maps' : 'เพิ่มวิดีโอจากลิงก์'}</strong><small>วางเพียงลิงก์เดียว · แอปช่วยเติมข้อมูลให้</small></div><b>＋</b></button>`;
  return isFood ? button + mapsKeySetupMarkup() : button;
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
    content = quickAddPanel('food') + (foodListMarkup(DATA.food || []) || '<div class="empty-panel"><strong>ยังไม่มีร้านที่บันทึก</strong><p>เริ่มได้ด้วยลิงก์ Google Maps</p></div>');
  } else if (key === 'wishlist') {
    content = resourceList(DATA.wishlist, 'Item', 'Store', 'Expected_Price', 'Wishlist_ID');
  } else if (key === 'videos') {
    const videos = videosInDisplayOrder();
    const shorts = videos.filter(isVideoShortItem);
    const normal = videos.filter((item) => !isVideoShortItem(item));
    content = quickAddPanel('videos') + videoShortsRowMarkup(shorts) +
      videoNormalListMarkup(normal) +
      (!videos.length ? '<div class="empty-panel"><strong>ยังไม่มีวิดีโอที่บันทึก</strong><p>รองรับ TikTok, YouTube และ Instagram</p></div>' : '');
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
  hydrateDiscoveryImages(detailContent);
  document.querySelector('.bottom-nav').classList.add('behind-detail');
  detailView.scrollTop = 0;
}

// Shorts don't carry an explicit "is this short-form" column in the sheet, so this guesses from
// what's already there: an explicit Duration wins when present (lets you override per-row by just
// filling that column in), otherwise a /shorts/ or /reel/ URL is a dead giveaway, otherwise TikTok
// and Instagram links default to short-form since that's nearly always what gets saved from them.
// Both the cards and the click handlers index into the same list, so the order has to stay
// fixed while a view is open — this shuffles once per DATA.videos array and hands back that same
// order until a sync replaces the array (which reshuffles, as does a reload).
let videoDisplayOrder = { source: null, items: [] };

function videosInDisplayOrder() {
  const videos = DATA.videos || [];
  if (videoDisplayOrder.source !== videos) {
    const items = videos.slice();
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    videoDisplayOrder = { source: videos, items };
  }
  return videoDisplayOrder.items;
}

function isVideoShortItem(item) {
  const url = String(item.Link || item.URL || '').toLowerCase();
  if (/\/shorts\//.test(url) || /\/reels?\//.test(url)) return true;
  const duration = parseFloat(item.Duration_Min ?? item.Duration ?? item.Length_Min ?? item.Length);
  if (Number.isFinite(duration)) return duration <= 5;
  const platform = String(item.Platform || '').toLowerCase();
  return platform === 'tiktok' || platform === 'instagram';
}

// Best-effort fallback for reading a value off a saved row when its real column header doesn't
// match any of the specific names already checked before this — the live Google Sheet's actual
// header text won't always match what this file assumes, so scan for a header that at least looks
// like the right kind of field before giving up. (The write-side twin lives in live-sync.js.)
function fuzzyFieldValue(item, includePattern, excludePattern) {
  for (const key of Object.keys(item)) {
    if (excludePattern && excludePattern.test(key)) continue;
    if (includePattern.test(key)) {
      const value = item[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return '';
}

function videoTitleFor(item) {
  return item.Place || item.Video_Name || item.Video_Title || item.Place_Name || item.Title || item.Name || item.Item ||
    fuzzyFieldValue(item, /name|title|place|caption|description/i, /id$|url$|link$|thumbnail|image/i) || item.Video_ID;
}

// Prefer a thumbnail actually captured at save time; if the row has none (older rows saved before
// that existed, or a header-name mismatch swallowed it), a YouTube link can still get a real
// thumbnail for free — YouTube serves one at a predictable URL for every video id, no API call
// needed. TikTok/Instagram have no such public predictable URL, so those stay without one until a
// Thumbnail_URL is actually present on the row.
function videoThumbnailFor(item) {
  const stored = item.Thumbnail_URL || item.Thumbnail || fuzzyFieldValue(item, /thumbnail|cover/i);
  if (stored) return stored;
  if (shortEmbedKind(item) === 'youtube') {
    const id = extractYouTubeId(item.Link || item.URL || '');
    if (id) return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  }
  return '';
}

function videoShortCardMarkup(item, index) {
  const title = videoTitleFor(item);
  const thumb = safeUrl(videoThumbnailFor(item));
  return `
    <article class="video-short-card" data-open-short="${index}" data-video-delete-id="${esc(item.Video_ID || '')}" data-video-delete-name="${esc(title)}">
      <div class="video-short-card__media"${thumb !== '#' ? ` style="background-image:url('${esc(thumb)}')"` : ''}>
        ${thumb === '#' ? '<span class="video-short-card__icon">▶</span>' : ''}
        <span class="video-short-card__tag">${esc(item.Platform || '')}</span>
      </div>
      <p class="video-short-card__title">${esc(title)}</p>
    </article>`;
}

function videoShortsRowMarkup(items) {
  if (!items.length) return '';
  return `
    <div class="section-heading discovery-section-heading"><h2>Shorts</h2></div>
    <div class="video-shorts-row">${items.map((item, index) => videoShortCardMarkup(item, index)).join('')}</div>`;
}

function videoNormalCardMarkup(item, index) {
  const title = videoTitleFor(item);
  const thumb = safeUrl(videoThumbnailFor(item));
  return `
    <article class="media-card" data-open-video="${index}" data-video-delete-id="${esc(item.Video_ID || '')}" data-video-delete-name="${esc(title)}">
      <div class="media-card__media"${thumb !== '#' ? ` style="background-image:url('${esc(thumb)}')"` : ''}>
        ${thumb === '#' ? '<span class="media-card__placeholder">▶</span>' : '<span class="media-card__play">▶</span>'}
        <span class="media-card__tag">${esc(item.Platform || '')}</span>
      </div>
      <div class="media-card__body">
        <h3>${esc(title)}</h3>
        ${item.Note ? `<small>${esc(item.Note)}</small>` : ''}
      </div>
    </article>`;
}

function videoNormalListMarkup(items) {
  if (!items.length) return '';
  return `
    <div class="section-heading discovery-section-heading"><h2>วิดีโอปกติ</h2></div>
    <div class="media-card-grid">${items.map((item, index) => videoNormalCardMarkup(item, index)).join('')}</div>`;
}

// A row saved before the check above can be holding a place-less Google Maps URL, whose "open"
// button lands on that same empty Bangkok map. When the row knows the place's name, a Maps search
// for it is strictly better than opening a link we know is broken.
function mapLinkFor(item) {
  const stored = item.Google_Maps_URL || item.Link || '';
  if (!stored || hasPlaceInMapsUrl(stored) || !/google\.[^/]+\/maps/.test(stored)) return stored;
  const name = item.Place_Name || item.Place || item.Name || '';
  const query = [name, item.Area, item.City].filter(Boolean).join(' ').trim();
  return query && usablePlaceName(name)
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query)
    : stored;
}

function foodCardMarkup(item) {
  const title = item.Place_Name || item.Place || item.Name || item.Title ||
    fuzzyFieldValue(item, /name|title|place/i, /id$|url$|link$|thumbnail|image/i) || item.Food_ID;
  const thumb = safeUrl(item.Thumbnail_URL || item.Thumbnail || fuzzyFieldValue(item, /thumbnail|cover/i));
  const link = safeUrl(mapLinkFor(item));
  // Google's own place photos are Places-API-only (paid), so a card with no saved thumbnail asks
  // the same free Wikipedia lookup the Discovery cards use — landmarks and big shops get a real
  // photo, everything else keeps the category icon rather than a stock stand-in.
  const media = thumb !== '#'
    ? ` style="background-image:url('${esc(thumb)}')"`
    : ` data-img-place="${esc(title)}"`;
  return `
    <article class="media-card">
      <div class="media-card__media"${media}>
        ${thumb === '#' ? `<span class="media-card__placeholder">${iconFor(item.Category || 'food')}</span>` : ''}
      </div>
      <div class="media-card__body">
        <h3>${esc(title)}</h3>
        ${item.Area ? `<p>${esc(item.Area)}</p>` : ''}
        ${link !== '#' ? `<div class="resource-actions"><button data-url="${link}">เปิด ↗</button></div>` : ''}
      </div>
    </article>`;
}

function foodListMarkup(items) {
  if (!items.length) return '';
  return `<div class="media-card-grid">${items.map(foodCardMarkup).join('')}</div>`;
}

// --- Shorts feed: full-screen vertical scroll-snap player -----------------------------------
// Tapping a Shorts tile opens this instead of leaving the app: a CSS scroll-snap column of
// full-height sections, one per saved short, that behaves like a native swipe feed. YouTube gets
// real autoplay/pause/mute via its postMessage IFrame API as each section crosses into view;
// TikTok and Instagram only offer official oEmbed widgets with no scriptable playback control, so
// those stay tap-to-play inside their own embed — still fully in-app, just not auto-playing.
// Only the current section +/- 1 is ever mounted with a live embed, to keep memory/battery sane.
const shortsFeedState = { items: [], index: 0, mounted: new Set(), observer: null };

function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || '';
    if (/(^|\.)youtube\.com$/.test(host)) {
      if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
      const match = parsed.pathname.match(/\/(shorts|embed)\/([^/?]+)/);
      if (match) return match[2];
    }
  } catch { /* not a valid URL */ }
  return '';
}

function extractInstagramCode(url) {
  const match = String(url || '').match(/instagram\.com\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function extractTikTokVideoId(url) {
  const match = String(url || '').match(/\/video\/(\d+)/);
  return match ? match[1] : '';
}

function shortEmbedKind(item) {
  const url = String(item.Link || item.URL || '');
  const platform = String(item.Platform || '').toLowerCase();
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url) || platform === 'tiktok') return 'tiktok';
  if (/instagram\.com/i.test(url) || platform === 'instagram') return 'instagram';
  return 'link';
}

function shortsFallbackMarkup(item) {
  const url = safeUrl(item.Link || item.URL || item.Google_Maps_URL);
  return `<div class="shorts-feed__fallback"><p>วิดีโอนี้เปิดดูในแอปต้นทางได้เลย</p>${url !== '#' ? `<button data-url="${url}">เปิด ↗</button>` : ''}</div>`;
}

// TikTok is handled separately (mountTikTokEmbed) because its links often need a resolve step
// first — see the comment there. This covers YouTube, Instagram, and the link-out fallback.
function shortsEmbedMarkup(item) {
  const url = item.Link || item.URL || '';
  const kind = shortEmbedKind(item);
  if (kind === 'youtube') {
    const id = extractYouTubeId(url);
    if (!id) return shortsFallbackMarkup(item);
    return `<iframe src="https://www.youtube.com/embed/${esc(id)}?playsinline=1&modestbranding=1&rel=0&enablejsapi=1&mute=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" data-yt-frame></iframe>`;
  }
  if (kind === 'instagram') {
    const code = extractInstagramCode(url);
    return code ? instagramEmbedMarkup(code) : shortsFallbackMarkup(item);
  }
  return shortsFallbackMarkup(item);
}

// A URL only carries a numeric video id when it's TikTok's own canonical form
// (tiktok.com/@user/video/123...). Links people actually save are very often a share-sheet
// short-link instead (vm.tiktok.com/XXXX or tiktok.com/t/XXXX) that redirects to the canonical
// one — those have no id in the URL at all, so there is nothing to build a player URL from. This
// resolves that case by asking
// TikTok's own (CORS-open, public) oEmbed endpoint for the canonical id — it follows the redirect
// for us — before building the player URL. Results are cached because scrolling back and forth in
// the feed re-mounts the same slot repeatedly.
const tiktokIdCache = new Map();

async function resolveTikTokVideoId(rawUrl) {
  if (tiktokIdCache.has(rawUrl)) return tiktokIdCache.get(rawUrl);
  let videoId = extractTikTokVideoId(rawUrl);
  if (!videoId) {
    try {
      const response = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(rawUrl));
      if (response.ok) {
        const html = String((await response.json()).html || '');
        videoId = html.match(/data-video-id="(\d+)"/)?.[1] || '';
      }
    } catch { /* network hiccup — falls through to the link-out card below */ }
  }
  if (videoId) tiktokIdCache.set(rawUrl, videoId);
  return videoId;
}

// Both platforms publish a plain iframe player. The blockquote widgets these replace needed
// embed.js re-injected on every mount to pick up newly inserted blockquotes, and each injection
// left the previous copy's listeners and timers behind — that is what made the feed get slower
// the longer you scrolled. Iframes also size to the slot instead of to their own intrinsic card,
// which is what pushed the TikTok embed out of the container.
function tiktokEmbedMarkup(videoId) {
  return `<iframe src="https://www.tiktok.com/player/v1/${esc(videoId)}?music_info=0&description=0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" data-portrait></iframe>`;
}

function instagramEmbedMarkup(code) {
  return `<iframe src="https://www.instagram.com/reel/${esc(code)}/embed/" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" data-portrait></iframe>`;
}

async function mountTikTokEmbed(slot, item, index) {
  const videoId = await resolveTikTokVideoId(item.Link || item.URL || '');
  // The viewer may have scrolled past this slot while the resolve above was in flight — if it's
  // no longer part of the mounted window, don't overwrite whatever (or nothing) is there now.
  if (!shortsFeedState.mounted.has(index)) return;
  if (!videoId) { slot.innerHTML = shortsFallbackMarkup(item); return; }
  slot.innerHTML = tiktokEmbedMarkup(videoId);
}

async function mountTikTokEmbedSingle(slot, item) {
  const videoId = await resolveTikTokVideoId(item.Link || item.URL || '');
  // The single-video player may have been closed while the resolve above was in flight.
  if (!slot.isConnected) return;
  if (!videoId) { slot.innerHTML = shortsFallbackMarkup(item); return; }
  slot.innerHTML = tiktokEmbedMarkup(videoId);
}

function shortsFeedSectionMarkup(item, index) {
  return `
    <section class="shorts-feed__section" data-shorts-index="${index}">
      <div class="shorts-feed__embed" data-shorts-embed-slot></div>
      <div class="shorts-feed__caption"><strong>${esc(videoTitleFor(item))}</strong><span>${esc(item.Platform || '')}</span></div>
    </section>`;
}

function postYouTubeCommand(iframe, func) {
  try { iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*'); } catch { /* ignore */ }
}

function playShortsFeedVideo(index) {
  const iframe = document.querySelector('.shorts-feed__section[data-shorts-index="' + index + '"] [data-yt-frame]');
  if (iframe) { postYouTubeCommand(iframe, 'unMute'); postYouTubeCommand(iframe, 'playVideo'); }
}

function pauseShortsFeedVideo(index) {
  const iframe = document.querySelector('.shorts-feed__section[data-shorts-index="' + index + '"] [data-yt-frame]');
  if (iframe) postYouTubeCommand(iframe, 'pauseVideo');
}

// Mounts a live embed only for `index` and its immediate neighbors, unmounting anything that
// falls outside that window — keeps at most 3 iframes/widgets alive at once regardless of how
// many Shorts are saved.
function mountShortsFeedAround(index) {
  const view = document.querySelector('#shorts-feed-view');
  if (!view) return;
  const items = shortsFeedState.items;
  const keep = new Set([index - 1, index, index + 1].filter((i) => i >= 0 && i < items.length));
  view.querySelectorAll('.shorts-feed__section').forEach((section) => {
    const i = Number(section.dataset.shortsIndex);
    const slot = section.querySelector('[data-shorts-embed-slot]');
    if (!slot) return;
    if (keep.has(i) && !shortsFeedState.mounted.has(i)) {
      shortsFeedState.mounted.add(i);
      if (shortEmbedKind(items[i]) === 'tiktok') {
        mountTikTokEmbed(slot, items[i], i);
      } else {
        slot.innerHTML = shortsEmbedMarkup(items[i]);
      }
    } else if (!keep.has(i) && shortsFeedState.mounted.has(i)) {
      slot.innerHTML = '';
      shortsFeedState.mounted.delete(i);
    }
  });
}

function closeShortsFeed() {
  shortsFeedState.observer?.disconnect();
  shortsFeedState.observer = null;
  shortsFeedState.items = [];
  shortsFeedState.mounted = new Set();
  document.querySelector('#shorts-feed-view')?.remove();
  document.body.style.overflow = '';
}

function openShortsFeed(items, startIndex) {
  if (!items.length) return;
  closeShortsFeed();
  shortsFeedState.items = items;
  shortsFeedState.index = Math.max(0, Math.min(startIndex, items.length - 1));
  document.body.style.overflow = 'hidden';
  const view = document.createElement('div');
  view.id = 'shorts-feed-view';
  view.className = 'shorts-feed-view';
  view.innerHTML = `
    <button class="shorts-feed__close" data-close-shorts-feed aria-label="ปิด">×</button>
    <div class="shorts-feed__scroller">${items.map(shortsFeedSectionMarkup).join('')}</div>`;
  document.body.appendChild(view);
  const sections = Array.from(view.querySelectorAll('.shorts-feed__section'));
  sections[shortsFeedState.index]?.scrollIntoView({ block: 'start' });
  mountShortsFeedAround(shortsFeedState.index);
  playShortsFeedVideo(shortsFeedState.index);
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const index = Number(entry.target.dataset.shortsIndex);
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (shortsFeedState.index !== index) pauseShortsFeedVideo(shortsFeedState.index);
        shortsFeedState.index = index;
        mountShortsFeedAround(index);
        playShortsFeedVideo(index);
      } else if (!entry.isIntersecting) {
        pauseShortsFeedVideo(index);
      }
    });
  }, { root: view.querySelector('.shorts-feed__scroller'), threshold: [0, 0.6] });
  sections.forEach((section) => observer.observe(section));
  shortsFeedState.observer = observer;
}

// --- Single video player: for "normal" (non-Shorts) saved videos ----------------------------
// These are usually full-length YouTube videos, so they get a real playback iframe with controls
// (not muted/autoplay like the Shorts feed). TikTok/Instagram normal-length links reuse the same
// official embeds as Shorts. This is a single centered player, not a swipeable feed.
function closeVideoPlayer() {
  document.querySelector('#video-player-view')?.remove();
  document.body.style.overflow = '';
}

function videoPlayerEmbedMarkup(item) {
  const url = item.Link || item.URL || '';
  const kind = shortEmbedKind(item);
  if (kind === 'youtube') {
    const id = extractYouTubeId(url);
    if (!id) return shortsFallbackMarkup(item);
    return `<iframe src="https://www.youtube.com/embed/${esc(id)}?playsinline=1&modestbranding=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }
  if (kind === 'instagram') {
    const code = extractInstagramCode(url);
    return code ? instagramEmbedMarkup(code) : shortsFallbackMarkup(item);
  }
  return shortsFallbackMarkup(item);
}

function openVideoPlayer(item) {
  closeVideoPlayer();
  document.body.style.overflow = 'hidden';
  const view = document.createElement('div');
  view.id = 'video-player-view';
  view.className = 'video-player-view';
  view.innerHTML = `
    <button class="video-player__close" data-close-video-player aria-label="ปิด">×</button>
    <div class="video-player__embed" data-video-player-slot></div>
    <div class="video-player__caption"><strong>${esc(videoTitleFor(item))}</strong><span>${esc(item.Platform || '')}</span></div>`;
  document.body.appendChild(view);
  const slot = view.querySelector('[data-video-player-slot]');
  const kind = shortEmbedKind(item);
  if (kind === 'tiktok') {
    mountTikTokEmbedSingle(slot, item);
  } else {
    slot.innerHTML = videoPlayerEmbedMarkup(item);
  }
}

// --- Press-and-hold to delete a saved video --------------------------------------------------
// Applies to both Shorts tiles and normal-video cards via a shared [data-video-delete-id]
// attribute. A short tap still opens the video as usual; only holding for ~550ms triggers delete,
// and that same flag suppresses the click event that follows the pointerup so it doesn't also
// open the video right after deleting (or after cancelling the confirm dialog).
let videoLongPressTimer = null;
let videoLongPressFired = false;

function clearVideoLongPress(card) {
  clearTimeout(videoLongPressTimer);
  videoLongPressTimer = null;
  card?.classList.remove('is-pressing');
}

document.addEventListener('pointerdown', (event) => {
  const card = event.target.closest('[data-video-delete-id]');
  if (!card || !card.dataset.videoDeleteId) return;
  videoLongPressFired = false;
  clearTimeout(videoLongPressTimer);
  card.classList.add('is-pressing');
  videoLongPressTimer = setTimeout(() => {
    videoLongPressFired = true;
    card.classList.remove('is-pressing');
    if (navigator.vibrate) navigator.vibrate(15);
    confirmDeleteVideo(card.dataset.videoDeleteId, card.dataset.videoDeleteName);
  }, 550);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => {
  document.addEventListener(type, (event) => {
    clearVideoLongPress(event.target.closest('[data-video-delete-id]'));
  });
});

async function confirmDeleteVideo(id, name) {
  if (!id || !window.confirm(`ลบวิดีโอ "${name}" ออกจากรายการที่บันทึกไว้?`)) return;
  try {
    await window.SheetsSync.deleteQuickLink('videos', id);
    await window.SheetsSync.sync();
    renderAll();
    openResource('videos');
    showToast('ลบวิดีโอแล้ว');
  } catch (error) {
    showToast(error.message || 'ลบวิดีโอไม่สำเร็จ');
  }
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
  document.querySelector('#quick-link-help').textContent = kind === 'food'
    ? 'วางลิงก์ Google Maps แบบเต็ม หรือพิมพ์ชื่อร้านจากแอป Maps แล้วระบบจะค้นหาและเติมข้อมูลให้'
    : 'วางลิงก์ TikTok, YouTube หรือ Instagram แล้วระบบจะเติมข้อมูลที่ตรวจพบให้';
  document.querySelector('#quick-link-url-label').textContent = kind === 'food' ? 'ลิงก์ Google Maps แบบเต็ม (ถ้ามี)' : 'ลิงก์วิดีโอ';
  const placeNameField = quickLinkForm.querySelector('[data-place-name-field]');
  placeNameField.hidden = kind !== 'food';
  quickLinkForm.elements.namedItem('URL').required = kind !== 'food';
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

// Google does not hand the same destination to everyone. Followed by a phone that has the Maps app,
// a share link opens the restaurant; followed by a proxy server — or by a desktop browser with no
// Google session — the very same link lands on ".../place//@13.75,100.52" instead: an empty place
// name and a map centred on the viewer's own IP, which for us means Bangkok.
//
// So a resolved URL is only an improvement when it actually names a place. Adopting a place-less
// one replaced a short link that works on the phone with a permanent link to a random Bangkok map,
// which is exactly what the saved row's "open" button was doing.
function hasPlaceInMapsUrl(url) {
  const place = String(url).match(/\/place\/([^/?#]*)/);
  return !!place && place[1].trim().length > 0;
}

// A Google Maps link carries a name and (usually) coordinates and nothing else — no address, no
// opening hours, no price. OpenStreetMap's Nominatim fills in the rest for free, and `extratags`
// returns whatever the OSM entry has for cuisine/phone/website/opening hours.
//
// Order matters. Reverse-geocoding the coordinates alone is the unreliable option: it returns
// whichever POI sits nearest that point, and a shared pin in a dense building comes back as the
// donut shop next door. So when there is both a name and coordinates, search for the NAME
// restricted to a ~1km box around them — that pins the right branch of a chain without letting a
// same-named shop in another city win. Reverse is kept only as the last resort, where it at least
// gets the street address right. Every field is optional: a place OSM has never heard of just
// leaves those columns blank instead of failing the save.
async function nominatimLookup(query) {
  try {
    const response = await fetch('https://nominatim.openstreetmap.org/' + query, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json();
    const result = Array.isArray(payload) ? payload[0] : payload;
    if (!result || result.error) return null;
    const tags = result.extratags || {};
    return {
      latitude: result.lat || '',
      longitude: result.lon || '',
      address: result.display_name || '',
      cuisine: tags.cuisine || '',
      phone: tags.phone || tags['contact:phone'] || '',
      website: tags.website || tags['contact:website'] || '',
      openingHours: tags.opening_hours || '',
      image: tags.image || ''
    };
  } catch {
    return null;
  }
}

async function lookupPlaceDetails(name, coords) {
  const place = usablePlaceName(name);
  const fields = 'format=jsonv2&addressdetails=1&extratags=1';
  const queries = [];
  if (place && coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    const box = [lon - 0.01, lat + 0.01, lon + 0.01, lat - 0.01].join(',');
    queries.push('search?' + fields + '&limit=1&bounded=1&viewbox=' + box + '&q=' + encodeURIComponent(place));
  } else if (place) {
    queries.push('search?' + fields + '&limit=1&countrycodes=jp&q=' + encodeURIComponent(place));
  }
  if (coords) {
    queries.push('reverse?' + fields + '&zoom=18&lat=' + encodeURIComponent(coords[1]) + '&lon=' + encodeURIComponent(coords[2]));
  }
  for (const query of queries) {
    const result = await nominatimLookup(query);
    if (result) return result;
  }
  return null;
}

// Google Maps Platform, unlike the share links, gives the same answer to everyone — which is the
// whole reason for the key. Places API (New) is the REST one that sends CORS headers; the legacy
// maps.googleapis.com/maps/api/place endpoints cannot be called from a browser at all.
//
// The key lives on the device, never in the sheet, and is expected to be visible in page requests:
// a Maps browser key is protected by an HTTP-referrer restriction, not by being secret.
const MAPS_KEY_STORAGE = 'japan2026.mapsKey';

// "สถานที่จาก Google Maps" is the placeholder used when a link yields no name at all. Handing it
// to a search engine is how FOOD012 ended up as Bangkok's Chinatown: Google was asked to find a
// place called "place from Google Maps", read it as Thai, and answered with somewhere in Thailand.
const PLACE_NAME_PLACEHOLDER = /สถานที่จาก Google Maps/;

function usablePlaceName(name) {
  const text = String(name || '').trim();
  return text && !PLACE_NAME_PLACEHOLDER.test(text) ? text : '';
}

function getMapsKey() {
  try { return localStorage.getItem(MAPS_KEY_STORAGE) || ''; } catch { return ''; }
}

function setMapsKey(key) {
  try { localStorage.setItem(MAPS_KEY_STORAGE, key); } catch { /* private mode — key lasts this session */ }
}

const PLACE_PRICE_LABELS = {
  PRICE_LEVEL_FREE: 'ฟรี',
  PRICE_LEVEL_INEXPENSIVE: '฿',
  PRICE_LEVEL_MODERATE: '฿฿',
  PRICE_LEVEL_EXPENSIVE: '฿฿฿',
  PRICE_LEVEL_VERY_EXPENSIVE: '฿฿฿฿'
};

const PLACE_FIELDS = [
  'places.displayName', 'places.formattedAddress', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours.weekdayDescriptions', 'places.priceLevel',
  'places.rating', 'places.location', 'places.photos', 'places.googleMapsUri'
].join(',');

const placeLookupCache = new Map();
let mapsKeyWarned = false;

// Returns null when there is no key, no match, or the call fails — every caller already has a
// free fallback, so a missing key must never break saving a place.
async function placesLookup(query, coords) {
  const key = getMapsKey();
  const text = String(query || '').trim();
  if (!key || !text) return null;
  const cacheKey = text + '|' + (coords ? coords[1] + ',' + coords[2] : '');
  if (placeLookupCache.has(cacheKey)) return placeLookupCache.get(cacheKey);
  const body = { textQuery: text, maxResultCount: 1, languageCode: 'th', regionCode: 'JP' };
  if (coords) {
    body.locationBias = { circle: { center: { latitude: Number(coords[1]), longitude: Number(coords[2]) }, radius: 2000 } };
  }
  let place = null;
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACE_FIELDS },
      body: JSON.stringify(body)
    });
    if (!response.ok && !mapsKeyWarned) {
      // A rejected key would otherwise fail silently forever, looking exactly like "this place
      // isn't on Google" — say it once, then stay quiet.
      mapsKeyWarned = true;
      const message = (await response.json().catch(() => null))?.error?.message || ('HTTP ' + response.status);
      showToast('Google Maps API: ' + message);
    }
    if (response.ok) {
      const found = (await response.json()).places?.[0];
      const located = found?.location;
      // Every place this app deals with is in Japan; a hit anywhere else means the query was wrong,
      // not that the place moved.
      if (found && (!located || isInJapan(located.latitude, located.longitude))) {
        place = {
          name: found.displayName?.text || '',
          address: found.formattedAddress || '',
          phone: found.internationalPhoneNumber || '',
          website: found.websiteUri || '',
          openingHours: (found.regularOpeningHours?.weekdayDescriptions || []).join(' · '),
          priceRange: PLACE_PRICE_LABELS[found.priceLevel] || '',
          rating: found.rating ? String(found.rating) : '',
          latitude: found.location?.latitude != null ? String(found.location.latitude) : '',
          longitude: found.location?.longitude != null ? String(found.location.longitude) : '',
          googleMapsUrl: found.googleMapsUri || '',
          photoUrl: found.photos?.[0]?.name
            ? 'https://places.googleapis.com/v1/' + found.photos[0].name + '/media?maxWidthPx=640&key=' + encodeURIComponent(key)
            : ''
        };
      }
    }
  } catch { /* offline, blocked, or key rejected — callers fall back to OSM */ }
  placeLookupCache.set(cacheKey, place);
  return place;
}

// Sharing from a place card in a Thai-locale Google Maps puts the whole search line into
// /place/, not just the name: "ญี่ปุ่น 〒110-0005 Tokyo, Taito City, Ueno, 6 Chome−13−2
// 渡辺上野ビル 3F-A 四万十屋 上野店" — country, postcode, address, floor, and only then the shop.
// Saving that whole string as Place_Name is useless, and the address in it is better than anything
// a geocoder would guess. The address half always ends at the last token containing a digit
// (postcode, block, floor), so whatever trails that is the name.
//
// Only links carrying a Japanese postcode are split this way: a plain /place/Ichiran+Shibuya share
// has no address in it, and a shop with a number in its name would otherwise lose half its title.
function splitJapanAddressPlace(text) {
  if (!/〒\s*\d{3}-?\d{4}/.test(text)) return { name: text, address: '' };
  const tokens = String(text).split(/\s+/).filter(Boolean);
  let lastWithDigit = -1;
  tokens.forEach((token, index) => { if (/\d/.test(token)) lastWithDigit = index; });
  const name = tokens.slice(lastWithDigit + 1).join(' ').trim();
  return name ? { name, address: tokens.slice(0, lastWithDigit + 1).join(' ').trim() } : { name: text, address: '' };
}

// Deliberately just Japan's bounding box, not its outline — it only has to reject a map centred
// on another country, and every place this trip covers is well inside it.
function isInJapan(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  return latitude >= 24 && latitude <= 46 && longitude >= 122 && longitude <= 154;
}

async function analyzeSharedLink(rawUrl, kind) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('รูปแบบลิงก์ไม่ถูกต้อง'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('กรุณาใช้ลิงก์ http หรือ https');
  let host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  let platform = host;
  if (/youtu\.be|youtube\.com/.test(host)) platform = 'YouTube';
  else if (/tiktok\.com/.test(host)) platform = 'TikTok';
  else if (/instagram\.com/.test(host)) platform = 'Instagram';
  else if (/facebook\.com|fb\.watch/.test(host)) platform = 'Facebook';
  else if (/google\.[^/]+|goo\.gl/.test(host)) platform = 'Google Maps';

  if (platform === 'Google Maps' && /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i.test(host)) {
    throw new Error('เปิดลิงก์ที่เพิ่งเปิด แล้วคัดลอก URL แบบเต็มจากแถบที่อยู่มาวางแทน');
  }

  const pathPlace = parsed.pathname.match(/\/place\/([^/]+)/i)?.[1];
  const queryPlace = parsed.searchParams.get('query') || parsed.searchParams.get('q');
  const placeText = decodeURIComponent(pathPlace || queryPlace || '').replace(/\+/g, ' ').trim();
  const fromUrl = splitJapanAddressPlace(placeText);
  let name = fromUrl.name;
  const coords = parsed.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const meta = await oEmbedMetadata(parsed.href, platform);
  if (meta.title) name = meta.title;
  if (!name) {
    // An unnamed Google map view is not a place. Keep the placeholder only as a UI signal; callers
    // reject it before saving so it can never pollute the sheet or downstream place searches.
    if (platform === 'Google Maps') {
      name = kind === 'food' ? 'สถานที่จาก Google Maps' : `วิดีโอจาก ${platform}`;
    } else {
      const tail = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_+]/g, ' ');
      name = tail && !/^(maps|shorts|reel|p|watch)$/i.test(tail) ? tail : (kind === 'food' ? 'สถานที่จาก Google Maps' : `วิดีโอจาก ${platform}`);
    }
  }
  // A pasted TikTok link is very often a share-sheet short-link (vm.tiktok.com/XXXX) that has no
  // video id in it at all — saving that as-is means the Shorts feed can't build a working embed
  // from it later. TikTok's own oEmbed response already resolved the redirect to build its embed
  // html, so pull the canonical long-form URL back out of that instead of the short-link.
  let resolvedUrl = parsed.href;
  if (platform === 'TikTok' && meta.html) {
    const citeMatch = String(meta.html).match(/cite="([^"]+)"/);
    if (citeMatch) resolvedUrl = citeMatch[1];
  }
  // Runs even when the URL already has coordinates — those give a pin, not an address.
  // A Google Maps share of a plain map view (rather than a place) resolves to .../place//@lat,lng
  // with an empty name — and the coordinates are wherever the map happened to be centred, which
  // has been as far away as Bangkok. Looking that up would file a Thai address under a Japan food
  // row, so anything outside Japan's bounding box is treated as "no location at all".
  const usableCoords = coords && isInJapan(coords[1], coords[2]) ? coords : null;
  const geocoded = kind === 'food' ? await lookupPlaceDetails(name, usableCoords) : null;
  // Google knows things OSM does not — price level, rating, real opening hours — so where a key is
  // configured its answer wins, falling back field by field rather than all or nothing.
  const place = kind === 'food' && usablePlaceName(name) ? await placesLookup(name, usableCoords) : null;
  if (place?.name) name = place.name;
  const area = areaFromText([name, parsed.href, geocoded?.address].join(' '));
  // Nothing identified the place: the link had no name, and no coordinates worth looking up.
  const nameMissing = !geocoded && !place && !usablePlaceName(name);
  const existingPlace = allPlaces().find((place) => {
    const needle = String(place._name || '').toLowerCase();
    return needle.length > 3 && String(name).toLowerCase().includes(needle);
  });
  const looksFood = /food|restaurant|cafe|coffee|ramen|sushi|อาหาร|ร้าน|คาเฟ่|ราเมง|ซูชิ/i.test(name);
  return {
    url: resolvedUrl, platform, name,
    category: kind === 'food' || looksFood ? 'Food' : 'Travel',
    area: area?.label || '', city: cityForArea(area?.label || ''),
    nameMissing,
    latitude: usableCoords?.[1] || place?.latitude || geocoded?.latitude || '',
    longitude: usableCoords?.[2] || place?.longitude || geocoded?.longitude || '',
    // Google's own formatted address beats both the share link's and a geocoder's guess.
    address: place?.address || fromUrl.address || geocoded?.address || '',
    cuisine: geocoded?.cuisine || '', phone: place?.phone || geocoded?.phone || '',
    website: place?.website || geocoded?.website || '',
    openingHours: place?.openingHours || geocoded?.openingHours || '',
    priceRange: place?.priceRange || '', rating: place?.rating || '',
    googleMapsUrl: existingPlace?.Google_Maps_URL || '', relatedPlaceId: existingPlace?._id || '',
    priority: kind === 'videos' ? 'Reference' : '',
    status: kind === 'food' ? 'Suggested' : '',
    thumbnailUrl: meta.thumbnail_url || geocoded?.image || '',
    note: `เพิ่มจาก ${platform} โดยอัตโนมัติ${meta.author_name ? ' · ' + meta.author_name : ''}`
  };
}

async function analyzePlaceName(rawName) {
  const requestedName = usablePlaceName(rawName);
  if (!requestedName) throw new Error('พิมพ์ชื่อร้านหรือสถานที่ก่อน');
  const [place, geocoded] = await Promise.all([placesLookup(requestedName), lookupPlaceDetails(requestedName, null)]);
  if (!place && !geocoded) throw new Error('ยังหาสถานที่นี้ไม่เจอ ลองเพิ่มชื่อเมืองหรือย่านต่อท้าย');
  const name = place?.name || requestedName;
  const area = areaFromText([name, place?.address, geocoded?.address].join(' '));
  const url = place?.googleMapsUrl || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ' Japan');
  const existingPlace = allPlaces().find((item) => String(item._name || '').toLowerCase() === name.toLowerCase());
  return {
    url, platform: 'Google Maps', name, category: 'Food',
    area: area?.label || '', city: cityForArea(area?.label || ''), nameMissing: false,
    latitude: place?.latitude || geocoded?.latitude || '', longitude: place?.longitude || geocoded?.longitude || '',
    address: place?.address || geocoded?.address || '', cuisine: geocoded?.cuisine || '',
    phone: place?.phone || geocoded?.phone || '', website: place?.website || geocoded?.website || '',
    openingHours: place?.openingHours || geocoded?.openingHours || '', priceRange: place?.priceRange || '',
    rating: place?.rating || '', googleMapsUrl: url, relatedPlaceId: existingPlace?._id || '',
    priority: '', status: 'Suggested', thumbnailUrl: place?.photoUrl || geocoded?.image || '',
    note: 'เพิ่มจากชื่อสถานที่บน Google Maps'
  };
}

function showView(name) {
  state.view = name;
  detailView.hidden = true;
  document.querySelector('.bottom-nav').classList.remove('behind-detail');
  views.forEach((view) => view.classList.toggle('active', view.id === name + '-view'));
  navButtons.forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (name === 'map') setTimeout(() => state.map?.invalidateSize(), 80);
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
  const rawPlaceName = quickLinkForm.elements.namedItem('PlaceName').value.trim();
  const detection = document.querySelector('#link-detection');
  let shortMapsUrl = false;
  try {
    const submittedUrl = new URL(rawUrl);
    shortMapsUrl = /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i.test(submittedUrl.hostname.replace(/^www\./, ''));
    if (shortMapsUrl && !rawPlaceName) {
      window.open(submittedUrl.href, '_blank', 'noopener,noreferrer');
      detection.className = 'link-detection error';
      detection.innerHTML = '<span>↗</span><div><strong>เปิดลิงก์ใน Google Maps แล้ว</strong><p>บนมือถือ ให้คัดลอกชื่อร้านแล้วกลับมาพิมพ์ในช่องชื่อสถานที่ด้านล่าง — จะยังไม่มีข้อมูลถูกบันทึก</p></div>';
      quickLinkForm.elements.namedItem('PlaceName').focus();
      return;
    }
  } catch { /* analyzeSharedLink shows the normal invalid-link message below */ }
  if (!rawUrl && !(kind === 'food' && rawPlaceName)) {
    detection.className = 'link-detection error';
    detection.innerHTML = '<span>!</span><div><strong>ยังเพิ่มไม่ได้</strong><p>วางลิงก์ หรือพิมพ์ชื่อร้านก่อน</p></div>';
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = 'กำลังตรวจ…';
  detection.className = 'link-detection loading';
  detection.innerHTML = '<span>↻</span><div><strong>กำลังอ่านลิงก์</strong><p>ตรวจชื่อ แพลตฟอร์ม พื้นที่ และพิกัด</p></div>';
  try {
    const detected = kind === 'food' && rawPlaceName && (!rawUrl || shortMapsUrl)
      ? await analyzePlaceName(rawPlaceName)
      : await analyzeSharedLink(rawUrl, kind);
    detection.className = detected.nameMissing ? 'link-detection error' : 'link-detection success';
    if (detected.nameMissing) {
      throw new Error('ลิงก์นี้ไม่มีชื่อร้าน กรุณาพิมพ์ชื่อสถานที่ในช่องด้านบนก่อนบันทึก');
    } else {
      detection.innerHTML = `<span>✓</span><div><strong>${esc(detected.name)}</strong><p>${esc([detected.platform, detected.area, detected.city].filter(Boolean).join(' · ') || 'ตรวจลิงก์แล้ว')}</p></div>`;
    }
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
  if (videoLongPressFired) {
    // The pointerdown timer already handled this interaction (opened the delete confirm); the
    // click that naturally follows pointerup must not also open the video underneath it.
    videoLongPressFired = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
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
  if (tab && !tab.closest('.bottom-nav')) { showView(tab.dataset.tab); return; }
  const date = target.closest('[data-plan-date]');
  if (date) { state.planDate = date.dataset.planDate; renderPlan(); return; }
  if (target.closest('[data-add-plan]')) { openPlanEditor(); return; }
  const quickLink = target.closest('[data-quick-link]');
  if (quickLink) { openQuickLink(quickLink.dataset.quickLink); return; }
  if (target.closest('[data-save-maps-key]')) {
    const value = (document.querySelector('#maps-key-input')?.value || '').trim();
    if (!value) { showToast('วาง API Key ก่อนกดเชื่อม'); return; }
    setMapsKey(value);
    showToast('เชื่อม Google Maps แล้ว');
    openResource('food');
    return;
  }
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
  const mapScope = target.closest('[data-map-scope]');
  if (mapScope) {
    state.mapScope = mapScope.dataset.mapScope;
    document.querySelectorAll('[data-map-scope]').forEach((button) => {
      const active = button === mapScope;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateMapMarkers();
    return;
  }
  const mapFilter = target.closest('[data-map-filter]');
  if (mapFilter) {
    state.mapFilter = mapFilter.dataset.mapFilter;
    setMapSheetExpanded(true);
    document.querySelectorAll('[data-map-filter]').forEach((button) => {
      const active = button === mapFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
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
  const shortTile = target.closest('[data-open-short]');
  if (shortTile) {
    const items = videosInDisplayOrder().filter(isVideoShortItem);
    openShortsFeed(items, Number(shortTile.dataset.openShort));
    return;
  }
  if (target.closest('[data-close-shorts-feed]')) {
    closeShortsFeed();
    return;
  }
  const videoTile = target.closest('[data-open-video]');
  if (videoTile) {
    const items = videosInDisplayOrder().filter((item) => !isVideoShortItem(item));
    const item = items[Number(videoTile.dataset.openVideo)];
    if (item) openVideoPlayer(item);
    return;
  }
  if (target.closest('[data-close-video-player]')) {
    closeVideoPlayer();
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
