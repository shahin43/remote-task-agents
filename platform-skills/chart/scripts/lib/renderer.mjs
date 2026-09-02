/**
 * Vega-Lite to SVG renderer for chart-skill.
 * Compiles specs and post-processes SVGs for axis domain overlay.
 */
import { createHash } from 'crypto'

let _vega, _vegaLite

async function getVega() {
  if (!_vega) _vega = await import('vega')
  if (!_vegaLite) _vegaLite = await import('vega-lite')
  return { vega: _vega, vegaLite: _vegaLite }
}

/**
 * Render a Vega-Lite spec to SVG string.
 * Post-processes the SVG to overlay axis domain lines on top of marks.
 *
 * @param {object} spec - Complete Vega-Lite spec (after applyDefaults)
 * @returns {Promise<string>} SVG string
 */
export async function renderSvg(spec) {
  const { vega, vegaLite } = await getVega()
  const vegaSpec = vegaLite.compile(spec).spec
  const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' })
  let svg = await view.toSVG()
  view.finalize()

  // Duplicate axis domain lines after marks so they paint on top of bars.
  // Each domain line is wrapped in its parent axis group's transform.
  const axisWithDomain =
    /<g class="mark-group role-axis" role="graphics-symbol"[^>]*><g transform="([^"]+)">[\s\S]*?(<g class="mark-rule role-axis-domain"[^>]*><line[^/]*\/><\/g>)[\s\S]*?<\/g><\/g>/g
  const domainOverlays = []
  let axisMatch
  while ((axisMatch = axisWithDomain.exec(svg)) !== null) {
    domainOverlays.push(
      `<g transform="${axisMatch[1]}">${axisMatch[2]}</g>`,
    )
  }
  if (domainOverlays.length > 0) {
    const overlay = `<g class="axis-domain-overlay">${domainOverlays.join('')}</g>`
    const titleIdx = svg.lastIndexOf('<g class="mark-group role-title">')
    if (titleIdx > 0) {
      svg = svg.slice(0, titleIdx) + overlay + svg.slice(titleIdx)
    } else {
      const lastFg = svg.lastIndexOf('<path class="foreground"')
      if (lastFg > 0) {
        svg = svg.slice(0, lastFg) + overlay + svg.slice(lastFg)
      }
    }
  }

  return svg
}

/**
 * Generate a short hash from a string (for filenames).
 * @param {string} str
 * @returns {string} 8-char hex hash
 */
export function contentHash(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 8)
}
