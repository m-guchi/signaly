'use strict'

const SignalyMarkdown = {
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  },

  inline(text) {
    let out = this.escapeHtml(text)
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    return out
  },

  isTableRow(line) {
    return /^\|.*\|$/.test(line.trim())
  },

  isTableSeparator(line) {
    return /^\|[\s:|-]+\|$/.test(line.trim())
  },

  parseTableRow(line) {
    return line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
  },

  renderTable(rows) {
    if (rows.length < 2) return ''
    const header = rows[0]
    const body = rows.slice(2)
    let html = '<table><thead><tr>'
    for (const cell of header) {
      html += `<th>${this.inline(cell)}</th>`
    }
    html += '</tr></thead><tbody>'
    for (const row of body) {
      html += '<tr>'
      for (const cell of row) {
        html += `<td>${this.inline(cell)}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    return html
  },

  parse(markdown) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n')
    const parts = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      if (!trimmed) {
        i += 1
        continue
      }

      if (/^---+$/.test(trimmed)) {
        parts.push('<hr>')
        i += 1
        continue
      }

      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim()
        const codeLines = []
        i += 1
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i])
          i += 1
        }
        i += 1
        const code = this.escapeHtml(codeLines.join('\n'))
        const cls = lang ? ` class="language-${lang}"` : ''
        parts.push(`<pre><code${cls}>${code}</code></pre>`)
        continue
      }

      if (this.isTableRow(trimmed)) {
        const tableRows = []
        while (i < lines.length && this.isTableRow(lines[i].trim())) {
          if (!this.isTableSeparator(lines[i].trim())) {
            tableRows.push(this.parseTableRow(lines[i]))
          }
          i += 1
        }
        parts.push(this.renderTable(tableRows))
        continue
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
      if (heading) {
        const level = heading[1].length
        parts.push(`<h${level}>${this.inline(heading[2])}</h${level}>`)
        i += 1
        continue
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = []
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
          i += 1
        }
        parts.push(`<ul>${items.map((item) => `<li>${this.inline(item)}</li>`).join('')}</ul>`)
        continue
      }

      const paragraph = [line]
      i += 1
      while (i < lines.length) {
        const next = lines[i].trim()
        if (
          !next
          || next.startsWith('#')
          || next.startsWith('```')
          || /^---+$/.test(next)
          || this.isTableRow(next)
          || /^[-*]\s+/.test(next)
        ) {
          break
        }
        paragraph.push(lines[i])
        i += 1
      }
      parts.push(`<p>${this.inline(paragraph.join('\n'))}</p>`)
    }

    return parts.join('\n')
  },
}
