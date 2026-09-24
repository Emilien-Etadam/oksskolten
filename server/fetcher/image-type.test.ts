import { describe, it, expect } from 'vitest'
import { sniffImageType } from './image-type.js'

const bytes = (...b: number[]) => Uint8Array.from(b)
const text = (s: string) => new TextEncoder().encode(s)

describe('sniffImageType', () => {
  it('recognises the raster formats by their signature', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.mime).toBe('image/png')
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe1))?.mime).toBe('image/jpeg')
    expect(sniffImageType(text('GIF89a....'))?.mime).toBe('image/gif')
    expect(sniffImageType(text('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp')
    expect(sniffImageType(text('\0\0\0\x1cftypavif\0\0'))?.mime).toBe('image/avif')
  })

  it('recognises SVG documents', () => {
    expect(sniffImageType(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.ext).toBe('.svg')
    expect(sniffImageType(text('  <svg viewBox="0 0 1 1"></svg>'))?.ext).toBe('.svg')
  })

  it('rejects anything else', () => {
    expect(sniffImageType(text('<!DOCTYPE html><html></html>'))).toBeNull()
    expect(sniffImageType(text('{"error":"forbidden"}'))).toBeNull()
    expect(sniffImageType(bytes())).toBeNull()
  })
})
