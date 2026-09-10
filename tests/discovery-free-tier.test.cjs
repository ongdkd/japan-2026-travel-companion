const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'discovery.js'), 'utf8');
const storage = new Map();
const sandbox = {
  AbortController,
  URL,
  clearTimeout,
  console,
  setTimeout,
  DATA: { trip: { name: 'Test trip', startDate: '2026-10-01', endDate: '2026-10-10' }, itinerary: [] },
  document: { addEventListener() {} },
  localStorage: {
    getItem(key) { return storage.get(key) || null; },
    removeItem(key) { storage.delete(key); },
    setItem(key, value) { storage.set(key, value); }
  },
  navigator: {},
  window: {},
  isoDate: () => '2026-09-10',
  japanToday: () => new Date('2026-09-10T00:00:00Z'),
  safeUrl: (value) => value || '#'
};
vm.createContext(sandbox);
vm.runInContext(source + `\n;globalThis.__test = {
  GEMINI_MODEL_CANDIDATES, DISCOVERY_CACHE_TTL_MS, MAX_DISCOVERY_LOAD_MORE,
  buildDiscoveryPrompt, callGeminiModel, isUsableDiscoveryItem, verificationUrlFor
};`, sandbox);

(async () => {
  const apiCall = {};
  sandbox.fetch = async (url, options) => {
    apiCall.url = url;
    apiCall.body = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { candidates: [{ content: { parts: [{ text: '[{"title":"GiGO","category":"อนิเมะ","city":"Tokyo","description":"Arcade","availability_status":"permanent"}]' }] } }] };
      }
    };
  };

  const test = sandbox.__test;
  const result = await test.callGeminiModel(test.buildDiscoveryPrompt('Tokyo'), 'test-key', test.GEMINI_MODEL_CANDIDATES[0]);
  assert.equal(test.GEMINI_MODEL_CANDIDATES[0], 'gemini-3.1-flash-lite', 'Flash Lite must be tried first');
  assert.equal(test.DISCOVERY_CACHE_TTL_MS, 24 * 60 * 60 * 1000, 'city cache must last one day');
  assert.equal(test.MAX_DISCOVERY_LOAD_MORE, 0, 'scrolling must not spend free quota');
  assert.equal(apiCall.body.tools, undefined, 'free-tier requests must not enable paid Search Grounding');
  assert.equal(apiCall.body.generationConfig.temperature, 0.2, 'generation should favor consistent results');
  assert.equal(result[0].title, 'GiGO');
  assert(test.isUsableDiscoveryItem(result[0]), 'permanent suggestions should be accepted');
  assert(!test.isUsableDiscoveryItem({ title: 'Unverified event', availability_status: 'upcoming' }), 'unverified timed events should be rejected');
  assert(test.verificationUrlFor(result[0]).startsWith('https://www.google.com/search?q='), 'cards must offer a current-status search');
  assert(source.includes('controller.abort(), 20000'), 'requests must time out instead of hanging forever');
  assert(source.includes('AI ไม่ได้ตรวจเว็บสด กรุณาเช็กก่อนเดินทาง'), 'UI must not claim live verification');

  console.log('Discovery free-tier safeguards: OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
