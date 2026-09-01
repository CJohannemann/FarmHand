import zlib from 'node:zlib'
import fs from 'node:fs'

// ---------- tiny raster core ----------------------------------------------
// Shapes are predicates over a 64x64 design space, sampled with 8x8
// supersampling. Everything here maps 1:1 onto an SVG primitive, so the
// same geometry can be hand-written as vector art without redrawing it.
const S = 8

const hex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]

const roundRect = (x,y,w,h,r) => (px,py) => {
  if (px < x || py < y || px > x+w || py > y+h) return false
  const cx = Math.min(Math.max(px, x+r), x+w-r)
  const cy = Math.min(Math.max(py, y+r), y+h-r)
  return (px-cx)**2 + (py-cy)**2 <= r*r
}
const circle = (cx,cy,r) => (px,py) => (px-cx)**2 + (py-cy)**2 <= r*r
const capsule = (x1,y1,x2,y2,r) => (px,py) => {
  const dx = x2-x1, dy = y2-y1
  const L2 = dx*dx + dy*dy
  let t = L2 === 0 ? 0 : ((px-x1)*dx + (py-y1)*dy) / L2
  t = Math.min(1, Math.max(0, t))
  return (px - (x1+t*dx))**2 + (py - (y1+t*dy))**2 <= r*r
}
const polygon = (pts) => (px,py) => {
  let inside = false
  for (let i = 0, j = pts.length-1; i < pts.length; j = i++) {
    const [xi,yi] = pts[i], [xj,yj] = pts[j]
    if ((yi > py) !== (yj > py) && px < (xj-xi)*(py-yi)/(yj-yi) + xi) inside = !inside
  }
  return inside
}
const both = (a,b) => (px,py) => a(px,py) && b(px,py)
const not  = (a)   => (px,py) => !a(px,py)

// Render layers (painted in order) into an RGBA buffer of the given size.
function render(layers, size) {
  const buf = Buffer.alloc(size*size*4)
  const scale = 64 / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r=0,g=0,b=0,a=0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx+0.5)/S) * scale
          const py = (y + (sy+0.5)/S) * scale
          let col = null
          for (const L of layers) if (L.test(px,py)) col = L.rgb
          if (col) { r+=col[0]; g+=col[1]; b+=col[2]; a+=255 }
        }
      }
      const n = S*S, i = (y*size+x)*4
      if (a > 0) { const cov = a/n/255; buf[i]=Math.round(r/(a/255)); buf[i+1]=Math.round(g/(a/255)); buf[i+2]=Math.round(b/(a/255)); buf[i+3]=Math.round(cov*255) }
    }
  }
  return buf
}

// ---------- PNG ------------------------------------------------------------
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(rgba, w, h = w) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0
  const raw = Buffer.alloc(h*(w*4+1))
  for (let y = 0; y < h; y++) {
    raw[y*(w*4+1)] = 0
    rgba.copy(raw, y*(w*4+1)+1, y*w*4, (y+1)*w*4)
  }
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- ICO (BMP/DIB entries, widest compatibility) --------------------
function dib(rgba, size) {
  const hdr = Buffer.alloc(40)
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(size, 4); hdr.writeInt32LE(size*2, 8)
  hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14); hdr.writeUInt32LE(0, 16)
  const xor = Buffer.alloc(size*size*4)
  for (let y = 0; y < size; y++) {
    const src = (size-1-y)*size*4
    for (let x = 0; x < size; x++) {
      const s = src + x*4, d = (y*size+x)*4
      xor[d]=rgba[s+2]; xor[d+1]=rgba[s+1]; xor[d+2]=rgba[s]; xor[d+3]=rgba[s+3]
    }
  }
  const maskRow = Math.ceil(size/32)*4
  const and = Buffer.alloc(maskRow*size)   // all zero: alpha channel carries it
  hdr.writeUInt32LE(xor.length + and.length, 20)
  return Buffer.concat([hdr, xor, and])
}
function ico(images) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0,0); head.writeUInt16LE(1,2); head.writeUInt16LE(images.length,4)
  const dirs = [], datas = []
  let offset = 6 + images.length*16
  for (const { size, data } of images) {
    const d = Buffer.alloc(16)
    d[0] = size >= 256 ? 0 : size; d[1] = size >= 256 ? 0 : size
    d[2]=0; d[3]=0; d.writeUInt16LE(1,4); d.writeUInt16LE(32,6)
    d.writeUInt32LE(data.length, 8); d.writeUInt32LE(offset, 12)
    dirs.push(d); datas.push(data); offset += data.length
  }
  return Buffer.concat([head, ...dirs, ...datas])
}

export { hex, roundRect, circle, capsule, polygon, both, not, render, png, dib, ico }
