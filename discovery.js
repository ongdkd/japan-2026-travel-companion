// Discovery tab — AI-suggested nearby events/activities (Gemini), with one-click add-to-plan.
// Loads before app.js so its functions exist by the time renderAll()/renderToday() call them.
// Depends on globals defined in app.js/live-sync.js: DATA, esc, safeUrl, showToast, showView,
// state, renderAll, renderToday, japanToday, itineraryFor, parseSheetDate, dateForSheetJs (below),
// window.SheetsSync. These are only referenced *inside* function bodies here, which run later,
// after app.js has finished loading — so load order only matters for the <script> tags, not for
// the order these files are written in.

const GEMINI_KEY_STORAGE = 'japan2026.geminiKey';
const GEMINI_MODEL_STORAGE = 'japan2026.geminiModel';
const DISCOVERY_CACHE_STORAGE = 'japan2026.discovery.v1';
// Google renames/retires "flash" model ids fairly often. Try the newest first, then fall back
// to older ones automatically — whichever one actually works gets remembered so later calls
// go straight to it instead of re-probing every time.
const GEMINI_MODEL_CANDIDATES = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
const DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const discoveryState = {
  city: null,
  useMyLocation: false,
  loading: false,
  error: null,
  items: []
};

function getGeminiKey() {
  try { return localStorage.getItem(GEMINI_KEY_STORAGE) || ''; } catch { return ''; }
}
function setGeminiKey(key) {
  try { localStorage.setItem(GEMINI_KEY_STORAGE, key); } catch { /* ignore */ }
}
function clearGeminiKey() {
  try { localStorage.removeItem(GEMINI_KEY_STORAGE); } catch { /* ignore */ }
}

