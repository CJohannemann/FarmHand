// Rebuilds the raster favicons from the same geometry as public/favicon.svg.
//
//   node tools/icon/build-icons.mjs
//
// There is no ImageMagick/rsvg dependency here on purpose — raster.mjs
// rasterises and encodes PNG/ICO itself, so this runs anywhere Node does.
//
// public/favicon.svg is hand-written, not generated, because an SVG built
// from these primitives is cleaner by hand than anything worth generating.
// It uses the identical numbers; change one and change the other, or the
// vector and raster icons drift apart.
import { hex, roundRect, circle, polygon, render, png, dib, ico } from './raster.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const GREEN = hex('#3f7d3f')   // --accent, src/index.css
const CREAM = hex('#f4f1e6')

// A barn: gambrel roof (the two-pitch break is what separates it from a
// house at 16px) with the doorway knocked back out to the tile colour so
// it stays a visible notch rather than filling in.
const BARN = polygon([[12,52],[12,35],[18,26],[32,19],[46,26],[52,35],[52,52]])

// The door is a half-disc on a plain rect, which is exactly the SVG's
// `a7 7 0 0 1 14 0` arch — same shape, two renderers.
const mark = (radius) => ([
  { test: roundRect(0,0,64,64,radius), rgb: GREEN },
  { test: BARN, rgb: CREAM },
  { test: circle(32,42,7), rgb: GREEN },
  { test: roundRect(25,42,14,10,0), rgb: GREEN },
])

const OUT = process.argv[2] ?? fileURLToPath(new URL('../../public/', import.meta.url))

// 16/32/48 as BMP entries rather than PNG-in-ICO: browsers accept either,
// but Windows only reliably renders PNG inside an .ico at 256px.
fs.writeFileSync(path.join(OUT, 'favicon.ico'),
  ico([16,32,48].map((size) => ({ size, data: dib(render(mark(14), size), size) }))))

// Square corners: iOS applies its own mask, and a pre-rounded tile shows
// as a double-rounded corner inside it.
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(render(mark(0), 180), 180))

console.log('wrote favicon.ico and apple-touch-icon.png to ' + OUT)
