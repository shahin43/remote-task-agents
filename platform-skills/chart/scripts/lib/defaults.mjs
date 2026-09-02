/**
 * Vega-Lite spec defaults for chart-skill.
 * Merges user YAML specs with themed, publication-quality defaults.
 */

/** Size presets for different output targets. */
const SIZES = {
  desktop: {
    width: 728,
    height: 420,
    labelFontSize: 16,
    titleFontSize: 16,
    chartTitleSize: 16,
    tickCount: 5,
    autosize: { type: 'fit', contains: 'padding' },
  },
  mobile: {
    width: 600,
    height: 400,
    labelFontSize: 22,
    titleFontSize: 22,
    chartTitleSize: 22,
    tickCount: 5,
    autosize: { type: 'fit', contains: 'padding' },
  },
}

/**
 * Merge a user spec with themed defaults.
 *
 * @param {object} userSpec - Parsed YAML Vega-Lite spec
 * @param {object} theme - Theme object from themes.mjs
 * @param {string} variant - 'light' or 'dark'
 * @param {string} size - 'desktop' or 'mobile'
 * @param {object} [overrides] - Optional width/height overrides
 * @returns {object} Complete Vega-Lite spec
 */
export function applyDefaults(userSpec, theme, variant = 'light', size = 'desktop', overrides = {}) {
  const sizePreset = SIZES[size] || SIZES.desktop
  const tokens = theme.variants[variant]
  const primaryColor = theme.primaryColor || theme.categoryPalette[0]

  const defaultWidth = overrides.width || sizePreset.width
  const defaultHeight = overrides.height || sizePreset.height
  const { labelFontSize, titleFontSize, chartTitleSize, tickCount, autosize } = sizePreset

  const defaultConfig = {
    background: 'transparent',
    font: theme.font || 'system-ui, -apple-system, sans-serif',
    title: {
      fontSize: chartTitleSize,
      fontWeight: 500,
      anchor: 'start',
      color: tokens.text,
      offset: 10,
    },
    axis: {
      labelFontSize,
      labelAngle: 0,
      titleFontSize,
      titleFontWeight: 500,
      tickCount,
      gridDash: [],
      labelColor: tokens.textLight,
      titleColor: tokens.text,
      gridColor: tokens.divider,
      domainColor: tokens.text,
      tickColor: tokens.text,
    },
    axisX: { ticks: false, labelPadding: 8, titlePadding: 12, labelOverlap: 'parity' },
    axisY: {
      labelPadding: 8,
      tickCount,
      ...(size === 'mobile' ? { title: null } : {}),
    },
    legend: {
      labelFontSize,
      titleFontSize,
      titleFontWeight: 500,
      labelColor: tokens.textLight,
      titleColor: tokens.text,
      orient: 'bottom',
      direction: 'horizontal',
      fillColor: 'transparent',
      strokeColor: 'transparent',
      padding: 4,
      symbolSize: 120,
    },
    mark: { color: primaryColor },
    bar: { cornerRadiusEnd: 0, color: primaryColor, stroke: tokens.bgGray, strokeWidth: 1.5 },
    line: {
      strokeWidth: 2,
      color: primaryColor,
      point: { filled: false, fill: tokens.bgGray, size: 45, strokeWidth: 2 },
    },
    point: { size: 120, color: primaryColor, filled: true },
    area: { opacity: 0.3, line: true, color: primaryColor },
    range: { category: theme.categoryPalette },
    scale: { bandPaddingInner: 0.3 },
    view: { stroke: null },
  }

  // Deep-merge user config overrides
  const userConfig = userSpec.config || {}
  const mergedConfig = { ...defaultConfig }
  for (const key of Object.keys(userConfig)) {
    if (typeof userConfig[key] === 'object' && typeof defaultConfig[key] === 'object') {
      mergedConfig[key] = { ...defaultConfig[key], ...userConfig[key] }
    } else {
      mergedConfig[key] = userConfig[key]
    }
  }

  let { config: _ignored, ...restUser } = userSpec

  // Ensure quantitative scales use nice rounding aligned to tickCount
  const tc = tickCount || 5
  if (restUser.encoding?.y?.type === 'quantitative') {
    restUser.encoding = {
      ...restUser.encoding,
      y: {
        ...restUser.encoding.y,
        scale: { nice: tc, ...restUser.encoding.y.scale },
        ...(size === 'mobile' ? { title: null } : {}),
      },
    }
  }
  if (restUser.encoding?.x?.type === 'quantitative') {
    restUser.encoding = {
      ...restUser.encoding,
      x: {
        ...restUser.encoding.x,
        scale: { nice: tc, ...restUser.encoding.x.scale },
      },
    }
  }
  if (size === 'mobile' && restUser.encoding?.y && !restUser.encoding.y.type?.includes('quantitative')) {
    restUser.encoding = {
      ...restUser.encoding,
      y: { ...restUser.encoding.y, title: null },
    }
  }

  // Add value labels to charts
  const markType = typeof restUser.mark === 'string' ? restUser.mark : restUser.mark?.type
  const hasColor = !!restUser.encoding?.color
  const shouldLabel = restUser.encoding && !restUser.layer && markType

  if (shouldLabel) {
    const enc = restUser.encoding
    const isVertical = enc.y?.type === 'quantitative'
    const valueField = isVertical ? enc.y : enc.x

    if (valueField?.field) {
      const { mark, ...specRest } = restUser
      const textFontSize = labelFontSize - 2

      let textMark = {}
      if (markType === 'bar' && !hasColor) {
        textMark = {
          type: 'text', fontSize: textFontSize, fontWeight: 500, color: tokens.text,
          ...(isVertical
            ? { dy: -6, baseline: 'bottom' }
            : { dx: 6, align: 'left', baseline: 'middle' }),
        }
      } else if ((markType === 'line' || markType === 'area') && !hasColor) {
        textMark = {
          type: 'text', fontSize: textFontSize, fontWeight: 500, color: tokens.text,
          dy: -10, baseline: 'bottom',
        }
      }

      if (markType === 'bar' && hasColor) {
        const catField = isVertical ? enc.x : enc.y
        const { mark, encoding, ...specRest2 } = restUser
        restUser = {
          ...specRest2,
          layer: [
            { mark, encoding },
            {
              mark: {
                type: 'text', fontSize: textFontSize, fontWeight: 500, color: tokens.text,
                ...(isVertical
                  ? { dy: -6, baseline: 'bottom' }
                  : { dx: 6, align: 'left', baseline: 'middle' }),
              },
              encoding: {
                ...(catField ? { [isVertical ? 'x' : 'y']: { field: catField.field, type: catField.type } } : {}),
                [isVertical ? 'y' : 'x']: {
                  aggregate: 'sum', field: valueField.field, type: 'quantitative',
                },
                text: {
                  aggregate: 'sum', field: valueField.field, type: 'quantitative', format: ',',
                },
              },
            },
          ],
        }
      } else if (textMark.type) {
        restUser = {
          ...specRest,
          layer: [
            { mark },
            {
              mark: textMark,
              encoding: {
                text: { field: valueField.field, type: 'quantitative', format: ',' },
              },
            },
          ],
        }
      }
    }
  }

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: defaultWidth,
    height: defaultHeight,
    autosize,
    ...restUser,
    config: mergedConfig,
  }
}