function loadDiscoveryCache() {
  try {
    const raw = localStorage.getItem(DISCOVERY_CACHE_STORAGE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveDiscoveryCache(payload) {
  try { localStorage.setItem(DISCOVERY_CACHE_STORAGE, JSON.stringify(payload)); } catch { /* ignore */ }
}
function clearDiscoveryCache() {
  try { localStorage.removeItem(DISCOVERY_CACHE_STORAGE); } catch { /* ignore */ }
}

// Restore whatever was cached last, before app.js's first renderAll() runs.
(function restoreDiscoveryCache() {
  const cached = loadDiscoveryCache();
  if (cached && Array.isArray(cached.items)) {
    discoveryState.items = cached.items;
    discoveryState.city = cached.city || null;
  }
})();

function tripCityForToday() {
  const today = japanToday();
  const todays = itineraryFor(today);
  if (todays[0]?.City) return todays[0].City;
  const upcoming = (DATA.itinerary || [])
    .map((item) => ({ item, date: parseSheetDate(item.Date) }))
    .filter((row) => row.date && row.date >= today)
    .sort((a, b) => a.date - b.date);
  return upcoming[0]?.item.City || DATA.itinerary?.[0]?.City || 'Osaka';
}

function activeDiscoveryCity() {
  return discoveryState.city || tripCityForToday();
}

function imageUrlFor(query) {
  const tags = String(query || 'japan travel')
    .split(/[,\s]+/).filter(Boolean).slice(0, 4).join(',');
  return 'https://loremflickr.com/640/480/' + encodeURIComponent(tags) + '?lock=' + Math.abs(hashCode(tags));
}

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) { hash = (hash << 5) - hash + text.charCodeAt(i); hash |= 0; }
  return hash;
}

function mapUrlForSuggestion(item) {
  const query = item.map_query || [item.title, item.area, item.city].filter(Boolean).join(' ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

function isInvalidKeyMessage(message) {
  return /api key not valid|api_key_invalid|permission denied/i.test(message || '');
}

function isAuthFormatIssueMessage(message) {
  return /oauth 2 access token|access_token_type_unsupported|invalid authentication credentials/i.test(message || '');
}

function buildDiscoveryPrompt(city) {
  const trip = DATA.trip || {};
  return [
    'คุณเป็นผู้ช่วยแนะนำกิจกรรมท่องเที่ยวสำหรับนักท่องเที่ยวไทยที่กำลังเดินทางไปญี่ปุ่น',
    `ทริป: ${trip.name || 'Japan 2026'} ช่วงวันที่ ${trip.startDate || ''} ถึง ${trip.endDate || ''}`,
    `กำลังอยู่ที่หรือวางแผนอยู่ใกล้เมือง: ${city}, ประเทศญี่ปุ่น`,
    'ช่วยแนะนำกิจกรรม สถานที่ เทศกาล หรืออีเวนต์ที่น่าสนใจจริงและเกี่ยวข้องกับช่วงเวลานี้ ใกล้เมืองนี้ ประมาณ 6 รายการ',
    'เน้นสิ่งที่เหมาะกับช่วงเดือนตุลาคม เช่น เทศกาลตามฤดูกาล ใบไม้เปลี่ยนสี ตลาดกลางคืน นิทรรศการ หรือจุดท่องเที่ยวที่คนไทยอาจไม่รู้จักมาก่อน',
    'ตอบเป็น JSON array เท่านั้น (ห้ามมีข้อความอื่นนอกเหนือ JSON) แต่ละรายการมีฟิลด์: title, category (หมวดสั้น ๆ ภาษาไทย เช่น เทศกาล, ธรรมชาติ, ช้อปปิ้ง, อาหาร), city, area, description (ภาษาไทย 1-2 ประโยค), best_time, image_query (คำค้นภาษาอังกฤษสั้น 2-4 คำ), map_query (ชื่อสถานที่ภาษาอังกฤษสำหรับค้นใน Google Maps)'
  ].join('\n');
}

function isModelUnavailableMessage(message) {
  return /no longer available|not found for api|is not supported for|deprecated model|not found/i.test(message || '');
}

function getRememberedModel() {
  try { return localStorage.getItem(GEMINI_MODEL_STORAGE) || ''; } catch { return ''; }
}
function rememberModel(model) {
  try { localStorage.setItem(GEMINI_MODEL_STORAGE, model); } catch { /* ignore */ }
}

async function callGeminiModel(prompt, key, model) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            category: { type: 'STRING' },
            city: { type: 'STRING' },
            area: { type: 'STRING' },
            description: { type: 'STRING' },
            best_time: { type: 'STRING' },
            image_query: { type: 'STRING' },
            map_query: { type: 'STRING' }
          },
          required: ['title', 'category', 'city', 'description']
        }
      }
    }
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = detail?.error?.message || ('Gemini ตอบกลับรหัส ' + response.status);
    throw new Error(message);
  }
  const payload = await response.json();
  const text = (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('') || '[]';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('อ่านผลลัพธ์จาก Gemini ไม่สำเร็จ'); }
  return Array.isArray(parsed) ? parsed : [];
}

// Google renames/retires "flash" model ids often (we've hit this twice already). Try whichever
// model last worked first, then walk the candidate list — only for "model unavailable"-shaped
// errors, so a bad key or a real quota error still surfaces immediately instead of being masked
// by three retries.
async function callGemini(prompt) {
  const key = getGeminiKey();
  if (!key) throw new Error('ยังไม่ได้เชื่อม Gemini API Key');
  const remembered = getRememberedModel();
  const order = [remembered, ...GEMINI_MODEL_CANDIDATES].filter((model, index, all) => model && all.indexOf(model) === index);
  let lastError;
  for (const model of order) {
    try {
      const result = await callGeminiModel(prompt, key, model);
      if (model !== remembered) rememberModel(model);
      return result;
    } catch (error) {
      lastError = error;
      if (!isModelUnavailableMessage(error.message)) throw error;
    }
  }
  throw lastError;
}

