import { useState, useEffect, useRef, useMemo } from 'react'
import { parser, format } from 'mathjs'
import { getSyntaxCatalog } from './syntaxCatalog'

function formatValue(val) {
  if (val === undefined || val === null) return null
  if (val && typeof val === 'object' && Array.isArray(val.entries)) {
    if (val.entries.length === 0) return null
    if (val.entries.length === 1) return formatValue(val.entries[0])
    return formatValue(val.entries[val.entries.length - 1])
  }
  if (typeof val === 'function') {
    return {
      text: val.syntax || 'fn()',
      type: 'function',
    }
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return { text: String(val), type: 'number', numericValue: null }
    }
    return {
      text: format(val, { precision: 14 }),
      type: 'number',
      numericValue: val,
    }
  }
  try {
    return {
      text: format(val, { precision: 14 }),
      type: 'value',
      numericValue: null,
    }
  } catch {
    return {
      text: String(val),
      type: 'value',
      numericValue: null,
    }
  }
}

function preprocessLine(rawLine) {
  const trimmed = rawLine.trim()
  if (!trimmed) return { kind: 'empty', expr: '' }
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return { kind: 'comment', expr: '' }
  }
  // Support trailing // comments outside strings
  const slashCommentIndex = trimmed.indexOf('//')
  const cleaned =
    slashCommentIndex > 0 ? trimmed.slice(0, slashCommentIndex).trim() : trimmed
  if (!cleaned) return { kind: 'comment', expr: '' }
  return { kind: 'expression', expr: cleaned }
}

