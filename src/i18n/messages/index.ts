import { common } from './common.js'
import { reading } from './reading.js'
import { feeds } from './feeds.js'
import { intelligence } from './intelligence.js'
import { chat } from './chat.js'
import { auth } from './auth.js'
import { settings } from './settings.js'

export const dict = {
  ...common,
  ...reading,
  ...feeds,
  ...intelligence,
  ...chat,
  ...auth,
  ...settings,
} as const