async function fetchDiscovery(forceCity) {
  const city = forceCity || activeDiscoveryCity();
  discoveryState.loading = true;
  discoveryState.error = null;
  discoveryState.city = city;
  renderDiscovery();
  try {
    const raw = await callGemini(buildDiscoveryPrompt(city));
    const stamp = Date.now();
    const items = raw.slice(0, 8).map((item, index) => ({
      id: 'sug_' + stamp + '_' + index,
      title: item.title || 'กิจกรรมแนะนำ',
      category: item.category || 'แนะนำ',
      city: item.city || city,
      area: item.area || '',
      description: item.description || '',
      best_time: item.best_time || '',
      image_query: item.image_query || item.title || city,
      map_query: item.map_query || item.title || city,
      added: false
    }));
    discoveryState.items = items;
    saveDiscoveryCache({ city, fetchedAt: stamp, items });
  } catch (error) {
    discoveryState.error = error.message || 'ค้นหากิจกรรมไม่สำเร็จ';
  } finally {
    discoveryState.loading = false;
    renderDiscovery();
    renderToday();
  }
}

function ensureDiscoveryLoaded() {
  if (!getGeminiKey() || discoveryState.loading) return;
  const cached = loadDiscoveryCache();
  const city = activeDiscoveryCity();
  const stale = !cached || cached.city !== city || (Date.now() - (cached.fetchedAt || 0)) > DISCOVERY_CACHE_TTL_MS;
  if (stale) fetchDiscovery(city);
}

function dateForSheetJs(date) {
  return (date.getUTCMonth() + 1) + '/' + date.getUTCDate() + '/' + date.getUTCFullYear();
}

// Slot a suggestion into whichever itinerary day already matches its city, defaulting to an
// open-ended afternoon slot so it shows up in the Plan tab without clobbering existing times.
function suggestionDateFor(city) {
  const today = japanToday();
  const matches = (DATA.itinerary || [])
    .map((item) => ({ item, date: parseSheetDate(item.Date) }))
    .filter((row) => row.date && row.date >= today && row.item.City === city)
    .sort((a, b) => a.date - b.date);
  const fallback = (DATA.itinerary || [])
    .map((item) => ({ item, date: parseSheetDate(item.Date) }))
    .filter((row) => row.date && row.date >= today)
    .sort((a, b) => a.date - b.date);
  const picked = matches[0]?.date || fallback[0]?.date || parseSheetDate(DATA.trip?.startDate);
  return picked ? dateForSheetJs(picked) : '';
}

async function addSuggestionToPlan(id) {
  const item = discoveryState.items.find((row) => row.id === id);
  if (!item || item.added) return;
  const button = document.querySelector('[data-add-suggestion="' + id + '"]');
  if (button) { button.disabled = true; button.textContent = 'กำลังเพิ่ม…'; }
  try {
    await window.SheetsSync.saveItinerary({
      Date: suggestionDateFor(item.city),
      City: item.city,
      Start_Time: '10:00',
      End_Time: '12:00',
      Activity: item.title,
      Place_Name: item.area || item.title,
      Status: 'Suggested',
      Link: mapUrlForSuggestion(item),
      Notes: 'เพิ่มจาก AI Discovery' + (item.description ? ' · ' + item.description : '')
    });
    await window.SheetsSync.sync();
    item.added = true;
    saveDiscoveryCache({ city: discoveryState.city, fetchedAt: Date.now(), items: discoveryState.items });
    renderAll();
    showToast('เพิ่ม “' + item.title + '” ลงแผนแล้ว');
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = '+ เพิ่มลงแผน'; }
    showToast(error.message || 'เพิ่มลงแผนไม่สำเร็จ');
  }
}

function geminiSetupCard() {
  return `
    <article class="setup-card">
      <div class="setup-card__icon">✦</div>
      <h3>เชื่อม Gemini AI ฟรี</h3>
      <p>วาง API Key ครั้งเดียว แอปจะจำไว้ในเครื่องนี้ เพื่อค้นหากิจกรรมแนะนำใกล้คุณให้อัตโนมัติ</p>
      <a class="setup-card__link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">รับ API Key ฟรีที่ Google AI Studio ↗</a>
      <div class="setup-card__row">
        <input id="gemini-key-input" type="password" placeholder="วาง API Key ที่นี่" autocomplete="off" spellcheck="false" />
        <button data-save-gemini-key>เชื่อม</button>
      </div>
    </article>`;
}

