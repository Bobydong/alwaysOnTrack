export const axes = ['x', 'y', 'z'] as const
export type Axis = typeof axes[number]
export type Vector = Record<Axis, number | null>
export type Sample = Vector & { t: number; wallTime: string; label: string }
export type Mark = { t: number; wallTime: string; label: string }
export type PhoneMotionSample = {
  t: number
  wallTime: string
  label: string
  acceleration: Vector
  accelerationIncludingGravity: Vector
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null }
  interval: number | null
}

export function readVector(value: { x?: number | null; y?: number | null; z?: number | null }): Vector {
  const read = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : null
  return { x: read(value.x), y: read(value.y), z: read(value.z) }
}

export function summarize(samples: Sample[], axis: Axis) {
  const values = samples.map(s => s[axis]).filter((v): v is number => v !== null)
  if (!values.length) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return { n: values.length, mean, min: Math.min(...values), max: Math.max(...values),
    sd: Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) }
}

export function timing(samples: Sample[]) {
  const deltas = samples.slice(1).map((s, i) => s.t - samples[i].t).filter(d => d > 0)
  if (!deltas.length) return null
  return { hz: 1000 * deltas.length / deltas.reduce((a, b) => a + b, 0),
    largestGap: Math.max(...deltas) }
}

export function toCsv(samples: Sample[]) {
  const quote = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
  return ['receipt_ms,wall_time,x_raw,y_raw,z_raw,label', ...samples.map(s =>
    [s.t, s.wallTime, s.x, s.y, s.z, s.label].map(quote).join(','))].join('\r\n')
}

export function vectorMagnitude(value: Vector) {
  if (axes.some(axis => value[axis] === null)) return null
  return Math.hypot(value.x!, value.y!, value.z!)
}

export function phoneMotionFromEvent(event: DeviceMotionEvent, t: number, wallTime: string, label: string): PhoneMotionSample {
  const acceleration = readVector(event.acceleration ?? {})
  const accelerationIncludingGravity = readVector(event.accelerationIncludingGravity ?? {})
  const read = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    t, wallTime, label,
    acceleration,
    accelerationIncludingGravity,
    rotationRate: { alpha: read(event.rotationRate?.alpha), beta: read(event.rotationRate?.beta), gamma: read(event.rotationRate?.gamma) },
    interval: read(event.interval),
  }
}

export function phoneMotionCsv(samples: PhoneMotionSample[]) {
  const quote = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
  const header = 'source,receipt_ms,wall_time,label,accel_x,accel_y,accel_z,including_gravity_x,including_gravity_y,including_gravity_z,rotation_alpha,rotation_beta,rotation_gamma,event_interval_ms'
  return [header, ...samples.map(s => ['android-webview', s.t, s.wallTime, s.label,
    s.acceleration.x, s.acceleration.y, s.acceleration.z,
    s.accelerationIncludingGravity.x, s.accelerationIncludingGravity.y, s.accelerationIncludingGravity.z,
    s.rotationRate.alpha, s.rotationRate.beta, s.rotationRate.gamma, s.interval].map(quote).join(','))].join('\r\n')
}

export function combinedCsv(glasses: Sample[], phone: PhoneMotionSample[]) {
  const quote = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
  const header = 'source,receipt_ms,wall_time,label,g2_x,g2_y,g2_z,phone_linear_x,phone_linear_y,phone_linear_z,phone_including_gravity_x,phone_including_gravity_y,phone_including_gravity_z,rotation_alpha,rotation_beta,rotation_gamma,phone_event_interval_ms'
  const rows = [
    ...glasses.map(s => ({ t:s.t, values:['g2',s.t,s.wallTime,s.label,s.x,s.y,s.z,null,null,null,null,null,null,null,null,null,null] })),
    ...phone.map(s => ({ t:s.t, values:['phone',s.t,s.wallTime,s.label,null,null,null,
      s.acceleration.x,s.acceleration.y,s.acceleration.z,
      s.accelerationIncludingGravity.x,s.accelerationIncludingGravity.y,s.accelerationIncludingGravity.z,
      s.rotationRate.alpha,s.rotationRate.beta,s.rotationRate.gamma,s.interval] })),
  ].sort((a,b)=>a.t-b.t)
  return [header,...rows.map(row=>row.values.map(quote).join(','))].join('\r\n')
}
