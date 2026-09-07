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
// Confirmed against the account's own AI Studio quota dashboard: these three are real, separate
// models with independent RPM/RPD quota (unlike a "-latest" alias, which may just point at
// whichever of these is already exhausted). gemini-2.5-flash is retired for new users — never
// add it back, Google returns a hard "no longer available" error for it now.
const GEMINI_MODEL_CANDIDATES = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
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

// Cached per city ({ byCity: { Osaka: { fetchedAt, items }, ... }, lastCity }) so switching
// between filter chips you've already checked today reuses what's stored instead of always
// spending another Gemini request per tap.
function readDiscoveryStore() {
  try {
    const raw = localStorage.getItem(DISCOVERY_CACHE_STORAGE);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && parsed.byCity) ? parsed : { byCity: {}, lastCity: null };
  } catch { return { byCity: {}, lastCity: null }; }
}
function writeDiscoveryStore(store) {
  try { localStorage.setItem(DISCOVERY_CACHE_STORAGE, JSON.stringify(store)); } catch { /* ignore */ }
}
function loadCityEntry(city) {
  const entry = readDiscoveryStore().byCity[city];
  return entry && Array.isArray(entry.items) ? entry : null;
}
function isCacheFresh(entry) {
  return !!entry && (Date.now() - (entry.fetchedAt || 0)) <= DISCOVERY_CACHE_TTL_MS;
}
function saveCityEntry(city, items, fetchedAt) {
  const store = readDiscoveryStore();
  store.byCity[city] = { fetchedAt: fetchedAt || Date.now(), items };
  store.lastCity = city;
  writeDiscoveryStore(store);
}
function clearDiscoveryCache() {
  try { localStorage.removeItem(DISCOVERY_CACHE_STORAGE); } catch { /* ignore */ }
}