function discoveryLoadingMarkup() {
  return `<div class="discovery-track">${Array.from({ length: 2 }).map(() => '<article class="discovery-card skeleton"></article>').join('')}</div>`;
}

function discoveryErrorMarkup() {
  const invalidKey = isInvalidKeyMessage(discoveryState.error);
  const authFormatIssue = !invalidKey && isAuthFormatIssueMessage(discoveryState.error);
  let title = 'ค้นหาไม่สำเร็จ';
  let hint = discoveryState.error;
  if (invalidKey) {
    title = 'API Key ไม่ถูกต้อง';
    hint = 'ตรวจสอบว่าคัดลอก API Key มาครบทั้งบรรทัดและไม่มีช่องว่างเกิน หรือสร้าง Key ใหม่ที่ Google AI Studio';
  } else if (authFormatIssue) {
    title = 'ปัญหาชั่วคราวจากฝั่ง Google';
    hint = 'Key ที่สร้างใหม่ตอนนี้บางบัญชีได้รูปแบบ "AQ." ซึ่ง Google ยังมีปัญหาใช้กับ Gemini API โดยตรง (ยังไม่มีวิธีแก้จาก Google ตอนนี้) ลองสร้าง Key จากโปรเจกต์เก่าที่เคยใช้งานได้ หรือรอ Google แก้ไข แล้วกด "ลองอีกครั้ง"';
  }
  return `
    <div class="empty-panel">
      <strong>${title}</strong>
      <p>${esc(hint)}</p>
      <div class="empty-panel__actions">
        <button data-refresh-discovery>ลองอีกครั้ง</button>
        <button data-forget-gemini-key>เปลี่ยน API Key</button>
      </div>
    </div>`;
}

function discoveryCarouselMarkup() {
  if (!discoveryState.items.length) {
    return `<div class="empty-panel"><strong>ยังไม่มีคำแนะนำ</strong><p>แตะปุ่มค้นหาเพื่อดูกิจกรรมใกล้ ${esc(discoveryState.city || '')}</p><button data-refresh-discovery>ค้นหาเลย</button></div>`;
  }
  return `
    <div class="discovery-track" id="discovery-track">
      ${discoveryState.items.map((item) => `
        <article class="discovery-card">
          <div class="discovery-card__media" style="background-image:url('${imageUrlFor(item.image_query)}')">
            <span class="discovery-card__tag">${esc(item.category)}</span>
          </div>
          <div class="discovery-card__body">
            <h3>${esc(item.title)}</h3>
            <p class="discovery-card__meta">${esc([item.area, item.best_time].filter(Boolean).join(' · '))}</p>
            <p class="discovery-card__desc">${esc(item.description)}</p>
            <div class="discovery-card__actions">
              <button class="discovery-card__map" data-url="${safeUrl(mapUrlForSuggestion(item))}">แผนที่</button>
              <button class="discovery-card__add${item.added ? ' added' : ''}" data-add-suggestion="${item.id}"${item.added ? ' disabled' : ''}>${item.added ? 'เพิ่มแล้ว ✓' : '+ เพิ่มลงแผน'}</button>
            </div>
          </div>
        </article>`).join('')}
    </div>
    <div class="discovery-dots" id="discovery-dots">${discoveryState.items.map((_, index) => `<span class="${index === 0 ? 'active' : ''}"></span>`).join('')}</div>
  `;
}

function updateDiscoveryDots(track) {
  const dots = document.querySelectorAll('#discovery-dots span');
  if (!dots.length || !track.clientWidth) return;
  const index = Math.round(track.scrollLeft / track.clientWidth);
  dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
}

