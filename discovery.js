// Discovery tab — AI-suggested nearby events/activities (Gemini), with one-click add-to-plan.
// Loads before app.js so its functions exist by the time renderAll()/renderToday() call them.
// Depends on globals defined in app.js/live-sync.js: DATA, esc, safeUrl, showToast, showView,
// state, renderAll, renderToday, japanToday, itineraryFor, parseSheetDate, dateForSheetJs (below),
// window.SheetsSync. These are only referenced *inside* function bodies here, which run later,
// after app.js has finished loading — so load order only matters for the <script> tags, not for
// the order these files are written in.

const GEMINI_KEY_STORAGE = 'japan2026.geminiKey';
const GEMINI_MODEL_STORAGE = 'japan2026.geminiModel';
const DISCOVERY_CACHE_STORAGE = 'japan2026.discovery.v3';
const PLACE_IMAGE_CACHE_STORAGE = 'japan2026.discoveryPlaceImages.v1';
// Google renames/retires "flash" model ids fairly often. Start with the free model that has the
// largest daily quota, then fall back to the other available models automatically.
// Confirmed against the account's own AI Studio quota dashboard: these three are real, separate
// models with independent RPM/RPD quota (unlike a "-latest" alias, which may just point at
// whichever of these is already exhausted). gemini-2.5-flash is retired for new users — never
// add it back, Google returns a hard "no longer available" error for it now.
const GEMINI_MODEL_CANDIDATES = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PLACE_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Free-tier reliability matters more than endless cards. One explicit city refresh is one API
// request; scrolling never spends quota in the background.
const MAX_DISCOVERY_LOAD_MORE = 0;

const discoveryState = {
  city: null,
  useMyLocation: false,
  loading: false,
  loadingMore: false,
  moreCount: 0,
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
function saveCityEntry(city, items, fetchedAt, moreCount) {
  const store = readDiscoveryStore();
  const existing = store.byCity[city];
  store.byCity[city] = { fetchedAt: fetchedAt || Date.now(), items, moreCount: moreCount != null ? moreCount : (existing?.moreCount || 0) };
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
    discoveryState.moreCount = cached.moreCount || 0;
  }
})();

// The trip only ever covers these four cities, so "near me" snaps the device's real GPS
// coordinates to whichever of them is actually closest, rather than sending raw coordinates to
// Gemini (which would need a whole separate cache/prompt shape for no real benefit here).
const DISCOVERY_CITY_COORDS = {
  Osaka: [34.6937, 135.5023],
  Kyoto: [35.0116, 135.7681],
  Nara: [34.6851, 135.8048],
  Tokyo: [35.6762, 139.6503]
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestTripCity(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const [city, [cLat, cLon]] of Object.entries(DISCOVERY_CITY_COORDS)) {
    const dist = haversineKm(lat, lon, cLat, cLon);
    if (dist < bestDist) { bestDist = dist; best = city; }
  }
  return best;
}

function useMyLocationForDiscovery() {
  if (!navigator.geolocation) {
    showToast('อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง');
    return;
  }
  showToast('กำลังหาตำแหน่งของคุณ…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const city = nearestTripCity(position.coords.latitude, position.coords.longitude);
      discoveryState.useMyLocation = true;
      loadCityFromCacheOrFetch(city);
    },
    (error) => {
      const messages = {
        1: 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กรุณาเลือกเมืองด้วยตัวเองแทน',
        2: 'หาตำแหน่งไม่สำเร็จ กรุณาเลือกเมืองด้วยตัวเองแทน',
        3: 'หาตำแหน่งใช้เวลานานเกินไป กรุณาเลือกเมืองด้วยตัวเองแทน'
      };
      showToast(messages[error.code] || 'หาตำแหน่งไม่สำเร็จ กรุณาเลือกเมืองด้วยตัวเองแทน');
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
  );
}

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

