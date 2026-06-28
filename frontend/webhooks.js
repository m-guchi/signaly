'use strict'

function apiUrl(path) {
  return '/' + path.replace(/^\//, '')
}

const webhooksList = document.getElementById('webhooks-list')
const loginOverlay = document.getElementById('login-overlay')

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text)
    const original = btn.textContent
    btn.textContent = 'コピー済み'
    setTimeout(() => { btn.textContent = original }, 2000)
  } catch {
  }
}

function renderWebhooks(channels) {
  webhooksList.innerHTML = ''

  if (!channels.length) {
    webhooksList.innerHTML = '<div class="loading-text">チャンネルがありません。通知ページから作成してください。</div>'
    return
  }

  const exampleCode = document.querySelector('.webhooks-example-code code')
  if (exampleCode && channels[0]?.webhook_url) {
    exampleCode.textContent = `curl -X POST "${channels[0].webhook_url}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"デプロイ完了","message":"v1.2.3 を本番に反映しました","level":"info"}'`
  }

  for (const channel of channels) {
    const card = document.createElement('article')
    card.className = 'webhook-card'

    const heading = document.createElement('h2')
    heading.className = 'webhook-card-title'
    heading.textContent = `# ${channel.name}`

    const label = document.createElement('label')
    label.className = 'create-channel-label'
    label.textContent = 'Webhook URL'
    label.htmlFor = `webhook-url-${channel.id}`

    const row = document.createElement('div')
    row.className = 'create-channel-webhook-row'

    const input = document.createElement('input')
    input.id = `webhook-url-${channel.id}`
    input.className = 'create-channel-input create-channel-webhook-input'
    input.type = 'text'
    input.value = channel.webhook_url
    input.readOnly = true

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'create-channel-copy'
    copyBtn.textContent = 'コピー'
    copyBtn.addEventListener('click', () => copyText(channel.webhook_url, copyBtn))

    row.appendChild(input)
    row.appendChild(copyBtn)

    card.appendChild(heading)
    card.appendChild(label)
    card.appendChild(row)
    webhooksList.appendChild(card)
  }
}

function addLogoutButton() {
  const header = document.querySelector('.sidebar-header')
  if (!header || header.querySelector('.logout-btn')) return

  const btn = document.createElement('button')
  btn.className = 'logout-btn'
  btn.title = 'ログアウト'
  btn.setAttribute('aria-label', 'ログアウト')
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>`
  btn.addEventListener('click', async () => {
    await fetch(apiUrl('auth/logout'), { method: 'POST' })
    location.reload()
  })
  header.appendChild(btn)
}

// ── Version / Changelog ──────────────────────────────────────────────────────

const versionBtn = document.getElementById('version-btn')
const changelogDialog = document.getElementById('changelog-dialog')
const changelogClose = document.getElementById('changelog-close')

if (typeof APP_VERSION !== 'undefined' && versionBtn) {
  versionBtn.textContent = `v${APP_VERSION}`
}

function renderChangelog() {
  const list = document.getElementById('changelog-list')
  if (!list || typeof APP_CHANGELOG === 'undefined') return
  list.innerHTML = ''
  for (const entry of APP_CHANGELOG) {
    const section = document.createElement('div')
    section.className = 'cl-entry'

    const heading = document.createElement('div')
    heading.className = 'cl-heading'
    const ver = document.createElement('span')
    ver.className = 'cl-version'
    ver.textContent = `v${entry.version}`
    const date = document.createElement('span')
    date.className = 'cl-date'
    date.textContent = entry.date || ''
    heading.appendChild(ver)
    heading.appendChild(date)

    const ul = document.createElement('ul')
    ul.className = 'cl-changes'
    for (const change of entry.changes) {
      const li = document.createElement('li')
      li.textContent = change
      ul.appendChild(li)
    }

    section.appendChild(heading)
    section.appendChild(ul)
    list.appendChild(section)
  }
}

renderChangelog()

versionBtn?.addEventListener('click', () => {
  changelogDialog?.classList.add('open')
})

changelogClose?.addEventListener('click', () => {
  changelogDialog?.classList.remove('open')
})

changelogDialog?.addEventListener('click', (e) => {
  if (e.target === changelogDialog) changelogDialog.classList.remove('open')
})

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const loginLink = document.getElementById('login-link')
  if (loginLink) loginLink.href = apiUrl('auth/login')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(apiUrl('api/channels'), { signal: controller.signal })
    clearTimeout(timeout)
    if (res.status === 401) {
      loginOverlay.classList.add('visible')
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { channels } = await res.json()
    addLogoutButton()
    renderWebhooks(channels)
  } catch (err) {
    clearTimeout(timeout)
    const msg = err.name === 'AbortError' ? 'タイムアウト' : err.message
    webhooksList.innerHTML = `<div class="loading-text">読み込み失敗 (${msg})</div>`
  }
}

init()
