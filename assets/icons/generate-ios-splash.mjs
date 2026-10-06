#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const SIZE = 2732
const OUTPUTS = [
  'splash-2732x2732-2.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732.png',
]
const here = path.dirname(fileURLToPath(import.meta.url))
const defaultOutput = path.resolve(here, '../../native/ios/App/App/Assets.xcassets/Splash.imageset')
const outputIndex = process.argv.indexOf('--output')
const outputDir = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : defaultOutput

const pixels = Buffer.alloc(SIZE * SIZE * 3)
const set = (x, y, color) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const offset = (Math.floor(y) * SIZE + Math.floor(x)) * 3
  pixels[offset] = color[0]
  pixels[offset + 1] = color[1]
  pixels[offset + 2] = color[2]
}
const ellipse = (cx, cy, rx, ry, color) => {
  for (let y = Math.max(0, cy - ry); y <= Math.min(SIZE - 1, cy + ry); y++) {
    const dy = (y - cy) / ry
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - dy * dy)))
    for (let x = cx - half; x <= cx + half; x++) set(x, y, color)
  }
}
const polygon = (points, color) => {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))))
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(...points.map((point) => point[1]))))
  for (let y = minY; y <= maxY; y++) {
    const crossings = []
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length]
      if ((point[1] <= y && next[1] > y) || (next[1] <= y && point[1] > y)) {
        crossings.push(point[0] + ((y - point[1]) * (next[0] - point[0])) / (next[1] - point[1]))
      }
    })
    crossings.sort((a, b) => a - b)
    for (let index = 0; index < crossings.length; index += 2) {
      for (let x = Math.ceil(crossings[index]); x <= Math.floor(crossings[index + 1]); x++) set(x, y, color)
    }
  }
}
const line = (x1, y1, x2, y2, radius, color) => {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / Math.max(2, radius)
  for (let index = 0; index <= steps; index++) {
    const t = index / steps
    ellipse(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), radius, radius, color)
  }
}

for (let y = 0; y < SIZE; y++) {
  const vertical = y / (SIZE - 1)
  for (let x = 0; x < SIZE; x++) {
    const horizontal = x / (SIZE - 1)
    const glow = Math.max(0, 1 - Math.hypot(horizontal - 0.42, vertical - 0.18) * 1.45)
    const offset = (y * SIZE + x) * 3
    pixels[offset] = Math.round(3 + 2 * glow)
    pixels[offset + 1] = Math.round(26 + 52 * glow + 16 * vertical)
    pixels[offset + 2] = Math.round(55 + 91 * glow + 37 * vertical)
  }
}

const coralDark = [9, 35, 58]
const coralMid = [18, 59, 77]
ellipse(2510, 2380, 540, 660, coralDark)
ellipse(2240, 2500, 430, 420, coralMid)
ellipse(230, 2500, 390, 350, coralDark)
for (let index = 0; index < 12; index++) {
  const x = 2140 + (index % 4) * 125
  const y = 2300 - Math.floor(index / 4) * 145
  line(x, 2540, x + (index % 2 ? 45 : -30), y, 24, [25, 78, 91])
  ellipse(x + (index % 2 ? 45 : -30), y, 42, 34, [100, 87, 151])
}
for (let index = 0; index < 16; index++) {
  const x = 160 + index * 160
  const y = 350 + (index % 4) * 115
  ellipse(x, y, 13 + (index % 3) * 6, 13 + (index % 3) * 6, [110, 205, 224])
  ellipse(x - 5, y - 5, 4, 4, [221, 250, 255])
}

polygon([[780, 1380], [495, 1090], [560, 1380], [495, 1670]], [21, 29, 38])
polygon([[748, 1380], [530, 1150], [585, 1380], [530, 1610]], [226, 93, 28])
polygon([[1160, 1135], [1330, 910], [1490, 1165]], [15, 24, 34])
polygon([[1180, 1150], [1320, 960], [1435, 1180]], [225, 95, 27])
polygon([[1110, 1620], [1300, 1830], [1465, 1595]], [15, 24, 34])
polygon([[1165, 1590], [1300, 1765], [1410, 1580]], [225, 95, 27])

const bodyCx = 1430, bodyCy = 1380, bodyRx = 670, bodyRy = 390
for (let y = bodyCy - bodyRy; y <= bodyCy + bodyRy; y++) {
  for (let x = bodyCx - bodyRx; x <= bodyCx + bodyRx; x++) {
    const dx = (x - bodyCx) / bodyRx
    const dy = (y - bodyCy) / bodyRy
    if (dx * dx + dy * dy > 1) continue
    const light = Math.max(0, 1 - Math.abs(dy + 0.35) * 1.2)
    let color = [Math.round(205 + 37 * light), Math.round(70 + 48 * light), 20]
    if ((dx > -0.42 && dx < -0.30) || (dx > 0.38 && dx < 0.52)) color = [16, 24, 32]
    if ((dx > -0.37 && dx < -0.24) || (dx > 0.43 && dx < 0.59)) color = [232, 242, 232]
    set(x, y, color)
  }
}
ellipse(1900, 1290, 64, 72, [238, 244, 230])
ellipse(1905, 1300, 40, 47, [9, 17, 25])
ellipse(1891, 1284, 12, 14, [240, 250, 255])
line(2018, 1450, 2090, 1440, 10, [19, 26, 33])
polygon([[1510, 1440], [1690, 1500], [1510, 1580]], [15, 24, 34])
polygon([[1525, 1455], [1650, 1502], [1520, 1550]], [216, 87, 24])

const glyphs = {
  A: ['01110','10001','10001','11111','10001','10001','10001'], C: ['01111','10000','10000','10000','10000','10000','01111'],
  E: ['11111','10000','10000','11110','10000','10000','11111'], I: ['11111','00100','00100','00100','00100','00100','11111'],
  K: ['10001','10010','10100','11000','10100','10010','10001'], M: ['10001','11011','10101','10101','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'], P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'], R: ['11110','10001','10001','11110','10100','10010','10001'],
  T: ['11111','00100','00100','00100','00100','00100','00100'], U: ['10001','10001','10001','10001','10001','10001','01110'],
}
const text = (value, y, scale, color) => {
  const width = value.length * 6 * scale - scale
  const startX = Math.floor((SIZE - width) / 2)
  for (let letter = 0; letter < value.length; letter++) {
    const rows = glyphs[value[letter]]
    rows.forEach((row, rowIndex) => [...row].forEach((bit, column) => {
      if (bit === '1') polygon([[startX + (letter * 6 + column) * scale, y + rowIndex * scale], [startX + (letter * 6 + column + 1) * scale - 2, y + rowIndex * scale], [startX + (letter * 6 + column + 1) * scale - 2, y + (rowIndex + 1) * scale - 2], [startX + (letter * 6 + column) * scale, y + (rowIndex + 1) * scale - 2]], color)
    }))
  }
}
text('POCKET', 1940, 35, [235, 250, 251])
text('AQUARIUM', 2220, 28, [111, 222, 211])

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const name = Buffer.from(type)
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  name.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return result
}
const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3)
const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0); header.writeUInt32BE(SIZE, 4); header[8] = 8; header[9] = 2
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9, strategy: zlib.constants.Z_FIXED })), chunk('IEND', Buffer.alloc(0))])
fs.mkdirSync(outputDir, { recursive: true })
for (const output of OUTPUTS) fs.writeFileSync(path.join(outputDir, output), png)
console.log(`Generated ${OUTPUTS.length} original ${SIZE}x${SIZE} RGB splash images in ${outputDir}`)
