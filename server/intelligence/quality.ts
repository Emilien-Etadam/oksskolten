/**
 * Heuristic article quality, 0..1. No model involved: the signals are the
 * ones a reader spots at a glance — a thin body, a clickbait or shouting
 * title, promotional markers, a body that is mostly links. The score is
 * one input to the front page and top stories ranking, never a filter.
 */
export interface QualityInput {
  title: string
  text: string | null
  url?: string
}

export type QualityFlag = 'thin' | 'clickbait' | 'shouting' | 'promotional' | 'link-heavy'

export interface QualityResult {
  score: number
  flags: QualityFlag[]
}

const CLICKBAIT_PATTERNS: RegExp[] = [
  /\byou won'?t believe\b/i,
  /\bthis is why\b/i,
  /\bwhat happened next\b/i,
  /\b(?:shocking|jaw-dropping|mind-blowing)\b/i,
  /\b\d+\s+(?:things|reasons|ways|tips|secrets|hacks)\b/i,
  /\bvous ne (?:devinerez|croirez) jamais\b/i,
  /\bvoici pourquoi\b/i,
  /\b(?:choquant|incroyable|hallucinant)\b/i,
  /\b\d+\s+(?:choses|raisons|façons|astuces|secrets)\b/i,
]

const PROMO_PATTERNS: RegExp[] = [
  /\bsponsored\b/i,
  /\bpartner content\b/i,
  /\baffiliate\b/i,
  /\bbuy now\b/i,
  /\b(?:promo|coupon|discount) code\b/i,
  /\b\d{2}\s?% off\b/i,
  /\bcode promo\b/i,
  /\bcontenu sponsoris/i,
  /\bpartenariat\b/i,
  /\boffre (?:spéciale|exclusive)\b/i,
]

const THIN_CHARS = 300
const SHORT_CHARS = 800
const LONG_CHARS = 3000

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function scoreArticleQuality(input: QualityInput): QualityResult {
  const flags: QualityFlag[] = []
  let score = 0.7
  const title = input.title.trim()
  const text = (input.text ?? '').trim()

  // Title signals
  const clickbaitHits = CLICKBAIT_PATTERNS.filter(re => re.test(title)).length
  if (clickbaitHits > 0) {
    score -= Math.min(0.3, 0.15 * clickbaitHits)
    flags.push('clickbait')
  }
  const words = title.split(/\s+/).filter(w => /\p{L}/u.test(w))
  if (words.length >= 3) {
    const shouting = words.filter(w => w.length > 2 && w === w.toUpperCase() && w !== w.toLowerCase()).length
    if (shouting / words.length > 0.5) {
      score -= 0.1
      flags.push('shouting')
    }
  }
  const bangs = (title.match(/!/g) ?? []).length
  if (bangs > 0) score -= Math.min(0.1, 0.05 * bangs)

  // Promotional markers in the title or the opening of the body
  const head = `${title}\n${text.slice(0, 600)}`
  if (PROMO_PATTERNS.some(re => re.test(head))) {
    score -= 0.2
    flags.push('promotional')
  }

  // Body length
  if (text.length < THIN_CHARS) {
    score -= 0.2
    flags.push('thin')
  } else if (text.length < SHORT_CHARS) {
    score -= 0.1
  } else if (text.length > LONG_CHARS) {
    score += 0.1
  }

  // Link density (markdown links per word)
  if (text.length >= THIN_CHARS) {
    const links = (text.match(/\]\(https?:\/\//g) ?? []).length
    const wordCount = text.split(/\s+/).length
    if (wordCount > 0 && links / wordCount > 0.05) {
      score -= 0.1
      flags.push('link-heavy')
    }
  }

  return { score: Math.round(clamp01(score) * 100) / 100, flags }
}
