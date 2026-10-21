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
  const [selectedCategory, setSelectedCategory] = useState('All')

  const textareaRef = useRef(null)
  const copyTimeoutRef = useRef(null)

  const syntaxCatalog = useMemo(() => getSyntaxCatalog(), [])

  const filteredCatalog = useMemo(() => {
    const query = helpSearch.trim().toLowerCase()
    return syntaxCatalog
      .filter((group) => selectedCategory === 'All' || group.category === selectedCategory)
      .map((group) => {
        if (!query) return group
        const matchedItems = group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.syntax.toLowerCase().includes(query) ||
            item.expr.toLowerCase().includes(query) ||
            item.desc.toLowerCase().includes(query) ||
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
    let numericSum = 0
    let numericCount = 0
    let expressionLines = 0
    let lastValidResult = undefined

    splitLines.forEach((line) => {
      const processed = preprocessLine(line)
      if (processed.kind === 'empty' || processed.kind === 'comment') {
        items.push({
          text: '\u00A0',
          type: processed.kind,
          copyValue: null,
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
          items.push({ text: '\u00A0', type: 'empty', copyValue: null })
          plainResults.push('\u00A0')
        } else {
          if (typeof formatted.numericValue === 'number') {
            numericSum += formatted.numericValue
            numericCount += 1
          }
          items.push({
            text: formatted.text,
            type: formatted.type,
            copyValue: formatted.text,
          })
          plainResults.push(formatted.text)
        }
      } catch (err) {
        items.push({
          text: err.message,
          type: 'error',
          copyValue: null,
        })
        plainResults.push(err.message)
      }
    })

    const rawScope = calc.getAll()
    const extractedScope = Object.entries(rawScope)
      .filter(([key]) => key !== 'ans')
      .map(([key, val]) => {
        const formatted = formatValue(val)
        return {
          name: key,
          display:
            typeof val === 'function'
              ? val.syntax || `${key}()`
              : `${key} = ${formatted ? formatted.text : String(val)}`,
          isFunction: typeof val === 'function',
        }
      })

    return {
      results: plainResults,
      lineItems: items,
      scopeItems: extractedScope,
      stats: {
        expressionLines,
        numericCount,
        sum: numericCount > 0 ? format(numericSum, { precision: 14 }) : null,
        avg:
          numericCount > 0
            ? format(numericSum / numericCount, { precision: 14 })
            : null,
      },
    }
  }, [content])

  // Persist content & auto-size textarea
  useEffect(() => {
    localStorage.setItem('content', content)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
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

  const lines = content.split(/\r?\n/)
  const highlightedLine = hoveredLine !== null ? hoveredLine : activeLine

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="3" />
              <line x1="8" y1="6" x2="16" y2="6" />
              <line x1="8" y1="11" x2="10" y2="11" />
              <line x1="14" y1="11" x2="16" y2="11" />
              <line x1="8" y1="15" x2="10" y2="15" />
              <line x1="14" y1="15" x2="16" y2="15" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">Mathematical</span>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <span>Clear</span>
          </button>

          <div className="help">
            <button
              type="button"
              className="help-trigger"
              onClick={() => setShowHelp((prev) => !prev)}
              aria-label="Syntax reference"
              title="Syntax guide & examples"
            >
              ?
            </button>
          </div>
        </div>
      </header>

      <div className="pane-headers" aria-hidden="true">
        <div className="pane-header-left">
          <span className="gutter-header">#</span>
          <span>Expression</span>
        </div>
        <div className="pane-header-right">
          <span>Result</span>
          <span className="pane-header-hint">Click result to copy</span>
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
                  {index + 1}
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
                  {item.type === 'function' && <span className="result-badge">fn</span>}
                  {item.type === 'error' && <span className="result-error-dot" aria-hidden="true" />}
                  <span className="result-value">
                    {result === undefined || result === null ? '\u00A0' : String(result)}
                  </span>
                  {isCopyable && (
                    <span className={`copy-pill ${isCopied ? 'is-visible' : ''}`}>
                      {isCopied ? 'Copied' : 'Copy'}
                    </span>
                  )}
                </p>
              )
            })}
          </div>
        </div>
      </main>

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
                <button
                  type="button"
                  className={`help-cat-pill ${selectedCategory === 'All' ? 'is-active' : ''}`}
                  onClick={() => setSelectedCategory('All')}
                >
                  All ({totalCatalogCount})
                </button>
                {syntaxCatalog.map((group) => (
                  <button
                    key={group.category}
                    type="button"
                    className={`help-cat-pill ${selectedCategory === group.category ? 'is-active' : ''}`}
                    onClick={() => setSelectedCategory(group.category)}
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
