/**
 * Article classification: a fixed list of formats (what kind of piece it is)
 * and a reader-editable list of themes (what it is about). Both are closed
 * choices answered by a local language model, one token each (notjev).
 *
 * `id` is what the database stores and the query language filters on
 * (`format:question`, `theme:ai`); `description` is what the model reads.
 */
export interface ClassOption {
  id: string
  label: string
  description: string
}

export const FORMATS: ClassOption[] = [
  { id: 'NEWS', label: 'News', description: 'news or current event: reports what happened, including product launches and company news' },
  { id: 'QUESTION', label: 'Question', description: 'the author asks for help, advice or a recommendation for their own situation' },
  { id: 'DISCUSSION', label: 'Discussion', description: 'the author opens a debate or asks the community what they think' },
  { id: 'OPINION', label: 'Opinion', description: 'analysis, opinion or editorial: the author argues a point of view' },
  { id: 'GUIDE', label: 'Guide', description: 'tutorial, how-to or guide: teaches how to do something' },
  { id: 'REVIEW', label: 'Review', description: 'review or hands-on experience of a product, service or work' },
  { id: 'RELEASE', label: 'Release', description: 'new version of a software or project: release notes, changelog' },
  { id: 'STORY', label: 'Story', description: 'personal story or testimony told by the author' },
  { id: 'RESOURCE', label: 'Resource', description: 'resource or tool: a list, a link collection, a dataset, a project' },
  { id: 'ENTERTAINMENT', label: 'Entertainment', description: 'entertainment, humor or meme' },
  { id: 'OTHER', label: 'Other', description: 'none of the above' },
]

export const DEFAULT_THEMES: ClassOption[] = [
  { id: '3D', label: '3D', description: '3D modeling, 3D printing, CAD, rendering' },
  { id: 'COMICS', label: 'Comics', description: 'comics, graphic novels, manga, European comic albums' },
  { id: 'AUTO', label: 'Auto', description: 'cars, electric vehicles, charging, automotive industry' },
  { id: 'LUXURY', label: 'Jewelry & Luxury', description: 'jewelry, watches, fashion, beauty and luxury brands' },
  { id: 'COMPUTING', label: 'Computing', description: 'computers, software, operating systems, development, networking, security' },
  { id: 'AI', label: 'AI', description: 'artificial intelligence, language models, machine learning, AI hardware' },
  { id: 'MOBILE', label: 'Mobile & Gadgets', description: 'smartphones, tablets, chips for phones, headphones and consumer gadgets' },
  { id: 'GAMING', label: 'Video games', description: 'video games, consoles, game studios' },
  { id: 'SOCIETY', label: 'Society & Economy', description: 'society, economy, health, politics, justice' },
  { id: 'OTHER', label: 'Other', description: 'none of the above' },
]

/** notjev reads one letter per option: A..Z */
export const MAX_THEMES = 26

export const DEFAULT_FORMAT_THETA = 0.5
export const DEFAULT_THEME_THETA = 0.3

/** Normalize a user-typed id: uppercase, letters/digits/underscore only. */
export function normalizeClassId(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

export interface ClassificationSettings {
  enabled: boolean
  /** Model name on the vLLM (OpenAI-compatible) server; empty = summary model */
  model: string
  formatTheta: number
  themeTheta: number
  themes: ClassOption[]
  /** Replace feed categories with themes in the sidebar and the tab bar */
  hideCategories: boolean
}

export interface ClassificationCount {
  id: string
  label: string
  unread_count: number
}

export interface ClassificationOverview {
  enabled: boolean
  /** enabled && hideCategories: the UI shows themes where it showed categories */
  hideCategories: boolean
  formats: ClassificationCount[]
  themes: ClassificationCount[]
  /** Active articles never classified (neither decided nor undecided) */
  unclassified: number
  /** Articles waiting in the classification queue */
  pending: number
}
