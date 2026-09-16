// Kept in its own module so the native app's copy (mobile/src/lib/scripts.ts)
// can be checked against it — see shared/scripts-compat.test.js.
//
// Recognition scripts. There is no real script *detection* here — "Latin +
// CJK" is a fixed model, not a classifier, so it reads Arabic/Cyrillic/etc as
// garbage rather than switching to them automatically. The label says exactly
// what it covers so that isn't a surprise; picking the right script below is
// the reliable path for anything else. Every model also reads Latin, so mixed
// text (English + Russian, English + Greek…) works once the non-Latin script
// is picked. The choice is remembered, so a book only needs picking once.
export const SCRIPTS = [
  { id: 'auto', label: 'Latin + CJK', hint: 'English, Spanish, French… plus Chinese, Japanese, Korean. Not Arabic, Hebrew, Cyrillic, or other scripts — pick those below.' },
  { id: 'fast', label: 'Latin + CJK — faster', hint: 'same coverage, about twice as quick, misreads more' },
  { id: 'cyrillic', label: 'Cyrillic', hint: 'Русский, Українська, Български + Latin' },
  { id: 'greek', label: 'Greek', hint: 'Ελληνικά + Latin' },
  { id: 'arabic', label: 'Arabic', hint: 'العربية, فارسی, اردو + Latin' },
  { id: 'devanagari', label: 'Devanagari', hint: 'हिन्दी, मराठी, नेपाली + Latin' },
  { id: 'korean', label: 'Korean', hint: '한국어 + Latin' },
  { id: 'japanese', label: 'Japanese', hint: '日本語 + Latin' },
  { id: 'thai', label: 'Thai', hint: 'ไทย + Latin' },
  { id: 'tamil', label: 'Tamil', hint: 'தமிழ் + Latin' },
  { id: 'telugu', label: 'Telugu', hint: 'తెలుగు + Latin' },
];
export const scriptLabel = (id) => SCRIPTS.find((s) => s.id === id)?.label ?? 'Latin + CJK';
