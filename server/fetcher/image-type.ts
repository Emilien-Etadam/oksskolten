/**
 * Tell an image's real format from its first bytes. The URL's extension is
 * not enough: Blogger (googleusercontent) and other CDNs re-encode pictures
 * and keep the original name, so a `photo.png` can arrive as JPEG or WebP,
 * and a host that refuses a download may still answer 200 with an HTML page.
 */
export interface ImageType {
  ext: string
  mime: string
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  return bytes.every((b, i) => buf[offset + i] === b)
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end))
}

export function sniffImageType(buf: Uint8Array): ImageType | null {
  if (startsWith(buf, PNG)) return { ext: '.png', mime: 'image/png' }
  if (startsWith(buf, JPEG)) return { ext: '.jpg', mime: 'image/jpeg' }
  if (buf.length >= 6 && (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a')) {
    return { ext: '.gif', mime: 'image/gif' }
  }
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') {
    return { ext: '.webp', mime: 'image/webp' }
  }
  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12)
    if (brand === 'avif' || brand === 'avis') return { ext: '.avif', mime: 'image/avif' }
  }
  // SVG is text: look for the root element near the start, past any XML
  // prolog, comments or doctype
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, 1024)).trimStart().toLowerCase()
  if ((head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<!doctype svg')) && head.includes('<svg')) {
    return { ext: '.svg', mime: 'image/svg+xml' }
  }
  return null
}
