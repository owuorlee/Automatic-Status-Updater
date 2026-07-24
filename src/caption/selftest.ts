/**
 * Verifies the caption service without any network/API key.
 * Run: npm run test:caption
 */
import { generateCaption } from './service.js';
import type { CaptionRequest, CaptionTransport } from './types.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const base: CaptionRequest = {
  productName: 'Sunlight Bar Soap 200g',
  priceText: 'KSh 65',
  category: 'Household',
  language: 'english',
  emojiDensity: 2,
};

async function main() {
  console.log('Caption service self-test\n');

  console.log('Fallback (mock mode) across languages:');
  for (const language of ['english', 'swahili', 'sheng', 'mixed'] as const) {
    const r = await generateCaption({ ...base, language }, { mode: 'mock' });
    check(
      `[${language}] fallback, has price, <=200: "${r.text}"`,
      r.source === 'fallback' && r.text.includes('65') && r.text.length <= 200 && r.text.length > 0,
    );
  }

  console.log('\nControls respected:');
  const noPrice = await generateCaption({ ...base, includePrice: false }, { mode: 'mock' });
  check('includePrice=false omits price', !noPrice.text.includes('65'));
  const noEmoji = await generateCaption({ ...base, emojiDensity: 0 }, { mode: 'mock' });
  check('emojiDensity=0 strips emojis', !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(noEmoji.text), noEmoji.text);
  const short = await generateCaption({ ...base, maxLength: 40 }, { mode: 'mock' });
  check('maxLength enforced', short.text.length <= 40, `len=${short.text.length}`);

  console.log('\nVariation:');
  const v0 = await generateCaption({ ...base, variationIndex: 0 }, { mode: 'mock' });
  const v1 = await generateCaption({ ...base, variationIndex: 1 }, { mode: 'mock' });
  check('different variationIndex => different text', v0.text !== v1.text, `${v0.text} | ${v1.text}`);

  console.log('\nAI path (injected transport, no network):');
  const okTransport: CaptionTransport = async () => '  "Fresh & clean! Sunlight 200g at KSh 65 🧼 DM to order."  ';
  const aiOk = await generateCaption(base, { mode: 'auto', apiKey: 'test-key', transport: okTransport });
  check('AI success => source ai, quotes trimmed', aiOk.source === 'ai' && !aiOk.text.startsWith('"'), aiOk.text);

  const throwTransport: CaptionTransport = async () => {
    throw new Error('503 overloaded');
  };
  const aiFail = await generateCaption(base, { mode: 'auto', apiKey: 'test-key', transport: throwTransport });
  check('AI error => graceful fallback', aiFail.source === 'fallback' && aiFail.reason?.startsWith('api-error') === true, aiFail.reason);

  const hangTransport: CaptionTransport = () => new Promise(() => {});
  const aiTimeout = await generateCaption(base, { mode: 'auto', apiKey: 'test-key', transport: hangTransport, timeoutMs: 50 });
  check('AI timeout => graceful fallback', aiTimeout.source === 'fallback' && aiTimeout.reason === 'timeout', aiTimeout.reason);

  console.log('\nNever throws (empty AI response degrades):');
  const emptyTransport: CaptionTransport = async () => '   ';
  const aiEmpty = await generateCaption(base, { mode: 'auto', apiKey: 'test-key', transport: emptyTransport });
  check('empty AI text => fallback', aiEmpty.source === 'fallback');

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('✅ Caption service OK (fallback + AI paths + graceful degradation).');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
