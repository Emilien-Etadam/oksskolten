import type { EnrichStep } from './types.js'
import { quality } from './quality.js'
import { interests } from './interests.js'
import { rules } from './rules.js'
import { aiQueue } from './ai-queue.js'
import { aiFilter } from './ai-filter.js'
import { similarity } from './similarity.js'

export const enrichSteps: EnrichStep[] = [quality, interests, rules, aiQueue, aiFilter, similarity]
