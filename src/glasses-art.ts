import { zlibSync } from 'fflate'

export type PixelArt = { width: number; height: number; rects: [number, number, number, number, number][] }
export type PixelIcon = 'train' | 'transfer' | 'exit' | 'mic' | 'check' | 'route'
const icons: Record<PixelIcon, string[]> = {
  train: ['0011111100','0111111110','0100000010','0101101010','0101101010','0100000010','0111111110','0101001010','0011111100','0010000100','0100000010'],
  transfer: ['0000001000','1111111100','0000001000','0000000000','0001000000','0011111111','0001000000'],
  exit: ['1111100000','1000100000','1000100100','1000111110','1000100100','1000100000','1111100000'],
  mic: ['0001110000','0010001000','0010001000','0010001000','1010001010','1001110010','0100000100','0011111000','0000100000','0011111000'],
  check: ['0000000010','0000000100','0000001000','1000010000','0100100000','0011000000'],
  route: ['1110000000','1011111100','1110000100','0000000100','0011111100','0010000000','0010001110','0011111010','0000001110'],
}
export function pixelIcon(kind: PixelIcon): PixelArt {
  const rects: PixelArt['rects'] = []
  const rows = icons[kind], top = Math.floor((24 - rows.length * 2) / 2)
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '1') rects.push([2 + x * 2, top + y * 2, 2, 2, 255]) }))
  return { width: 24, height: 24, rects }
}

// Standard grayscale PNG, not raw sensor data. Even's host decodes it into its
// native image format. Pure pixels keep the small assets crisp and testable.
function crc(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) { value ^= byte; for (let b = 0; b < 8; b++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0) }
  return (value ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
  view.setUint32(0, data.length); [...type].forEach((c, i) => { bytes[4 + i] = c.charCodeAt(0) })
  bytes.set(data, 8); view.setUint32(bytes.length - 4, crc(bytes.subarray(4, -4)))
  return bytes
}
export function artPng(art: PixelArt): Uint8Array {
  const { width, height } = art
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 20 || width > 288 || height < 20 || height > 144) throw new Error('Invalid G2 image dimensions.')
  const raw = new Uint8Array((width + 1) * height)
  for (const [x, y, w, h, shade] of art.rects) {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) {
      for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) raw[row * (width + 1) + 1 + col] = shade
    }
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())]
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0
  for (const part of parts) { png.set(part, offset); offset += part.length }
  return png
}