// Restore whatever was cached last, before app.js's first renderAll() runs.
(function restoreDiscoveryCache() {
  const store = readDiscoveryStore();
  const city = store.lastCity;
  const cached = city ? store.byCity[city] : null;
  if (cached && Array.isArray(cached.items)) {
    discoveryState.items = cached.items;
    discoveryState.city = city;
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

// LoremFlickr is a free keyless service but goes down/unreachable sometimes. picsum.photos is a
// reliable keyless backup (no thematic matching to the query, but always shows *something*
// rather than a blank card) used only when the primary fails to actually load.
function fallbackImageUrlFor(query) {
  return 'https://picsum.photos/seed/discover' + Math.abs(hashCode(String(query || 'japan travel'))) + '/640/480';
}

// Cards render with data-img/data-img-fallback instead of an inline background-image so we can
// actually detect a failed load (a CSS background-image has no error event) and swap to the
// backup source, or leave the gradient+icon placeholder if both fail.
function hydrateDiscoveryImage(el) {
  const primary = el.dataset.img;
  if (!primary || el.dataset.imgHydrated) return;
  el.dataset.imgHydrated = '1';
  const apply = (url) => { el.style.backgroundImage = "url('" + url + "')"; el.classList.add('is-loaded'); };
  const primaryProbe = new Image();
  primaryProbe.onload = () => apply(primary);
  primaryProbe.onerror = () => {
    const fallback = el.dataset.imgFallback;
    if (!fallback) return;
    const fallbackProbe = new Image();
    fallbackProbe.onload = () => apply(fallback);
    fallbackProbe.src = fallback;
  };
  primaryProbe.src = primary;
}

function hydrateDiscoveryImages(root) {
  if (!root) return;
  root.querySelectorAll('[data-img]').forEach(hydrateDiscoveryImage);
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
    'คุณเป็นเพื่อนสายเที่ยวที่รู้ลึกเรื่องที่เที่ยว/ที่กิน/ที่ช้อปสายฮิปในญี่ปุ่น กำลังแนะนำที่เที่ยวให้เพื่อนคนไทยวัย Gen Z (ประมาณ 18-27 ปี) ที่กำลังเดินทางไปญี่ปุ่น',
    `ทริป: ${trip.name || 'Japan 2026'} ช่วงวันที่ ${trip.startDate || ''} ถึง ${trip.endDate || ''}`,
    `กำลังอยู่ที่หรือวางแผนอยู่ใกล้เมือง: ${city}, ประเทศญี่ปุ่น`,
    'ช่วยแนะนำกิจกรรม สถานที่ เทศกาล หรืออีเวนต์ที่น่าสนใจจริงและเกี่ยวข้องกับช่วงเวลานี้ ใกล้เมืองนี้ ประมาณ 10 รายการ',
    'เลือกที่ที่ถูกจริตสาย Gen Z: ถ่ายรูปลงโซเชียลได้สวย (aesthetic/instagrammable), กำลังเป็นกระแสใน TikTok/IG, คาเฟ่ธีมเก๋ ๆ, ร้านของกินที่กำลังไวรัล, ตลาดนัด/ตลาดกลางคืนสายชิล, ร้านมือสอง/วินเทจ, ป็อปอัพสโตร์, สตรีทอาร์ต, จุดถ่ายรูปลับที่คนไทยอาจไม่รู้จัก — เน้นสิ่งเหล่านี้มากกว่าสถานที่ท่องเที่ยวแบบดั้งเดิมที่ใคร ๆ ก็รู้จัก',
    'ต้องมีอย่างน้อย 3 รายการเป็นร้านอาหาร คาเฟ่ หรือของกินที่กำลังฮิต และอย่างน้อย 2 รายการเป็นห้างสรรพสินค้า ตลาด หรือแหล่งช้อปปิ้งสายเทรนด์ ที่เหลือเป็นเทศกาล ธรรมชาติ หรือสถานที่ท่องเที่ยวอื่น ๆ ที่มีมุมถ่ายรูปเก๋',
    'เน้นสิ่งที่เหมาะกับช่วงเดือนตุลาคม เช่น เทศกาลตามฤดูกาล ใบไม้เปลี่ยนสี ตลาดกลางคืน นิทรรศการ หรือจุดท่องเที่ยวที่คนไทยอาจไม่รู้จักมาก่อน',
    'เขียน description ด้วยโทนเป็นกันเองแบบเพื่อนคุยกัน สนุก กระชับ ใช้สแลงไทยร่วมสมัยได้พอประมาณ (ไม่ทางการ ไม่เวิ่นเว้อ) แต่ยังให้ข้อมูลที่เป็นประโยชน์จริง',
    'ตอบเป็น JSON array เท่านั้น (ห้ามมีข้อความอื่นนอกเหนือ JSON) แต่ละรายการมีฟิลด์: title, category (หมวดสั้น ๆ ภาษาไทย เช่น เทศกาล, ธรรมชาติ, ช้อปปิ้ง, อาหาร), city, area, description (ภาษาไทย 1-2 ประโยค โทน Gen Z ตามด้านบน), best_time, image_query (คำค้นภาษาอังกฤษสั้น 2-4 คำ เน้นมุมที่ดูสวย aesthetic เหมาะลงโซเชียล), map_query (ชื่อสถานที่ภาษาอังกฤษสำหรับค้นใน Google Maps)'
  ].join('\n');
}

function isModelUnavailableMessage(message) {
  return /no longer available|not found for api|is not supported for|deprecated model|not found/i.test(message || '');
}

function isOverloadedMessage(message) {
  return /overloaded|experiencing high demand|please try again later|resource_exhausted|try again later|503/i.test(message || '');
}

function isQuotaExceededMessage(message) {
  return /exceeded your current quota|quota exceeded|rate limit|check your plan and billing/i.test(message || '');
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

// Google renames/retires "flash" model ids often (we've hit this twice already), and any single
// model can also get temporarily overloaded ("experiencing high demand"). Try whichever model
// last worked first, then walk the candidate list — only for "model unavailable" or "overloaded"
// shaped errors, so a bad key or a real quota-on-your-account error still surfaces immediately
// instead of being masked by three retries.
async function callGemini(prompt) {
  const key = getGeminiKey();
  if (!key) throw new Error('ยังไม่ได้เชื่อม Gemini API Key');
  const remembered = getRememberedModel();
  const order = [remembered, ...GEMINI_MODEL_CANDIDATES].filter((model, index, all) => model && all.indexOf(model) === index);
  let lastError;
  for (const model of order) {
    try {
      const result = await callGeminiModel(prompt, key, model);
      // Only pin this model as the new default when it replaced one that's permanently gone —
      // a transient "overloaded" or "quota" hiccup shouldn't make us abandon the preferred model
      // for good, since both usually clear up on their own.
      const lastWasTransient = isOverloadedMessage(lastError?.message) || isQuotaExceededMessage(lastError?.message);
      if (model !== remembered && !lastWasTransient) rememberModel(model);
      return result;
    } catch (error) {
      lastError = error;
      const canFallBack = isModelUnavailableMessage(error.message) || isOverloadedMessage(error.message) || isQuotaExceededMessage(error.message);
      if (!canFallBack) throw error;
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
    const items = raw.slice(0, 10).map((item, index) => ({
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
    saveCityEntry(city, items, stamp);
  } catch (error) {
    discoveryState.error = error.message || 'ค้นหากิจกรรมไม่สำเร็จ';
  } finally {
    discoveryState.loading = false;
    renderDiscovery();
    renderToday();
  }
}

// Shared by both "open the Discover tab" and "tap a city chip": reuse that city's cache if it's
// still fresh (within DISCOVERY_CACHE_TTL_MS), otherwise actually call Gemini.
function loadCityFromCacheOrFetch(city) {
  const cached = loadCityEntry(city);
  if (isCacheFresh(cached)) {
    discoveryState.city = city;
    discoveryState.items = cached.items;
    discoveryState.error = null;
    renderDiscovery();
    renderToday();
    return;
  }
  fetchDiscovery(city);
}

function ensureDiscoveryLoaded() {
  if (!getGeminiKey() || discoveryState.loading) return;
  loadCityFromCacheOrFetch(activeDiscoveryCity());
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
    const existingEntry = loadCityEntry(discoveryState.city);
    saveCityEntry(discoveryState.city, discoveryState.items, existingEntry?.fetchedAt);
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
  const overloaded = !invalidKey && !authFormatIssue && isOverloadedMessage(discoveryState.error);
  const quotaExceeded = !invalidKey && !authFormatIssue && !overloaded && isQuotaExceededMessage(discoveryState.error);
  let title = 'ค้นหาไม่สำเร็จ';
  let hint = discoveryState.error;
  if (invalidKey) {
    title = 'API Key ไม่ถูกต้อง';
    hint = 'ตรวจสอบว่าคัดลอก API Key มาครบทั้งบรรทัดและไม่มีช่องว่างเกิน หรือสร้าง Key ใหม่ที่ Google AI Studio';
  } else if (authFormatIssue) {
    title = 'ปัญหาชั่วคราวจากฝั่ง Google';
    hint = 'Key ที่สร้างใหม่ตอนนี้บางบัญชีได้รูปแบบ "AQ." ซึ่ง Google ยังมีปัญหาใช้กับ Gemini API โดยตรง (ยังไม่มีวิธีแก้จาก Google ตอนนี้) ลองสร้าง Key จากโปรเจกต์เก่าที่เคยใช้งานได้ หรือรอ Google แก้ไข แล้วกด "ลองอีกครั้ง"';
  } else if (overloaded) {
    title = 'โมเดล AI กำลังมีคนใช้เยอะ';
    hint = 'ระบบลองสลับไปโมเดลสำรองให้อัตโนมัติแล้ว แต่ตอนนี้ทุกโมเดลไม่ว่างพร้อมกัน มักเป็นแค่ชั่วคราว ลองกด "ลองอีกครั้ง" อีกสักครู่';
  } else if (quotaExceeded) {
    title = 'ใช้โควต้าฟรีของ Gemini ครบแล้ว';
    hint = 'ระบบลองสลับโมเดลสำรองให้แล้วแต่โควต้าฟรีเต็มทุกตัวในตอนนี้ โควต้าฟรีจะรีเซ็ตให้ใหม่ (ปกติทุกวัน/ทุกนาทีตามชนิดโควต้า) ลองใหม่อีกครั้งภายหลัง';
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

// Splits the single Gemini response into two groups client-side (rather than a second API call,
// which the free-tier quota can't really afford) so shopping/food gets its own section above the
// festivals/nature one, per the prompt's own request for a category mix.
function isShoppingOrFoodItem(item) {
  const text = [item.category, item.title].join(' ');
  return /ช้อปปิ้ง|ห้าง|ตลาด|ร้านค้า|มอลล์|อาหาร|ร้านอาหาร|คาเฟ่|ของกิน|ขนม|shopping|mall|market|food|restaurant|caf[eé]/i.test(text);
}

function discoveryCardMarkup(item) {
  return `
    <article class="discovery-card">
      <div class="discovery-card__media" data-img="${esc(imageUrlFor(item.image_query))}" data-img-fallback="${esc(fallbackImageUrlFor(item.image_query))}">
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
    </article>`;
}

function discoverySectionMarkup(groupId, title, items) {
  if (!items.length) return '';
  return `
    <div class="section-heading discovery-section-heading"><h2>${esc(title)}</h2></div>
    <div class="discovery-carousel">
      <div class="discovery-track" data-discovery-track="${groupId}">
        ${items.map(discoveryCardMarkup).join('')}
      </div>
    </div>
    <div class="discovery-dots" data-discovery-dots="${groupId}">${items.map((_, index) => `<button class="${index === 0 ? 'active' : ''}" aria-label="การ์ดที่ ${index + 1}"></button>`).join('')}</div>
  `;
}

function discoveryCarouselMarkup() {
  if (!discoveryState.items.length) {
    return `<div class="empty-panel"><strong>ยังไม่มีคำแนะนำ</strong><p>แตะปุ่มค้นหาเพื่อดูกิจกรรมใกล้ ${esc(discoveryState.city || '')}</p><button data-refresh-discovery>ค้นหาเลย</button></div>`;
  }
  const shopFood = discoveryState.items.filter(isShoppingOrFoodItem);
  const others = discoveryState.items.filter((item) => !isShoppingOrFoodItem(item));
  return (
    discoverySectionMarkup('shop', 'ช้อปปิ้ง & ของกินแนะนำ', shopFood) +
    discoverySectionMarkup('other', others.length && shopFood.length ? 'เทศกาลและธรรมชาติแนะนำ' : 'กิจกรรมแนะนำ', others)
  );
}

// Each card is only ~82% of the track's width (so the next one peeks in), not 100% — dividing
// scrollLeft by track.clientWidth drifts further off with every card and was why the dots stopped
// matching the visible card partway through the list. Measure the real per-card scroll step
// (card width + gap) instead.
function discoveryScrollStep(track) {
  const firstCard = track.querySelector('.discovery-card');
  if (!firstCard) return 0;
  const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '0') || 0;
  return firstCard.getBoundingClientRect().width + gap;
}

// There can now be two independent carousels on screen (shopping/food + festivals/nature), each
// with its own track and dot row matched by a shared data-discovery-track/-dots group id.
function updateDiscoveryDots(track) {
  const groupId = track.dataset.discoveryTrack;
  const dots = document.querySelectorAll('[data-discovery-dots="' + groupId + '"] button');
  const step = discoveryScrollStep(track);
  if (!dots.length || !step) return;
  const index = Math.round(track.scrollLeft / step);
  dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
}

function scrollDiscoveryToIndex(track, index) {
  const step = discoveryScrollStep(track);
  if (!step) return;
  track.scrollTo({ left: step * index, behavior: 'smooth' });
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
  document.querySelectorAll('[data-discovery-track]').forEach((track) => {
    track.addEventListener('scroll', () => updateDiscoveryDots(track), { passive: true });
  });
  hydrateDiscoveryImages(view);
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
  // app.js sets #today-view's innerHTML synchronously right after calling this function, so the
  // slide elements don't exist yet — defer hydration one tick so they're actually in the DOM.
  setTimeout(() => hydrateDiscoveryImages(document.querySelector('#today-view')), 0);
  return `
    <article class="mini-card discover-card" data-tab="discovery">
      <div class="discover-card__carousel">
        ${items.map((item, index) => `<span class="discover-card__slide" data-img="${esc(imageUrlFor(item.image_query))}" data-img-fallback="${esc(fallbackImageUrlFor(item.image_query))}" style="animation-delay:${index * -3.4}s"></span>`).join('')}
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
    discoveryState.useMyLocation = false;
    loadCityFromCacheOrFetch(cityChip.dataset.discoveryCity);
    return;
  }

  const dot = target.closest('[data-discovery-dots] button');
  if (dot) {
    const dotsContainer = dot.closest('[data-discovery-dots]');
    const groupId = dotsContainer.dataset.discoveryDots;
    const track = document.querySelector('[data-discovery-track="' + groupId + '"]');
    const dots = Array.from(dotsContainer.querySelectorAll('button'));
    const index = dots.indexOf(dot);
    if (track && index >= 0) scrollDiscoveryToIndex(track, index);
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