// A photo OF the actual place, rather than a stock shot that merely matches its tags: Wikipedia's
// search API is keyless and CORS-open (origin=*) and hands back the article thumbnail. The search
// is deliberately restricted to `intitle:` — a plain full-text search happily returns the article
// for the city when the place itself has no article, and a confident photo of the wrong place is
// worse than an honest neutral placeholder.
const placeImageCache = new Map();

function readPlaceImageStore() {
  try { return JSON.parse(localStorage.getItem(PLACE_IMAGE_CACHE_STORAGE) || '{}'); } catch { return {}; }
}

function loadCachedPlaceImage(query) {
  const entry = readPlaceImageStore()[query];
  if (!entry || Date.now() - Number(entry.savedAt || 0) > PLACE_IMAGE_CACHE_TTL_MS) return null;
  return String(entry.url || '');
}

function saveCachedPlaceImage(query, url) {
  try {
    const store = readPlaceImageStore();
    store[query] = { url: String(url || ''), savedAt: Date.now() };
    localStorage.setItem(PLACE_IMAGE_CACHE_STORAGE, JSON.stringify(store));
  } catch { /* ignore storage limits/private mode */ }
}

async function realImageUrlFor(place) {
  const query = String(place || '').trim();
  if (!query) return '';
  if (placeImageCache.has(query)) return placeImageCache.get(query);
  const persisted = loadCachedPlaceImage(query);
  if (persisted !== null) {
    placeImageCache.set(query, persisted);
    return persisted;
  }
  // With a Maps key configured, Google's own photo of the place is the best answer and covers the
  // small cafes and shops Wikipedia has never heard of. Without one, the Wikipedia lookup below is
  // still the free fallback. (placesLookup lives in app.js — same global scope, and this only runs
  // after both files have loaded.)
  const fromGoogle = await placesLookup(query);
  if (fromGoogle?.photoUrl) {
    placeImageCache.set(query, fromGoogle.photoUrl);
    saveCachedPlaceImage(query, fromGoogle.photoUrl);
    return fromGoogle.photoUrl;
  }
  let url = '';
  try {
    const response = await fetch('https://en.wikipedia.org/w/api.php?action=query&generator=search'
      + '&gsrsearch=' + encodeURIComponent('intitle:' + query) + '&gsrlimit=1'
      + '&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json&origin=*');
    if (response.ok) {
      const pages = (await response.json()).query?.pages || {};
      url = Object.values(pages)[0]?.thumbnail?.source || '';
    }
  } catch { /* offline or blocked — keep the neutral placeholder */ }
  placeImageCache.set(query, url);
  saveCachedPlaceImage(query, url);
  return url;
}

function loadFirstImage(sources) {
  return new Promise((resolve) => {
    const tryAt = (index) => {
      if (index >= sources.length) { resolve(''); return; }
      const probe = new Image();
      probe.onload = () => resolve(sources[index]);
      probe.onerror = () => tryAt(index + 1);
      probe.src = sources[index];
    };
    tryAt(0);
  });
}

// Only use a photo tied to the exact place. A neutral placeholder is more trustworthy than an
// attractive but unrelated stock image.
async function hydrateDiscoveryImage(el) {
  if (el.dataset.imgHydrated || !el.dataset.imgPlace) return;
  el.dataset.imgHydrated = '1';
  const real = await realImageUrlFor(el.dataset.imgPlace);
  const url = await loadFirstImage([real].filter(Boolean));
  if (!url) return;
  el.style.backgroundImage = "url('" + url + "')";
  el.classList.add('is-loaded');
}

const discoveryImageObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
        discoveryImageObserver.unobserve(entry.target);
        hydrateDiscoveryImage(entry.target);
      });
    }, { rootMargin: '240px' })
  : null;