function App() {
  const [content, setContent] = useState(() => localStorage.getItem('content') || '')
  const [previousContent, setPreviousContent] = useState(null)
  const [activeLine, setActiveLine] = useState(0)
  const [hoveredLine, setHoveredLine] = useState(null)
  const [copiedIndex, setCopiedIndex] = useState(null)
  const [copiedSummary, setCopiedSummary] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [helpSearch, setHelpSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('Basic')

  const textareaRef = useRef(null)
  const copyTimeoutRef = useRef(null)

  const syntaxCatalog = useMemo(() => getSyntaxCatalog(), [])

  const filteredCatalog = useMemo(() => {
    const query = helpSearch.trim().toLowerCase()
    return syntaxCatalog
      .filter((group) => Boolean(query) || group.category === selectedCategory)
      .map((group) => {
        if (!query) return group
        const matchedItems = group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.syntax.toLowerCase().includes(query) ||
            item.expr.toLowerCase().includes(query) ||
            item.desc.toLowerCase().includes(query) ||
            (item.subcategory && item.subcategory.toLowerCase().includes(query)) ||
            group.category.toLowerCase().includes(query)
        )
        return { ...group, items: matchedItems }
      })
      .filter((group) => group.items.length > 0)
  }, [syntaxCatalog, helpSearch, selectedCategory])

  const totalCatalogCount = useMemo(
    () => syntaxCatalog.reduce((acc, g) => acc + g.items.length, 0),
    [syntaxCatalog]
  )

  // Evaluate lines and extract scope variables + summary stats
  const { results, lineItems, scopeItems, stats } = useMemo(() => {
    const calc = parser()
    const splitLines = content.split(/\r?\n/)
    const items = []
    const plainResults = []
    const numericSeries = []
    let numericSum = 0
    let numericCount = 0
    let expressionLines = 0
    let commentLines = 0
    let emptyLines = 0
    let errorLines = 0
    let minVal = Infinity
    let maxVal = -Infinity
    let lastValidResult = undefined

    splitLines.forEach((line, idx) => {
      const processed = preprocessLine(line)
      if (processed.kind === 'empty' || processed.kind === 'comment') {
        if (processed.kind === 'comment') commentLines += 1
        else emptyLines += 1
        items.push({
          text: '\u00A0',
          type: processed.kind,
          copyValue: null,
          numericValue: null,
        })
        plainResults.push('\u00A0')
        return
      }

      expressionLines += 1
      try {
        if (lastValidResult !== undefined) {
          calc.set('ans', lastValidResult)
        }
        const evaluated = calc.evaluate(processed.expr)
        if (evaluated !== undefined && typeof evaluated !== 'function') {
          lastValidResult = evaluated
        }
        const formatted = formatValue(evaluated)
        if (!formatted) {
          items.push({
            text: '\u00A0',
            type: 'empty',
            copyValue: null,
            numericValue: null,
          })
          plainResults.push('\u00A0')
        } else {
          if (typeof formatted.numericValue === 'number') {
            const num = formatted.numericValue
            numericSum += num
            numericCount += 1
            if (num < minVal) minVal = num
            if (num > maxVal) maxVal = num
            numericSeries.push({
              lineIndex: idx,
              lineNumber: idx + 1,
              value: num,
              text: formatted.text,
            })
          }
          items.push({
            text: formatted.text,
            type: formatted.type,
            copyValue: formatted.text,
            numericValue:
              typeof formatted.numericValue === 'number'
                ? formatted.numericValue
                : null,
          })
          plainResults.push(formatted.text)
        }
      } catch (err) {
        errorLines += 1
        items.push({
          text: err.message,
          type: 'error',
          copyValue: null,
          numericValue: null,
        })
        plainResults.push(err.message)
      }
    })

    const rawScope = calc.getAll()
    const rawEntries = Object.entries(rawScope).filter(([key]) => key !== 'ans')
    let maxScopeAbs = 0
    rawEntries.forEach(([, val]) => {
      if (typeof val === 'number' && Number.isFinite(val)) {
        const abs = Math.abs(val)
        if (abs > maxScopeAbs) maxScopeAbs = abs
      }
    })

    const extractedScope = rawEntries.map(([key, val]) => {
      const formatted = formatValue(val)
      const isFn = typeof val === 'function'
      const valueText = isFn
        ? val.syntax || `${key}()`
        : formatted
          ? formatted.text
          : String(val)
      const numericMag =
        typeof val === 'number' && Number.isFinite(val)
          ? maxScopeAbs > 0
            ? Math.max(0.12, Math.abs(val) / maxScopeAbs)
            : 0.5
          : isFn
            ? 1
            : 0.35
      return {
        name: key,
        valueText,
        display: isFn ? valueText : `${key} = ${valueText}`,
        isFunction: isFn,
        fillRatio: Math.min(1, numericMag),
      }
    })

    const hasNumeric = numericCount > 0
    const rawAvg = hasNumeric ? numericSum / numericCount : null

    return {
      results: plainResults,
      lineItems: items,
      scopeItems: extractedScope,
      stats: {
        expressionLines,
        numericCount,
        commentLines,
        emptyLines,
        errorLines,
        numericSeries,
        rawSum: hasNumeric ? numericSum : null,
        rawAvg,
        rawMin: hasNumeric ? minVal : null,
        rawMax: hasNumeric ? maxVal : null,
        sum: hasNumeric ? format(numericSum, { precision: 14 }) : null,
        avg: hasNumeric ? format(rawAvg, { precision: 14 }) : null,
        min: hasNumeric ? format(minVal, { precision: 10 }) : null,
        max: hasNumeric ? format(maxVal, { precision: 10 }) : null,
      },
    }
  }, [content])

  // Persist content & auto-size textarea
  useEffect(() => {
    localStorage.setItem('content', content)
    if (textareaRef.current) {
      const el = textareaRef.current
      el.style.minHeight = '0px'
      el.style.height = '0px'
      const nextHeight = el.scrollHeight
      el.style.minHeight = '100%'
      el.style.height = `${nextHeight}px`
    }
  }, [content])

  // Close help modal on Escape
  useEffect(() => {
    if (!showHelp) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowHelp(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showHelp])

  const updateActiveLine = (target) => {
    if (!target) return
    const cursor = target.selectionStart ?? 0
    const lineIndex = target.value.slice(0, cursor).split(/\r?\n/).length - 1
    setActiveLine(lineIndex)
  }

  const handleInput = (e) => {
    setContent(e.target.value)
    updateActiveLine(e.target)
  }

  const copyToClipboard = async (text, index = null, summaryKey = null) => {
    if (!text || text === '\u00A0') return
    try {
      await navigator.clipboard.writeText(String(text))
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      if (index !== null) {
        setCopiedIndex(index)
        setCopiedSummary(null)
      } else if (summaryKey) {
        setCopiedSummary(summaryKey)
        setCopiedIndex(null)
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedIndex(null)
        setCopiedSummary(null)
      }, 1600)
    } catch {
      // Clipboard API unavailable
    }
  }

  const handleCopyAll = () => {
    const lines = content.split(/\r?\n/)
    const formattedLines = lines.map((line, i) => {
      const item = lineItems[i]
      if (!line.trim()) return ''
      if (!item || item.type === 'comment' || item.type === 'empty' || item.type === 'error') {
        return line
      }
      return `${line} = ${item.text}`
    })
    copyToClipboard(formattedLines.join('\n'), null, 'all')
  }

  const handleClear = () => {
    if (!content) return
    setPreviousContent(content)
    setContent('')
    setActiveLine(0)
    textareaRef.current?.focus()
  }

  const handleUndo = () => {
    if (previousContent === null) return
    setContent(previousContent)
    setPreviousContent(null)
    textareaRef.current?.focus()
  }

  const insertSnippet = (snippet) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setContent((prev) => (prev ? `${prev}\n${snippet}` : snippet))
      return
    }
    const start = textarea.selectionStart ?? content.length
    const end = textarea.selectionEnd ?? content.length
    const nextValue = content.slice(0, start) + snippet + content.slice(end)
    setContent(nextValue)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + snippet.length
      textarea.setSelectionRange(cursor, cursor)
      updateActiveLine(textarea)
    })
  }

  const appendExampleLine = (expr) => {
    setContent((prev) => {
      const trimmedEnd = prev.replace(/\s+$/, '')
      return trimmedEnd ? `${trimmedEnd}\n${expr}` : expr
    })
    setShowHelp(false)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }

  const focusLine = (targetIndex) => {
    const textarea = textareaRef.current
    setActiveLine(targetIndex)
    if (!textarea) return
    const split = content.split(/\r?\n/)
    let pos = 0
    for (let i = 0; i < targetIndex && i < split.length; i += 1) {
      pos += split[i].length + 1
    }
    const lineEnd = pos + (split[targetIndex]?.length || 0)
    textarea.focus()
    textarea.setSelectionRange(lineEnd, lineEnd)
  }

  const lines = content.split(/\r?\n/)
  const highlightedLine = hoveredLine !== null ? hoveredLine : activeLine

  // Visual telemetry calculations for the desktop Information Sidebar
  const totalLines = lines.length
  const evalRatio = totalLines > 0 ? stats.expressionLines / totalLines : 0
  const numericRatio = totalLines > 0 ? stats.numericCount / totalLines : 0
  const scopeRatio = Math.min(1, scopeItems.length / Math.max(4, totalLines))
  const evalPercent = Math.round(evalRatio * 100)

  const activeItem = lineItems[highlightedLine]
  const activeNumeric =
    activeItem && typeof activeItem.numericValue === 'number'
      ? activeItem.numericValue
      : stats.rawAvg

  const rangePosition = useMemo(() => {
    if (
      stats.rawMin === null ||
      stats.rawMax === null ||
      activeNumeric === null ||
      activeNumeric === undefined
    ) {
      return 0.5
    }
    const span = stats.rawMax - stats.rawMin
    if (span === 0) return 0.5
    return Math.max(0, Math.min(1, (activeNumeric - stats.rawMin) / span))
  }, [stats.rawMin, stats.rawMax, activeNumeric])

  const chartGeometry = useMemo(() => {
    const series = stats.numericSeries.slice(-12)
    const width = 248
    const height = 82
    const padX = 16
    const padY = 18
    if (series.length === 0) {
      return { points: [], pathD: '', areaD: '', highlight: null, width, height }
    }
    const vals = series.map((s) => s.value)
    const minV = Math.min(...vals)
    const maxV = Math.max(...vals)
    const span = maxV - minV || 1

    const pts = series.map((s, idx) => {
      const x =
        series.length === 1
          ? width / 2
          : padX + (idx / (series.length - 1)) * (width - padX * 2)
      const norm = series.length === 1 ? 0.5 : (s.value - minV) / span
      const y = height - padY - norm * (height - padY * 2)
      return {
        ...s,
        x,
        y,
        isCurrent: s.lineIndex === highlightedLine,
      }
    })

    let pathD = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[i]
      const p1 = pts[i + 1]
      const cx = ((p0.x + p1.x) / 2).toFixed(1)
      pathD += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`
    }

    const lastPt = pts[pts.length - 1]
    const firstPt = pts[0]
    const areaD = `${pathD} L ${lastPt.x.toFixed(1)} ${height - 6} L ${firstPt.x.toFixed(1)} ${height - 6} Z`
    const highlight =
      pts.find((p) => p.isCurrent) ||
      pts.reduce((best, cur) => (cur.value >= best.value ? cur : best), pts[0])

    return { points: pts, pathD, areaD, highlight, width, height }
  }, [stats.numericSeries, highlightedLine])

  const dotCols = 16
  const activeDotCol = Math.min(
    dotCols - 1,
    Math.max(0, Math.round(rangePosition * (dotCols - 1)))
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M 20.28 10.09 A 8.5 8.5 0 1 1 13.91 3.72"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="18.01" cy="5.99" r="2.5" fill="var(--accent)" />
              <circle cx="12" cy="12" r="2.2" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">Mathematical</span>
            <span className="brand-status-pill">LIVE SHEET</span>
          </div>
        </div>

        <div className="toolbar">
          {previousContent !== null && (
            <button
              type="button"
              className="toolbar-btn toolbar-btn-accent"
              onClick={handleUndo}
              title="Restore previous sheet"
            >
              Undo
            </button>
          )}

          <button
            type="button"
            className="toolbar-btn"
            onClick={handleCopyAll}
            disabled={!content.trim()}
            title="Copy all expressions and results"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{copiedSummary === 'all' ? 'Copied!' : 'Copy All'}</span>
          </button>

          <button
            type="button"
            className="toolbar-btn"
            onClick={handleClear}
            disabled={!content}
            title="Clear notepad"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <span>Clear</span>
          </button>

          <div className="help">
            <button
              type="button"
              className="help-trigger"
              onClick={() =>
                setShowHelp((prev) => {
                  if (!prev) setSelectedCategory('Basic')
                  return !prev
                })
              }
              aria-label="Syntax reference"
              title="Syntax guide & examples"
            >
              ?
            </button>
          </div>
        </div>
      </header>

      <div className="workspace-grid">
        <section className="sheet-card" aria-label="Calculator workspace">
          <div className="pane-headers" aria-hidden="true">
            <div className="pane-header-left">
              <span className="gutter-header">#</span>
              <span>Expression</span>
            </div>
            <div className="pane-header-right">
              <span>Result</span>
              <span className="pane-header-hint">Click to copy</span>
            </div>
          </div>

          <main className="container">
            <div className="left">
              <div className="editor-wrapper">
                <div className="line-numbers" aria-hidden="true">
                  {lines.map((_, index) => (
                    <div
                      key={index}
                      className={`line-number ${highlightedLine === index ? 'is-active' : ''}`}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </div>
                  ))}
                </div>

                <div className="editor-surface">
                  <div className="line-backdrop" aria-hidden="true">
                    {lines.map((line, index) => {
                      const trimmed = line.trim()
                      const isComment = trimmed.startsWith('#') || trimmed.startsWith('//')
                      return (
                        <div
                          key={index}
                          className={`backdrop-row ${highlightedLine === index ? 'is-active' : ''} ${isComment ? 'is-comment-row' : ''}`}
                        />
                      )
                    })}
                  </div>

                  <form spellCheck="false" onSubmit={(e) => e.preventDefault()}>
                    <textarea
                      id="input"
                      ref={textareaRef}
                      rows={1}
                      cols={80}
                      autoFocus
                      value={content}
                      onChange={handleInput}
                      onClick={(e) => updateActiveLine(e.target)}
                      onKeyUp={(e) => updateActiveLine(e.target)}
                      onSelect={(e) => updateActiveLine(e.target)}
                      wrap="off"
                      placeholder="Solve for x — e.g. x = 25, x * 4, 50 km in miles"
                    />
                  </form>
                </div>
              </div>
            </div>

            <div className="right">
              <div id="response">
                {results.map((result, index) => {
                  const item = lineItems[index] || { text: result, type: 'value', copyValue: null }
                  const isCopyable = Boolean(item.copyValue && item.type !== 'error')
                  const isCopied = copiedIndex === index
                  const isRowActive = highlightedLine === index

                  return (
                    <p
                      key={index}
                      className={`result-row result-${item.type} ${isRowActive ? 'is-active' : ''} ${isCopyable ? 'is-copyable' : ''}`}
                      onMouseEnter={() => setHoveredLine(index)}
                      onMouseLeave={() => setHoveredLine(null)}
                      onClick={() => isCopyable && copyToClipboard(item.copyValue, index)}
                      title={
                        isCopyable
                          ? 'Click to copy result'
                          : item.type === 'error'
                            ? item.text
                            : undefined
                      }
                    >
                      {isCopyable && (
                        <span className={`copy-pill ${isCopied ? 'is-visible' : ''}`}>
                          {isCopied ? 'Copied' : 'Copy'}
                        </span>
                      )}
                      {item.type === 'function' && <span className="result-badge">fn</span>}
                      {item.type === 'error' && <span className="result-error-dot" aria-hidden="true" />}
                      <span className="result-value">
                        {result === undefined || result === null ? '\u00A0' : String(result)}
                      </span>
                    </p>
                  )
                })}
              </div>
            </div>
          </main>
        </section>

        <aside className="info-sidebar" aria-label="Sheet telemetry and scope">
          {/* Card 1: Aggregations (Sum & Avg) + Concentric Rings & Dot Range Strip */}
          <div className="bento-card bento-metrics">
            <div className="bento-top-row">
              <span className="black-tag">METRICS</span>
              <span className="bento-subtle">
                {stats.numericCount} numeric {stats.numericCount === 1 ? 'val' : 'vals'}
              </span>
            </div>

            <div className="metrics-split">
              <div className="orange-hero-card">
                <button
                  type="button"
                  className="hero-stat-btn"
                  disabled={stats.sum === null}
                  onClick={() => stats.sum !== null && copyToClipboard(stats.sum, null, 'sum')}
                  title={stats.sum !== null ? 'Click to copy sum' : 'No numeric results yet'}
                >
                  <div className="hero-stat-header">
                    <span className="hero-stat-label">SUM</span>
                    {copiedSummary === 'sum' ? (
                      <span className="hero-copied-pill">COPIED</span>
                    ) : (
                      stats.sum !== null && <span className="hero-copy-hint">COPY</span>
                    )}
                  </div>
                  <div className="hero-stat-number">
                    {stats.sum !== null ? stats.sum : '0'}
                  </div>
                </button>

                <div className="hero-divider" />

                <button
                  type="button"
                  className="hero-stat-btn"
                  disabled={stats.avg === null}
                  onClick={() => stats.avg !== null && copyToClipboard(stats.avg, null, 'avg')}
                  title={stats.avg !== null ? 'Click to copy average' : 'No numeric results yet'}
                >
                  <div className="hero-stat-header">
                    <span className="hero-stat-label">AVG</span>
                    {copiedSummary === 'avg' ? (
                      <span className="hero-copied-pill">COPIED</span>
                    ) : (
                      stats.avg !== null && <span className="hero-copy-hint">COPY</span>
                    )}
                  </div>
                  <div className="hero-stat-number is-secondary">
                    {stats.avg !== null ? stats.avg : '0'}
                  </div>
                </button>
              </div>

              <div className="rings-widget" aria-hidden="true">
                <svg viewBox="0 0 100 100" className="concentric-rings-svg">
                  {/* Track arcs */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="var(--ring-track)"
                    strokeWidth="8"
                    strokeDasharray="188 252"
                    strokeDashoffset="-30"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="29"
                    fill="none"
                    stroke="var(--ring-track)"
                    strokeWidth="8"
                    strokeDasharray="136 183"
                    strokeDashoffset="-22"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="18"
                    fill="none"
                    stroke="var(--ring-track)"
                    strokeWidth="8"
                    strokeDasharray="85 114"
                    strokeDashoffset="-14"
                    strokeLinecap="round"
                  />
                  {/* Active progress arcs */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="8"
                    strokeDasharray={`${Math.max(12, Math.round(188 * evalRatio))} 252`}
                    strokeDashoffset="-30"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="29"
                    fill="none"
                    stroke="var(--ink-strong)"
                    strokeWidth="8"
                    strokeDasharray={`${Math.max(10, Math.round(136 * numericRatio))} 183`}
                    strokeDashoffset="-22"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="18"
                    fill="none"
                    stroke="var(--cobalt)"
                    strokeWidth="8"
                    strokeDasharray={`${Math.max(8, Math.round(85 * scopeRatio))} 114`}
                    strokeDashoffset="-14"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="rings-legend">
                  <span><i className="dot-swatch is-orange" />Eval</span>
                  <span><i className="dot-swatch is-ink" />Num</span>
                  <span><i className="dot-swatch is-cobalt" />Scope</span>
                </div>
              </div>
            </div>

            {/* Dark Curve & Lollipop Sparkline (banking.jpeg + dashboard.jpeg) */}
            <div className="dark-curve-card">
              <div className="dark-curve-header">
                <span className="dark-curve-title">Result Curve</span>
                {chartGeometry.highlight ? (
                  <span className="curve-callout-pill">
                    L{chartGeometry.highlight.lineNumber}: {chartGeometry.highlight.text}
                  </span>
                ) : (
                  <span className="dark-curve-sub">Awaiting values</span>
                )}
              </div>

              <svg
                viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                className="curve-svg"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="curveAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <line x1="12" y1="22" x2="236" y2="22" className="curve-grid-line" />
                <line x1="12" y1="45" x2="236" y2="45" className="curve-grid-line" />
                <line x1="12" y1="68" x2="236" y2="68" className="curve-grid-line" />

                {chartGeometry.points.length > 0 ? (
                  <>
                    <path d={chartGeometry.areaD} fill="url(#curveAreaGrad)" />
                    {chartGeometry.points.map((pt) => (
                      <line
                        key={`stem-${pt.lineIndex}`}
                        x1={pt.x}
                        y1={pt.y}
                        x2={pt.x}
                        y2={chartGeometry.height - 6}
                        className={`curve-stem ${pt.isCurrent ? 'is-current' : ''}`}
                      />
                    ))}
                    <path d={chartGeometry.pathD} className="curve-line-path" />
                    {chartGeometry.points.map((pt) => {
                      const isPeak =
                        chartGeometry.highlight &&
                        chartGeometry.highlight.lineIndex === pt.lineIndex
                      return (
                        <circle
                          key={`pt-${pt.lineIndex}`}
                          cx={pt.x}
                          cy={pt.y}
                          r={isPeak ? 4.2 : 2.5}
                          className={`curve-node ${isPeak ? 'is-peak' : ''}`}
                          onClick={() => focusLine(pt.lineIndex)}
                        />
                      )
                    })}
                  </>
                ) : (
                  <path
                    d="M 16 52 C 58 32, 92 64, 132 42 C 172 20, 204 54, 232 36"
                    className="curve-placeholder-path"
                  />
                )}
              </svg>

              {/* Biomarker Dot-Matrix Range Strip (blood.jpeg) */}
              <div className="range-dot-strip">
                <div className="range-dot-rows" aria-hidden="true">
                  {[0, 1].map((rowIdx) => (
                    <div key={rowIdx} className="range-dot-row">
                      {Array.from({ length: dotCols }).map((_, colIdx) => {
                        const dist = Math.abs(colIdx - activeDotCol)
                        let tone = 'is-muted'
                        if (stats.numericCount > 0) {
                          if (dist === 0) tone = 'is-core'
                          else if (dist <= 2) tone = 'is-hot'
                          else if (dist <= 5) tone = 'is-warm'
                        }
                        return <span key={colIdx} className={`range-dot ${tone}`} />
                      })}
                    </div>
                  ))}
                </div>
                <div className="range-labels">
                  <span>▼ Min {stats.min ?? '—'}</span>
                  <span>▲ Max {stats.max ?? '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Lines & Sheet Dot-Matrix (calendar.jpg + statistics.jpeg) */}
          <div className="bento-card bento-lines">
            <div className="calendar-header">
              <div className="calendar-big-num">{totalLines}</div>
              <div className="calendar-meta">
                <span className="calendar-title">
                  {totalLines === 1 ? 'LINE' : 'LINES'}
                </span>
                <span className="calendar-sub">
                  L{highlightedLine + 1} ACTIVE
                </span>
              </div>
              <div className="stat-percent-Readout">
                <span className="stat-percent-val">{evalPercent}%</span>
                <span className="stat-percent-lbl">active</span>
              </div>
            </div>

            {/* Segmented Composition Bar (statistics.jpeg) */}
            <div className="segmented-bar" aria-hidden="true">
              <span
                className="seg-piece is-ink"
                style={{ flexGrow: Math.max(1, stats.numericCount) }}
                title={`Numeric: ${stats.numericCount}`}
              />
              <span
                className="seg-piece is-orange"
                style={{ flexGrow: Math.max(0.4, scopeItems.length) }}
                title={`Scope: ${scopeItems.length}`}
              />
              <span
                className="seg-piece is-olive"
                style={{ flexGrow: Math.max(0.4, stats.commentLines) }}
                title={`Comments: ${stats.commentLines}`}
              />
              <span
                className="seg-piece is-stone"
                style={{ flexGrow: Math.max(0.4, stats.emptyLines) }}
                title={`Empty: ${stats.emptyLines}`}
              />
            </div>

            {/* Calendar Dot Matrix (calendar.jpg) */}
            <div className="calendar-dot-grid" role="group" aria-label="Line map">
              {lines.map((_, idx) => {
                const item = lineItems[idx]
                const isCurrent = highlightedLine === idx
                const isEvaluated =
                  item && item.type !== 'empty' && item.type !== 'comment' && item.type !== 'error'
                const isErr = item && item.type === 'error'
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => focusLine(idx)}
                    onMouseEnter={() => setHoveredLine(idx)}
                    onMouseLeave={() => setHoveredLine(null)}
                    className={`matrix-dot ${isCurrent ? 'is-active' : ''} ${isEvaluated ? 'is-filled' : ''} ${isErr ? 'is-error' : ''}`}
                    title={`Line ${idx + 1}${item?.copyValue ? ` = ${item.copyValue}` : ''}`}
                  >
                    <span className="sr-only">Line {idx + 1}</span>
                  </button>
                )
              })}
            </div>

            <div className="calendar-motto">
              <span>{stats.expressionLines} EVALUATED</span>
              <span>LESS BUT BETTER</span>
            </div>
          </div>

          {/* Card 3: Scope Variables & Functions (dark.jpeg + banking.jpeg) */}
          <div className="bento-card bento-scope">
            <div className="bento-top-row">
              <span className="black-tag">SCOPE</span>
              <span className="bento-subtle">
                {scopeItems.length} {scopeItems.length === 1 ? 'symbol' : 'symbols'}
              </span>
            </div>

            {scopeItems.length === 0 ? (
              <div className="scope-empty-box">
                <div className="scope-empty-dots" aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
                <p>No variables defined — try <code>x = 25</code></p>
              </div>
            ) : (
              <div className="scope-visual-list">
                {scopeItems.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className={`scope-bar-card ${item.isFunction ? 'is-fn' : ''}`}
                    onClick={() =>
                      insertSnippet(item.isFunction ? `${item.name}()` : item.name)
                    }
                    title={`Click to insert ${item.name}`}
                  >
                    <div
                      className="scope-bar-fill"
                      style={{ width: `${Math.round(item.fillRatio * 100)}%` }}
                      aria-hidden="true"
                    />
                    <div className="scope-bar-content">
                      <span className="scope-Left">
                        <span className="scope-badge">
                          {item.isFunction ? 'fn' : 'var'}
                        </span>
                        <span className="scope-name">{item.name}</span>
                      </span>
                      <span className="scope-val">{item.valueText}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile-only Status Bar */}
      <footer className="status-bar">
        <div className="status-vars">
          <span className="status-label">Scope:</span>
          {scopeItems.length === 0 ? (
            <span className="status-empty">No variables defined</span>
          ) : (
            <div className="var-pills">
              {scopeItems.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className={`var-pill ${item.isFunction ? 'is-fn' : ''}`}
                  onClick={() => insertSnippet(item.isFunction ? `${item.name}()` : item.name)}
                  title={`Click to insert ${item.name}`}
                >
                  {item.display}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="status-metrics">
          {stats.sum !== null && (
            <button
              type="button"
              className="metric-pill"
              onClick={() => copyToClipboard(stats.sum, null, 'sum')}
              title="Click to copy sum of numeric results"
            >
              <span className="metric-label">Sum</span>
              <span className="metric-value">
                {copiedSummary === 'sum' ? 'Copied!' : stats.sum}
              </span>
            </button>
          )}
          {stats.avg !== null && (
            <button
              type="button"
              className="metric-pill"
              onClick={() => copyToClipboard(stats.avg, null, 'avg')}
              title="Click to copy average of numeric results"
            >
              <span className="metric-label">Avg</span>
              <span className="metric-value">
                {copiedSummary === 'avg' ? 'Copied!' : stats.avg}
              </span>
            </button>
          )}
          <span className="status-count">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
      </footer>

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <aside
            className="help-drawer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Syntax Reference"
          >
            <div className="help-drawer-header">
              <div>
                <h2>Syntax Reference ({totalCatalogCount})</h2>
                <p>Complete library of syntax rules, functions, constants, and units. Click any item to insert.</p>
              </div>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setShowHelp(false)}
                aria-label="Close syntax guide"
              >
                ✕
              </button>
            </div>

            <div className="help-controls">
              <div className="help-search-wrap">
                <input
                  type="search"
                  className="help-search"
                  value={helpSearch}
                  onChange={(e) => setHelpSearch(e.target.value)}
                  placeholder="Search functions, operators, constants, or units (e.g. sin, det, planck, hectare)..."
                  autoFocus
                />
              </div>

              <div className="help-categories" role="tablist" aria-label="Reference categories">
                {syntaxCatalog.map((group) => (
                  <button
                    key={group.category}
                    type="button"
                    className={`help-cat-pill ${selectedCategory === group.category ? 'is-active' : ''}`}
                    onClick={() => {
                      setSelectedCategory(group.category)
                      setHelpSearch('')
                    }}
                  >
                    {group.category} ({group.items.length})
                  </button>
                ))}
              </div>
            </div>

            <div className="help-drawer-body">
              {filteredCatalog.length === 0 ? (
                <div className="help-empty">
                  No matching functions, constants, or units found for &ldquo;{helpSearch}&rdquo;.
                </div>
              ) : (
                filteredCatalog.map((group) => (
                  <section key={group.category} className="help-section">
                    <h3>
                      <span>{group.category}</span>
                      <span className="help-section-count">{group.items.length}</span>
                    </h3>
                    <div className="help-grid">
                      {group.items.map((item) => (
                        <button
                          key={`${group.category}-${item.name}`}
                          type="button"
                          className="help-card"
                          onClick={() => appendExampleLine(item.expr)}
                          title={`Insert: ${item.expr}`}
                        >
                          <div className="help-card-top">
                            <span className="help-card-name">{item.name}</span>
                            <code className="help-card-expr">{item.expr}</code>
                          </div>
                          {item.syntax && item.syntax !== item.name && (
                            <div className="help-card-syntax">{item.syntax}</div>
                          )}
                          {item.desc && <span className="help-card-desc">{item.desc}</span>}
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>

            <div className="help-drawer-footer">
              <span>Comments start with <code>#</code> or <code>//</code></span>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

export default App