function renderDiscovery() {
  const view = document.querySelector('#discovery-view');
  if (!view) return;
  const key = getGeminiKey();
  const city = activeDiscoveryCity();
  const cities = ['Osaka', 'Kyoto', 'Nara', 'Tokyo'];
  view.innerHTML = `
    <header class="simple-header"><div><p class="eyebrow">JAPAN 2026 · AI</p><h1 id="discovery-title">ค้นพบ</h1></div>
      ${key ? `<button class="icon-button" data-refresh-discovery aria-label="รีเฟรช"${discoveryState.loading ? ' aria-busy="true"' : ''}>${discoveryState.loading ? '◌' : '↻'}</button>` : ''}
    </header>
    <p class="discovery-subtitle">กิจกรรมแนะนำโดย AI ใกล้ ${esc(city || '')}</p>
    ${key ? `<div class="filter-row">${cities.map((c) => `<button class="${city === c ? 'active' : ''}" data-discovery-city="${c}">${c}</button>`).join('')}</div>` : ''}
    ${!key ? geminiSetupCard() : discoveryState.loading ? discoveryLoadingMarkup() : discoveryState.error ? discoveryErrorMarkup() : discoveryCarouselMarkup()}
  `;
  const track = document.querySelector('#discovery-track');
  if (track) track.addEventListener('scroll', () => updateDiscoveryDots(track), { passive: true });
}

function discoveryMiniCard() {
  const hasKey = !!getGeminiKey();
  const items = discoveryState.items.slice(0, 3);
  if (!hasKey || !items.length) {
    return `
      <article class="mini-card discover-card empty" data-tab="discovery">
        <div class="mini-card__head"><span class="emoji-chip">✦</span><span class="status">AI</span></div>
        <p class="card-label">แนะนำสำหรับคุณ</p>
        <h3>${hasKey ? 'แตะเพื่อค้นหากิจกรรม' : 'เชื่อม Gemini เพื่อรับคำแนะนำ'}</h3>
        <p class="card-meta">กิจกรรมใกล้ Osaka และ Tokyo</p>
      </article>`;
  }
  return `
    <article class="mini-card discover-card" data-tab="discovery">
      <div class="discover-card__carousel">
        ${items.map((item, index) => `<span class="discover-card__slide" style="background-image:url('${imageUrlFor(item.image_query)}');animation-delay:${index * -3.4}s"></span>`).join('')}
        <div class="discover-card__overlay">
          <span class="status warning">✦ AI แนะนำ</span>
          ${items.length > 1 ? `<span class="discover-card__dots">${items.map(() => '•').join('')}</span>` : ''}
        </div>
      </div>
      <div class="discover-card__text">
        <p class="card-label">แนะนำสำหรับคุณ</p>
        <h3>${esc(items[0]?.title || '')}</h3>
        <p class="card-meta">${esc(items[0]?.area || items[0]?.city || '')}</p>
      </div>
    </article>`;
}

document.addEventListener('click', async (event) => {
  const target = event.target;

  const cityChip = target.closest('[data-discovery-city]');
  if (cityChip) {
    const value = cityChip.dataset.discoveryCity;
    discoveryState.city = value;
    discoveryState.useMyLocation = false;
    fetchDiscovery(value);
    return;
  }

  const refresh = target.closest('[data-refresh-discovery]');
  if (refresh && !discoveryState.loading) {
    fetchDiscovery(discoveryState.city || activeDiscoveryCity());
    return;
  }

  const forgetKey = target.closest('[data-forget-gemini-key]');
  if (forgetKey) {
    clearGeminiKey();
    clearDiscoveryCache();
    discoveryState.error = null;
    discoveryState.items = [];
    renderDiscovery();
    renderToday();
    return;
  }

  const addButton = target.closest('[data-add-suggestion]');
  if (addButton) {
    addSuggestionToPlan(addButton.dataset.addSuggestion);
    return;
  }

  const saveKey = target.closest('[data-save-gemini-key]');
  if (saveKey) {
    const input = document.querySelector('#gemini-key-input');
    const value = (input?.value || '').trim();
    if (!value) { showToast('วาง API Key ก่อนกดเชื่อม'); return; }
    setGeminiKey(value);
    showToast('เชื่อม Gemini แล้ว กำลังค้นหากิจกรรม…');
    fetchDiscovery();
    return;
  }

  if (target.closest('[data-tab="discovery"]')) {
    ensureDiscoveryLoaded();
  }
});
