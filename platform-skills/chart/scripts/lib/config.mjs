/**
 * Config read/write for chart-skill.
 * Stores defaults at ~/.chart-skill/config.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const CONFIG_DIR = join(homedir(), '.chart-skill')
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const DEFAULTS = {
  defaultTheme: 'onsen',
  defaultSize: 'desktop',
  defaultVariant: 'light',
  outputDir: '.',
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}
