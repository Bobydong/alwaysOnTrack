// Render supplies PORT. Keep the private beta's API-only/authenticated behavior.
process.env.AI_PROVIDER ||= 'groq'
if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('Set GOOGLE_MAPS_API_KEY in Render environment settings.')
const aiKey = process.env.AI_PROVIDER === 'groq' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY
if (!aiKey) throw new Error('Set the selected AI provider key in Render environment settings.')
process.env.PORT ||= '10000'
process.env.REQUIRE_CATALOG = '1'
await import('./beta.mjs')
