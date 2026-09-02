#!/usr/bin/env node
/**
 * Interactive setup wizard for chart-skill.
 * Installs dependencies and configures defaults.
 */
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { createInterface } from 'readline'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { loadConfig, saveConfig, CONFIG_FILE } from './lib/config.mjs'
import { listThemes } from './lib/themes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = join(__dirname, '..')

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((resolve) => rl.question(q, resolve))

async function main() {
  console.log('\n  Chart Skill Setup\n')

  // 1. Check Node.js version
  const nodeVersion = process.versions.node
  const major = parseInt(nodeVersion.split('.')[0], 10)
  if (major < 18) {
    console.log(`  ✗ Node.js ${nodeVersion} — version 18+ required`)
    process.exit(1)
  }
  console.log(`  ✓ Node.js ${nodeVersion}`)

  // 2. Install dependencies
  const nodeModules = join(SKILL_ROOT, 'node_modules')
  if (!existsSync(nodeModules)) {
    console.log('\n  Installing dependencies (vega, vega-lite, js-yaml)...')
    try {
      execSync('npm install --production', { cwd: SKILL_ROOT, stdio: 'inherit' })
      console.log('  ✓ Dependencies installed')
    } catch {
      console.log('  ✗ npm install failed — check your Node.js setup')
      process.exit(1)
    }
  } else {
    console.log('  ✓ Dependencies already installed')
  }

  // 3. Configure defaults
  const config = loadConfig()
  const themes = listThemes()

  console.log(`\n  Available themes: ${themes.join(', ')}`)
  const themeAnswer = await ask(`  Default theme [${config.defaultTheme}]: `)
  if (themeAnswer.trim()) config.defaultTheme = themeAnswer.trim()

  const sizeAnswer = await ask(`  Default size (desktop/mobile) [${config.defaultSize}]: `)
  if (sizeAnswer.trim()) config.defaultSize = sizeAnswer.trim()

  const variantAnswer = await ask(`  Default variant (light/dark) [${config.defaultVariant}]: `)
  if (variantAnswer.trim()) config.defaultVariant = variantAnswer.trim()

  const dirAnswer = await ask(`  Default output directory [${config.outputDir}]: `)
  if (dirAnswer.trim()) config.outputDir = dirAnswer.trim()

  // 4. Save config
  saveConfig(config)
  console.log(`\n  ✓ Config saved to ${CONFIG_FILE}`)

  // 5. Test render
  console.log('\n  Testing chart render...')
  try {
    const { applyDefaults } = await import('./lib/defaults.mjs')
    const { renderSvg } = await import('./lib/renderer.mjs')
    const { loadTheme } = await import('./lib/themes.mjs')

    const theme = loadTheme(config.defaultTheme)
    const testSpec = {
      mark: 'bar',
      data: { values: [{ x: 'A', y: 10 }, { x: 'B', y: 20 }] },
      encoding: {
        x: { field: 'x', type: 'nominal' },
        y: { field: 'y', type: 'quantitative' },
      },
    }
    const full = applyDefaults(testSpec, theme, config.defaultVariant, config.defaultSize)
    await renderSvg(full)
    console.log('  ✓ Test render successful\n')
  } catch (err) {
    console.log(`  ✗ Test render failed: ${err.message}\n`)
    process.exit(1)
  }

  console.log('  Setup complete! You can now use:')
  console.log('  node scripts/render.mjs --spec chart.yaml --output chart.svg\n')

  rl.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
