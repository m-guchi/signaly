'use strict'

function apiUrl(path) {
  return '/' + path.replace(/^\//, '')
}

let channels = []
let activeChannel = null

const channelList = document.getElementById('channel-list')
const channelTitle = document.getElementById('channel-title')
const webhookDetail = document.getElementById('webhook-detail')
const webhookEmpty = document.getElementById('webhook-empty')
const webhookUrlInput = document.getElementById('webhook-url-input')
const webhookCopyBtn = document.getElementById('webhook-copy-btn')
const webhookExampleCode = document.getElementById('webhook-example-code')
const apiKeyForm = document.getElementById('api-key-form')
const apiKeyName = document.getElementById('api-key-name')
const apiKeyError = document.getElementById('api-key-error')
const apiKeyCreated = document.getElementById('api-key-created')
const apiKeyCreatedValue = document.getElementById('api-key-created-value')
const apiKeyCreatedCopy = document.getElementById('api-key-created-copy')
const apiKeyList = document.getElementById('api-key-list')
const loginOverlay = document.getElementById('login-overlay')
const sidebar = document.getElementById('sidebar')
const sidebarToggle = document.getElementById('sidebar-toggle')
const sidebarBackdrop = document.getElementById('sidebar-backdrop')

const mobileSidebarMq = window.matchMedia('(max-width: 767px)')

function isMobileSidebar() {
  return mobileSidebarMq.matches
}

function setSidebarOpen(open) {
  if (!isMobileSidebar()) {
    sidebar.classList.remove('sidebar--open')
    sidebarBackdrop.classList.remove('visible')
    sidebarBackdrop.hidden = true
    sidebarBackdrop.setAttribute('aria-hidden', 'true')
    sidebarToggle?.setAttribute('aria-expanded', 'false')
    sidebarToggle?.setAttribute('aria-label', 'メニューを開く')
    return
  }

  sidebar.classList.toggle('sidebar--open', open)
  sidebarBackdrop.classList.toggle('visible', open)
  sidebarBackdrop.hidden = !open
  sidebarBackdrop.setAttribute('aria-hidden', open ? 'false' : 'true')
  sidebarToggle?.setAttribute('aria-expanded', open ? 'true' : 'false')
  sidebarToggle?.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く')
}

function closeSidebar() {
  setSidebarOpen(false)
}

sidebarToggle?.addEventListener('click', () => {
  setSidebarOpen(!sidebar.classList.contains('sidebar--open'))
})

sidebarBackdrop?.addEventListener('click', closeSidebar)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar()
})

mobileSidebarMq.addEventListener('change', () => {
  if (!isMobileSidebar()) closeSidebar()
})

function channelFromQuery() {
  return new URLSearchParams(location.search).get('channel')
}

function updatePageUrl(channelName) {
  const url = new URL(location.href)
  url.searchParams.set('channel', channelName)
  history.replaceState(null, '', url)
}

function renderChannelList(selectName = null) {
  channelList.innerHTML = ''

  if (!channels.length) {
    channelList.innerHTML = '<div class="loading-text">チャンネルなし</div>'
    activeChannel = null
    channelTitle.textContent = 'チャンネルを選択'
    webhookDetail.hidden = true
    webhookEmpty.hidden = false
    return
  }

  for (const channel of channels) {
    const btn = document.createElement('button')
    btn.className = 'channel-item'
    btn.dataset.channel = channel.name
    btn.textContent = channel.name
    btn.addEventListener('click', () => selectChannel(channel.name))
    channelList.appendChild(btn)
  }

  const queryChannel = selectName ?? channelFromQuery()
  const target = queryChannel && channels.some(c => c.name === queryChannel)
    ? queryChannel
    : channels[0].name

  selectChannel(target)
}

function selectChannel(name) {
  const channel = channels.find(c => c.name === name)
  if (!channel) return

  activeChannel = name
  channelList.querySelectorAll('.channel-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.channel === name)
  })

  channelTitle.textContent = `# ${name}`
  document.title = `Webhook — #${name} — Signaly`

  webhookUrlInput.value = channel.webhook_url
  webhookExampleCode.textContent = `curl -X POST "${channel.webhook_url}" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"デプロイ完了","embeds":[{"title":"v1.2.3","description":"本番に反映しました","color":5763719,"fields":[{"name":"Branch","value":"main","inline":true}]}]}'`

  webhookDetail.hidden = false
  webhookEmpty.hidden = true
  updatePageUrl(name)
  closeSidebar()
}

webhookCopyBtn?.addEventListener('click', async () => {
  const text = webhookUrlInput.value
  try {
    await navigator.clipboard.writeText(text)
    webhookCopyBtn.textContent = 'コピー済み'
    setTimeout(() => { webhookCopyBtn.textContent = 'コピー' }, 2000)
  } catch {
    webhookUrlInput.select()
    document.execCommand('copy')
  }
})

async function loadApiKeys() {
  if (!apiKeyList) return
  try {
    const res = await fetch(apiUrl('api/keys'))
    if (!res.ok) return
    const { keys } = await res.json()
    apiKeyList.innerHTML = ''
    if (!keys.length) {
      apiKeyList.innerHTML = '<li class="api-key-empty">API キーはまだありません</li>'
      return
    }
    for (const key of keys) {
      const li = document.createElement('li')
      li.className = 'api-key-item'
      li.innerHTML = `
        <span class="api-key-item-name">${key.name}</span>
        <span class="api-key-item-prefix">${key.key_prefix}…</span>
        <button type="button" class="api-key-delete" data-id="${key.id}" title="削除">削除</button>
      `
      li.querySelector('.api-key-delete')?.addEventListener('click', async () => {
        if (!confirm(`「${key.name}」を削除しますか？`)) return
        await fetch(apiUrl(`api/keys/${key.id}`), { method: 'DELETE' })
        loadApiKeys()
      })
      apiKeyList.appendChild(li)
    }
  } catch {
    // サイレントに無視
  }
}

apiKeyForm?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = apiKeyName?.value.trim()
  if (!name) return

  apiKeyError.hidden = true
  const submitBtn = apiKeyForm.querySelector('button[type="submit"]')
  submitBtn.disabled = true

  try {
    const res = await fetch(apiUrl('api/keys'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      apiKeyError.textContent = data.detail || '作成に失敗しました'
      apiKeyError.hidden = false
      return
    }
    apiKeyName.value = ''
    if (apiKeyCreated && apiKeyCreatedValue) {
      apiKeyCreated.hidden = false
      apiKeyCreatedValue.value = data.key
    }
    loadApiKeys()
  } catch {
    apiKeyError.textContent = 'ネットワークエラーが発生しました'
    apiKeyError.hidden = false
  } finally {
    submitBtn.disabled = false
  }
})

apiKeyCreatedCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(apiKeyCreatedValue.value)
    apiKeyCreatedCopy.textContent = 'コピー済み'
    setTimeout(() => { apiKeyCreatedCopy.textContent = 'コピー' }, 2000)
  } catch {
    apiKeyCreatedValue.select()
    document.execCommand('copy')
  }
})

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
    const data = await res.json()
    channels = data.channels
    addLogoutButton()
    renderChannelList()
    loadApiKeys()
  } catch (err) {
    clearTimeout(timeout)
    const msg = err.name === 'AbortError' ? 'タイムアウト' : err.message
    channelList.innerHTML = `<div class="loading-text">読み込み失敗 (${msg})</div>`
  }
}

init()
