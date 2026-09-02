#!/usr/bin/env node
/**
 * CLI entry point for chart-skill.
 * Renders a YAML Vega-Lite spec to SVG.
 *
 * Usage:
 *   node render.mjs --spec chart.yaml --output chart.svg
 *   node render.mjs --yaml 'mark: bar ...' --output chart.svg
 *   node render.mjs --spec chart.yaml --all-variants --output-dir ./figures/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join, basename } from 'path'
import { parseArgs } from 'util'
import yaml from 'js-yaml'
import { loadConfig } from './lib/config.mjs'
import { loadTheme, listThemes } from './lib/themes.mjs'
import { applyDefaults } from './lib/defaults.mjs'
import { renderSvg, contentHash } from './lib/renderer.mjs'

const { values: args, positionals } = parseArgs({
  options: {
    spec: { type: 'string' },
    yaml: { type: 'string' },
    theme: { type: 'string' },
    variant: { type: 'string' },
    size: { type: 'string' },
    output: { type: 'string' },
    'output-dir': { type: 'string' },
    width: { type: 'string' },
    height: { type: 'string' },
    'all-variants': { type: 'boolean', default: false },
    'list-themes': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: true,
})

if (args.help) {
  console.log(`
chart-skill render — Generate publication-grade charts from YAML specs

Usage:
  node render.mjs --spec <file.yaml> [options]
  node render.mjs --yaml '<inline yaml>' [options]

Options:
  --spec PATH          Path to YAML Vega-Lite spec file
  --yaml STRING        Inline YAML spec (alternative to --spec)
  --theme NAME         Theme name (default: from config or "onsen")
  --variant NAME       "light" or "dark" (default: "light")
  --size NAME          "desktop" or "mobile" (default: "desktop")
  --output PATH        Output file path
  --output-dir DIR     Output directory (default: current dir)
  --width N            Override width in pixels
  --height N           Override height in pixels
  --all-variants       Render all 4 combos (light/dark × desktop/mobile)
  --list-themes        List available themes and exit
  --quiet              Print only output path(s)
  --help               Show this help

Either --spec or --yaml is required. Use --yaml for inline specs.
`)
  process.exit(0)
}

if (args['list-themes']) {
  console.log('Available themes:', listThemes().join(', '))
  process.exit(0)
}

// Resolve spec: file or inline YAML
let specYaml
let specLabel // used for output filename when no --output

if (args.yaml) {
  specYaml = args.yaml
  specLabel = 'chart'
} else {
  const specPath = args.spec || positionals[0]
  if (!specPath) {
    console.error('Error: --spec <file.yaml> or --yaml <string> is required')
    process.exit(1)
  }
  const resolvedSpec = resolve(specPath)
  if (!existsSync(resolvedSpec)) {
    console.error(`Error: spec file not found: ${resolvedSpec}`)
    process.exit(1)
  }
  specYaml = readFileSync(resolvedSpec, 'utf8')
  specLabel = basename(specPath).replace(/\.ya?ml$/i, '')
}

// Load config and theme
const config = loadConfig()
const themeName = args.theme || config.defaultTheme || 'onsen'
const theme = loadTheme(themeName)

const overrides = {}
if (args.width) overrides.width = parseInt(args.width, 10)
if (args.height) overrides.height = parseInt(args.height, 10)

// Parse spec
let spec
try {
  spec = yaml.load(specYaml)
} catch (err) {
  console.error(`Error: invalid YAML: ${err.message}`)
  process.exit(1)
}

const hash = contentHash(specYaml)

// Determine what to render
const variants = args['all-variants']
  ? [
      { variant: 'light', size: 'desktop' },
      { variant: 'dark', size: 'desktop' },
      { variant: 'light', size: 'mobile' },
      { variant: 'dark', size: 'mobile' },
    ]
  : [
      {
        variant: args.variant || config.defaultVariant || 'light',
        size: args.size || config.defaultSize || 'desktop',
      },
    ]

const outputDir = resolve(args['output-dir'] || config.outputDir || '.')
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

// Render
const outputs = []
for (const { variant, size } of variants) {
  const fullSpec = applyDefaults(spec, theme, variant, size, overrides)
  const svg = await renderSvg(fullSpec)

  let outputPath
  if (args.output && variants.length === 1) {
    outputPath = resolve(args.output)
  } else {
    const suffix = variants.length > 1 ? `-${size}-${variant}` : ''
    outputPath = join(outputDir, `${specLabel}${suffix}.svg`)
  }

  const dir = resolve(outputPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  writeFileSync(outputPath, svg)
  outputs.push(outputPath)

  if (!args.quiet) {
    console.error(`[chart] ${size}/${variant} → ${outputPath}`)
  }
}

// Print output paths to stdout (for agent consumption)
for (const p of outputs) {
  console.log(p)
}