function hydrateDiscoveryImages(root) {
  if (!root) return;
  root.querySelectorAll('[data-img-place]').forEach((el) => {
    if (discoveryImageObserver) discoveryImageObserver.observe(el);
    else hydrateDiscoveryImage(el);
  });
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

// `focus` narrows a load-more request to just one carousel's category, so scrolling the
// shopping/food track to the end doesn't also pad out the festival/nature track (and vice versa).
function buildDiscoveryPrompt(city, options = {}) {
  const { excludeTitles, focus } = options;
  const trip = DATA.trip || {};
  const today = isoDate(japanToday());
  const tripStart = String(trip.startDate || today).slice(0, 10);
  const tripEnd = String(trip.endDate || tripStart).slice(0, 10);
  const lines = [
    'คุณเป็นเพื่อนสายเที่ยวที่รู้ลึกเรื่องที่เที่ยว/ที่กิน/ที่ช้อปสายฮิปในญี่ปุ่น กำลังแนะนำที่เที่ยวให้เพื่อนคนไทยวัย Gen Z (ประมาณ 18-27 ปี) ที่กำลังเดินทางไปญี่ปุ่น',
    `วันนี้ตามเวลาญี่ปุ่นคือ ${today}`,
    `ทริป: ${trip.name || 'Japan 2026'} ช่วงวันที่ ${tripStart} ถึง ${tripEnd}`,
    `กำลังอยู่ที่หรือวางแผนอยู่ใกล้เมือง: ${city}, ประเทศญี่ปุ่น`,
    'คุณไม่มีสิทธิ์ค้นเว็บสดในคำขอนี้ ห้ามอ้างว่าได้ตรวจ Google Search หรือยืนยันสถานะล่าสุดแล้ว',
    'เน้นสถานที่ถาวรและย่านที่เป็นที่รู้จักซึ่งมีโอกาสสูงว่ายังเปิดอยู่ ห้ามแต่งชื่ออีเวนต์ URL หรือวันที่เฉพาะเจาะจง',
    `สำหรับอีเวนต์ ป็อปอัพ คาเฟ่คอลแลบ หรือนิทรรศการ ให้แนะนำสถานที่หรือผู้จัดที่ควรค้นหาสำหรับช่วง ${tripStart} ถึง ${tripEnd} และบอกให้ผู้ใช้ตรวจสอบอีกครั้งก่อนเดินทาง`
  ];
  if (focus === 'anime') {
    lines.push('รอบนี้ขอเฉพาะสายอนิเมะ/มังงะ/เกมและคอลแลบ ประมาณ 8 รายการ โดยให้ความสำคัญกับสถานที่ถาวร เช่น GiGO (เดิม SEGA), Bandai Namco, Capcom/Nintendo, ร้านฟิกเกอร์/กาชาปอง และสถานที่ที่มักจัด character cafe, collaboration cafe, pop-up store หรือนิทรรศการ เพื่อให้ผู้ใช้กดค้นสถานะล่าสุดเอง (ไม่เอาร้านอาหารทั่วไป ห้างทั่วไป เทศกาลทั่วไป หรือธรรมชาติ)');
  } else if (focus === 'shop') {
    lines.push('รอบนี้ขอเฉพาะร้านอาหาร คาเฟ่ ของกิน ห้างสรรพสินค้า ตลาด หรือแหล่งช้อปปิ้งที่เป็นที่รู้จักและควรลอง (ไม่เอาเทศกาล ธรรมชาติ หรือที่สายอนิเมะ) ประมาณ 8 รายการ');
  } else if (focus === 'other') {
    lines.push('รอบนี้ขอเฉพาะเทศกาล ธรรมชาติ หรือสถานที่ท่องเที่ยวอื่น ๆ ที่มีมุมถ่ายรูปเก๋เท่านั้น (ไม่เอาร้านอาหาร คาเฟ่ ห้าง ตลาด หรือที่สายอนิเมะ) ประมาณ 8 รายการ');
  } else {
    lines.push('ช่วยแนะนำสถานที่ถาวรและจุดที่ควรค้นกิจกรรมเพิ่มเติมใกล้เมืองนี้ ประมาณ 12 รายการ');
  }
  lines.push('เลือกที่ที่ถูกจริตสาย Gen Z: ถ่ายรูปลงโซเชียลได้สวย (aesthetic/instagrammable), กำลังเป็นกระแสใน TikTok/IG, คาเฟ่ธีมเก๋ ๆ, ร้านของกินที่กำลังไวรัล, ตลาดนัด/ตลาดกลางคืนสายชิล, ร้านมือสอง/วินเทจ, ป็อปอัพสโตร์, สตรีทอาร์ต, จุดถ่ายรูปลับที่คนไทยอาจไม่รู้จัก — เน้นสิ่งเหล่านี้มากกว่าสถานที่ท่องเที่ยวแบบดั้งเดิมที่ใคร ๆ ก็รู้จัก');
  if (!focus) {
    lines.push('ต้องมีอย่างน้อย 3 รายการเป็นร้านอาหาร คาเฟ่ หรือของกิน, อย่างน้อย 2 รายการเป็นห้าง ตลาด หรือแหล่งช้อปปิ้ง และอย่างน้อย 3 รายการเป็นสายอนิเมะ/มังงะ/เกม โดยเน้น GiGO (เดิม SEGA), เกมเซ็นเตอร์ และสถานที่ที่มักจัด character cafe, collaboration cafe, นิทรรศการหรือป็อปอัพ ที่เหลือเป็นธรรมชาติหรือสถานที่ถ่ายรูป');
  }
  lines.push('เน้นสิ่งที่โดยทั่วไปเหมาะกับช่วงเดือนตุลาคม เช่น บรรยากาศฤดูใบไม้ร่วง ตลาดกลางคืน หรือจุดท่องเที่ยวที่คนไทยอาจไม่รู้จักมาก่อน โดยไม่แต่งชื่อเทศกาลหรือวันที่');
  lines.push('เขียน description ด้วยโทนเป็นกันเองแบบเพื่อนคุยกัน สนุก กระชับ ใช้สแลงไทยร่วมสมัยได้พอประมาณ (ไม่ทางการ ไม่เวิ่นเว้อ) แต่ยังให้ข้อมูลที่เป็นประโยชน์จริง');
  if (excludeTitles && excludeTitles.length) {
    lines.push('ห้ามแนะนำที่ซ้ำหรือคล้ายกับรายการที่เคยแนะนำไปแล้วนี้ ขอเป็นที่ใหม่ล้วน: ' + excludeTitles.join(', '));
  }
  lines.push('ตอบเป็น JSON array เท่านั้น (ห้ามมีข้อความอื่นนอกเหนือ JSON) แต่ละรายการมีฟิลด์: title, category (หมวดสั้น ๆ ภาษาไทย เช่น ธรรมชาติ, ช้อปปิ้ง, อาหาร, อนิเมะ, คอลแลบ), city, area, description (ภาษาไทย 1-2 ประโยค), best_time, image_query (คำค้นชื่อสถานที่ภาษาอังกฤษ), map_query (ชื่อสถานที่ภาษาอังกฤษแบบเจาะจงสำหรับ Google Maps), availability_status (permanent หรือ needs_check เท่านั้น)');
  return lines.join('\n');
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
      temperature: 0.2,
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
            map_query: { type: 'STRING' },
            availability_status: { type: 'STRING' }
          },
          required: ['title', 'category', 'city', 'description', 'availability_status']
        }
      }
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Gemini ใช้เวลาตอบนานเกินไป');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

