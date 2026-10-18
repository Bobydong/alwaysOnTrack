import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GlassesSpeech, pcmToWav } from '../src/asr/stt.ts'
import { validateSpeechWav } from '../server/gemini.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('browser fetch keeps its global receiver during speech upload', async t => {
  const speech = new GlassesSpeech(async () => true, async function () {
    assert.equal(this, globalThis, 'Browser fetch rejects a speech controller as its receiver')
    return { ok: true, json: async () => ({ text: 'Wall Street to Bronx Zoo' }) }
  })
  t.after(() => speech.cancel())
  await speech.start(); speech.sendPcm(new Uint8Array(10000)); await speech.stop()
  assert.equal(speech.phase, 'idle')
  assert.equal(speech.snapshot().transcript, 'Wall Street to Bronx Zoo')
})

test('PCM chunks become a correctly sized 16 kHz mono PCM16 WAV', () => {
  const chunks = [new Uint8Array(4000).fill(7), new Uint8Array(4000).fill(8)]
  const wav = Buffer.from(pcmToWav(chunks)); validateSpeechWav(wav)
  assert.equal(wav.length, 8044); assert.equal(wav.readUInt32LE(24), 16000)
  assert.equal(wav[44], 7); assert.equal(wav[4044], 8)
  assert.throws(() => pcmToWav([new Uint8Array(3)]), /Incomplete PCM/)
})

test('stop closes the microphone before uploading audio; late PCM cannot leak into the request', async t => {
  const commands = []; let uploaded
  const speech = new GlassesSpeech(async open => { commands.push(open); return true }, async (url, options) => {
    assert.deepEqual(commands, [true, false]); assert.equal(url, '/api/speech/transcribe')
    uploaded = Buffer.from(await options.body.arrayBuffer()); validateSpeechWav(uploaded)
    return { ok: true, json: async () => ({ text: 'Times Square to Union Square' }) }
  })
  t.after(() => speech.cancel())
  await speech.start()
  const pcm = new Uint8Array(16000).fill(12); speech.sendPcm(pcm); pcm.fill(0)
  const stopped = speech.stop(); speech.sendPcm(new Uint8Array(1000))
  await stopped
  assert.equal(uploaded.length, 16044); assert.equal(uploaded[44], 12)
  assert.equal(speech.snapshot().transcript, 'Times Square to Union Square')
  assert.equal(speech.snapshot().micMayBeOn, false)
})

test('cancel while microphone is opening waits for it and closes it without submitting audio', async () => {
  const opening = deferred(); const commands = []
  const speech = new GlassesSpeech(open => { commands.push(open); return open ? opening.promise : Promise.resolve(true) }, () => assert.fail('Cancelled audio must not upload'))
  const started = speech.start(); speech.sendPcm(new Uint8Array(10000))
  const cancelled = speech.cancel(); assert.equal(speech.busy, true)
  opening.resolve(true); await Promise.all([started, cancelled])
  assert.deepEqual(commands, [true, false]); assert.equal(speech.phase, 'idle'); assert.equal(speech.snapshot().micMayBeOn, false)
})

test('a cancelled transcription ignores its eventual provider response', async () => {
  const response = deferred()
  const speech = new GlassesSpeech(async () => true, () => response.promise)
  await speech.start(); speech.sendPcm(new Uint8Array(10000))
  const stop = speech.stop(); await tick(); assert.equal(speech.phase, 'transcribing')
  await speech.cancel(); response.resolve({ ok: true, json: async () => ({ text: 'stale transcript' }) }); await stop
  assert.equal(speech.snapshot().revision, 0); assert.equal(speech.phase, 'idle')
})

test('recording is bounded to 30 seconds and microphone denial needs no API call', async t => {
  let uploads = 0
  const speech = new GlassesSpeech(async () => true, async (url, options) => {
    uploads++; assert.equal((await options.body.arrayBuffer()).byteLength, 960044)
    return { ok: true, json: async () => ({ text: 'A to B' }) }
  })
  t.after(() => speech.cancel())
  await speech.start(); speech.sendPcm(new Uint8Array(1000000)); await tick()
  assert.equal(speech.snapshot().seconds, 30); assert.equal(uploads, 1); assert.equal(speech.phase, 'idle')
  const denied = new GlassesSpeech(async open => !open, () => assert.fail('No recording to transcribe'))
  await denied.start(); assert.equal(denied.phase, 'error'); assert.equal(denied.snapshot().micMayBeOn, false)
})
