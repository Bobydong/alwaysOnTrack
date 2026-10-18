// Run alongside Vite if desired, with only authenticated APIs exposed publicly.
if (!/^[a-f0-9]{64}$/.test(process.env.DEMO_ACCESS_TOKEN || '')) throw new Error('Run beta:configure before starting the beta backend.')
process.env.DEMO_API_ONLY = '1'
process.env.PORT ||= process.env.BETA_PORT || '5174'
await import('./index.mjs')