// Google renames/retires model ids often, and any model can be temporarily overloaded. Always
// try high-quota Flash Lite first, then the last working fallback and the remaining candidates.
async function callGemini(prompt) {
  const key = getGeminiKey();
  if (!key) throw new Error('ยังไม่ได้เชื่อม Gemini API Key');
  const remembered = getRememberedModel();
  const order = [GEMINI_MODEL_CANDIDATES[0], remembered, ...GEMINI_MODEL_CANDIDATES.slice(1)]
    .filter((model, index, all) => model && all.indexOf(model) === index);
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

function isUsableDiscoveryItem(item) {
  if (!item || !String(item.title || '').trim()) return false;
  const status = String(item.availability_status || '').toLowerCase().trim();
  return ['permanent', 'needs_check'].includes(status);
}

function normalizeDiscoveryItem(item, index, city, stamp) {
  return {
    id: 'sug_' + stamp + '_' + index,
    title: item.title || 'กิจกรรมแนะนำ',
    category: item.category || 'แนะนำ',
    city: item.city || city,
    area: item.area || '',
    description: item.description || '',
    best_time: item.best_time || '',
    image_query: item.image_query || item.title || city,
    map_query: item.map_query || item.title || city,
    availability_status: item.availability_status || '',
    added: false
  };
}

async function fetchDiscovery(forceCity) {
  const city = forceCity || activeDiscoveryCity();
  const cached = loadCityEntry(city);
  discoveryState.loading = true;
  discoveryState.error = null;
  discoveryState.city = city;
  renderDiscovery();
  try {
    const raw = await callGemini(buildDiscoveryPrompt(city));
    const stamp = Date.now();
    const items = raw.filter(isUsableDiscoveryItem).slice(0, 12)
      .map((item, index) => normalizeDiscoveryItem(item, index, city, stamp));
    if (!items.length) throw new Error('ยังไม่พบคำแนะนำที่ใช้งานได้ ลองรีเฟรชอีกครั้ง');
    discoveryState.items = items;
    discoveryState.moreCount = 0;
    saveCityEntry(city, items, stamp, 0);
  } catch (error) {
    if (cached?.items?.length) {
      discoveryState.items = cached.items;
      discoveryState.moreCount = cached.moreCount || 0;
      discoveryState.error = null;
      showToast('Gemini ยังไม่พร้อม จึงแสดงคำแนะนำที่บันทึกไว้');
    } else {
      discoveryState.error = error.message || 'ค้นหากิจกรรมไม่สำเร็จ';
    }
  } finally {
    discoveryState.loading = false;
    renderDiscovery();
    renderToday();
  }
}

// Reaching the last card of ONE carousel calls this with just that group's id (a DISCOVERY_GROUPS
// id) — only that track grows. The request is focused to that category (buildDiscoveryPrompt
// focus) and results are filtered again client-side as a safety net, so scrolling shopping/food to
// the end never quietly pads out the festival/nature track (or vice versa).
async function loadMoreDiscovery(groupId) {
  if (discoveryState.loading || discoveryState.loadingMore) return;
  if ((discoveryState.moreCount || 0) >= MAX_DISCOVERY_LOAD_MORE) return;
  if (!getGeminiKey() || !discoveryState.items.length) return;
  const city = discoveryState.city || activeDiscoveryCity();
  discoveryState.loadingMore = groupId;
  renderDiscoveryLoadMoreState();
  try {
    const existingTitles = discoveryState.items.map((item) => item.title).filter(Boolean);
    const raw = await callGemini(buildDiscoveryPrompt(city, { excludeTitles: existingTitles, focus: groupId }));
    const stamp = Date.now();
    const seen = new Set(existingTitles.map((title) => title.toLowerCase().trim()));
    const matchesGroup = (item) => discoveryGroupIdFor(item) === groupId;
    const newItems = raw
      .filter((item) => item.title && !seen.has(String(item.title).toLowerCase().trim()) && matchesGroup(item) && isUsableDiscoveryItem(item))
      .slice(0, 8)
      .map((item, index) => normalizeDiscoveryItem(item, index, city, stamp));
    discoveryState.moreCount = (discoveryState.moreCount || 0) + 1;
    if (!newItems.length) {
      showToast('ยังไม่มีคำแนะนำเพิ่มเติมตอนนี้');
    } else {
      discoveryState.items = discoveryState.items.concat(newItems);
      appendDiscoveryCardsToGroup(groupId, newItems);
    }
    const existingEntry = loadCityEntry(city);
    saveCityEntry(city, discoveryState.items, existingEntry?.fetchedAt, discoveryState.moreCount);
  } catch (error) {
    showToast(error.message || 'โหลดเพิ่มเติมไม่สำเร็จ');
  } finally {
    discoveryState.loadingMore = false;
    renderDiscoveryLoadMoreState();
  }
}

// Appends new cards/dots straight into ONE group's existing track (rather than a full re-render)
// so the carousel the user is mid-scroll on doesn't jump back to the start. Falls back to a full
// renderDiscovery() only for the rare case that section was empty before (its track doesn't exist
// yet in the DOM to append into).
function appendDiscoveryCardsToGroup(groupId, items) {
  if (!items.length) return;
  const track = document.querySelector('[data-discovery-track="' + groupId + '"]');
  const dotsContainer = document.querySelector('[data-discovery-dots="' + groupId + '"]');
  if (!track || !dotsContainer) { renderDiscovery(); return; }
  const existingCount = dotsContainer.querySelectorAll('button').length;
  track.insertAdjacentHTML('beforeend', items.map(discoveryCardMarkup).join(''));
  dotsContainer.insertAdjacentHTML('beforeend', items.map((_, index) => `<button aria-label="การ์ดที่ ${existingCount + index + 1}"></button>`).join(''));
  hydrateDiscoveryImages(track);
}

// Toggles a small busy state on just the carousel that's actually loading more, without touching
// scroll position (a full renderDiscovery() would reset it to 0).
function renderDiscoveryLoadMoreState() {
  document.querySelectorAll('.discovery-carousel').forEach((carousel) => {
    const track = carousel.querySelector('[data-discovery-track]');
    const groupId = track?.dataset.discoveryTrack;
    carousel.classList.toggle('is-loading-more', !!discoveryState.loadingMore && discoveryState.loadingMore === groupId);
  });
}

// Fires on every scroll of any carousel track; triggers loadMoreDiscovery() for THAT track's
// own group once the user is within ~half a card-width of the end, so it feels like "scrolling to
// the end asks for more" rather than needing a precise pixel-perfect drag past the boundary.
function maybeLoadMoreDiscovery(track) {
  if (discoveryState.loading || discoveryState.loadingMore) return;
  if ((discoveryState.moreCount || 0) >= MAX_DISCOVERY_LOAD_MORE) return;
  const threshold = Math.max(48, discoveryScrollStep(track) * 0.5);
  const distanceFromEnd = track.scrollWidth - track.clientWidth - track.scrollLeft;
  if (distanceFromEnd <= threshold) loadMoreDiscovery(track.dataset.discoveryTrack);
}

// Shared by both "open the Discover tab" and "tap a city chip": reuse that city's cache if it's
// still fresh (within DISCOVERY_CACHE_TTL_MS), otherwise actually call Gemini.
function loadCityFromCacheOrFetch(city) {
  const cached = loadCityEntry(city);
  if (isCacheFresh(cached)) {
    discoveryState.city = city;
    discoveryState.items = cached.items;
    discoveryState.moreCount = cached.moreCount || 0;
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
    title = 'แตะลิมิต Gemini ฟรีชั่วคราว';
    hint = 'อาจเป็นลิมิตต่อนาทีหรือต่อวัน ระบบลองโมเดลสำรองแล้ว หากมีข้อมูลเดิมแอปจะแสดงจากแคชให้อัตโนมัติ ลองใหม่ภายหลัง';
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

// Splits the single Gemini response into sections client-side (rather than one API call per
// section, which the free-tier quota can't really afford), per the prompt's own request for a
// category mix.
function isShoppingOrFoodItem(item) {
  const text = [item.category, item.title].join(' ');
  return /ช้อปปิ้ง|ห้าง|ตลาด|ร้านค้า|มอลล์|อาหาร|ร้านอาหาร|คาเฟ่|ของกิน|ขนม|shopping|mall|market|food|restaurant|caf[eé]/i.test(text);
}

function isAnimeItem(item) {
  const text = [item.category, item.title].join(' ');
  return /อนิเมะ|อนิเม|มังงะ|การ์ตูน|โอตาคุ|คอสเพลย์|ฟิกเกอร์|กาชาปอง|เมดคาเฟ่|เกมเซ็นเตอร์|คอลแลบ|ป็อปอัพ|anime|manga|otaku|cosplay|figure|gashapon|gacha|doujin|arcade|maid caf|collab|collaboration|pop.?up|sega|gigo|bandai namco|capcom|nintendo|akihabara|nakano broadway|animate|pok[eé]mon|ghibli|jump shop/i.test(text);
}

// Order matters: an anime figure shop matches the shopping regex too, so anime is tested first and
// every item lands in exactly one section. The last group is the catch-all.
const DISCOVERY_GROUPS = [
  { id: 'anime', title: 'เกม อนิเมะ & คอลแลบ', match: isAnimeItem },
  { id: 'shop', title: 'ช้อปปิ้ง & ของกินแนะนำ', match: isShoppingOrFoodItem },
  { id: 'other', title: 'เทศกาลและธรรมชาติแนะนำ', soloTitle: 'กิจกรรมแนะนำ', match: () => true }
];

function discoveryGroupIdFor(item) {
  return DISCOVERY_GROUPS.find((group) => group.match(item)).id;
}

function verificationUrlFor(item) {
  const query = [item.title, item.area, item.city, 'official opening hours event'].filter(Boolean).join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(query);
}

function discoveryAvailabilityLabel(item) {
  if (item.availability_status === 'permanent') return 'สถานที่ถาวร · เช็กสถานะวันนี้';
  return 'AI แนะนำ · เช็กสถานะวันนี้';
}

function discoveryCardMarkup(item) {
  return `
    <article class="discovery-card">
      <div class="discovery-card__media" data-img-place="${esc(item.map_query || item.title || '')}">
        <span class="discovery-card__tag">${esc(item.category)}</span>
      </div>
      <div class="discovery-card__body">
        <h3>${esc(item.title)}</h3>
        <p class="discovery-card__meta">${esc([item.area, item.best_time].filter(Boolean).join(' · '))}</p>
        <div class="discovery-card__verified"><span>○ ${esc(discoveryAvailabilityLabel(item))}</span><button data-url="${safeUrl(verificationUrlFor(item))}">เช็กวันนี้ ↗</button></div>
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
  const sections = DISCOVERY_GROUPS
    .map((group) => ({ group, items: discoveryState.items.filter((item) => discoveryGroupIdFor(item) === group.id) }))
    .filter((section) => section.items.length);
  return sections
    .map(({ group, items }) => discoverySectionMarkup(group.id, sections.length === 1 ? (group.soloTitle || group.title) : group.title, items))
    .join('');
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
    <p class="discovery-subtitle">${discoveryState.useMyLocation ? `กิจกรรมใกล้ตำแหน่งคุณ (ใกล้ ${esc(city || '')} ที่สุด)` : `กิจกรรมใกล้ ${esc(city || '')}`} · AI ไม่ได้ตรวจเว็บสด กรุณาเช็กก่อนเดินทาง</p>
    ${key ? `<div class="filter-row">
      <button class="${discoveryState.useMyLocation ? 'active' : ''}" data-discovery-near-me aria-pressed="${discoveryState.useMyLocation}">📍 ใกล้ฉัน</button>
      ${cities.map((c) => `<button class="${!discoveryState.useMyLocation && city === c ? 'active' : ''}" data-discovery-city="${c}" aria-pressed="${!discoveryState.useMyLocation && city === c}">${c}</button>`).join('')}
    </div>` : ''}
    ${!key ? geminiSetupCard() : discoveryState.loading ? discoveryLoadingMarkup() : discoveryState.error ? discoveryErrorMarkup() : discoveryCarouselMarkup()}
  `;
  document.querySelectorAll('[data-discovery-track]').forEach((track) => {
    track.addEventListener('scroll', () => {
      updateDiscoveryDots(track);
      maybeLoadMoreDiscovery(track);
    }, { passive: true });
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
        ${items.map((item, index) => `<span class="discover-card__slide" data-img-place="${esc(item.map_query || item.title || '')}" style="animation-delay:${index * -3.4}s"></span>`).join('')}
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

  const nearMeChip = target.closest('[data-discovery-near-me]');
  if (nearMeChip) {
    useMyLocationForDiscovery();
    return;
  }

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
