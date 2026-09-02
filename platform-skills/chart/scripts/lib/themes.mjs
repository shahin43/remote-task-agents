/**
 * Theme loading for chart-skill.
 * Resolves themes from built-in themes/ dir and user's ~/.chart-skill/themes/
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILTIN_THEMES_DIR = join(__dirname, '..', '..', 'themes')
const USER_THEMES_DIR = join(homedir(), '.chart-skill', 'themes')

/**
 * Load a theme by name. Checks built-in themes first, then user themes.
 * @param {string} name - Theme name (without .json extension)
 * @returns {{ name, font, primaryColor, categoryPalette, variants }}
 */
export function loadTheme(name) {
  const paths = [
    join(BUILTIN_THEMES_DIR, `${name}.json`),
    join(USER_THEMES_DIR, `${name}.json`),
  ]

  for (const p of paths) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8'))
    }
  }

  throw new Error(
    `Theme "${name}" not found. Available: ${listThemes().join(', ')}`,
  )
}

/**
 * List all available theme names (built-in + user).
 */
export function listThemes() {
  const themes = new Set()

  for (const dir of [BUILTIN_THEMES_DIR, USER_THEMES_DIR]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json')) themes.add(f.replace('.json', ''))
    }
  }

  return [...themes].sort()
}
