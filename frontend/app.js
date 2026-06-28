'use strict'

// ── State ────────────────────────────────────────────────────────────────────

function apiUrl(path) {
  const base = location.pathname.endsWith('/')
    ? location.pathname
    : `${location.pathname}/`
  return base + path.replace(/^\//, '')
}

let activeChannel = null
let channelsByName = {}
let eventSource = null
let unread = {}  // channel_name -> count
const seenIds = new Set()
let pollTimer = null
let pushSubscribed = false

// ── DOM ──────────────────────────────────────────────────────────────────────

const channelList = document.getElementById('channel-list')
const feed = document.getElementById('feed')
const emptyState = document.getElementById('empty-state')
const channelTitle = document.getElementById('channel-title')
const statusEl = document.getElementById('status')
const notifBtn = document.getElementById('notif-btn')
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000)
  if (diff < 60) return 'たった今'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 時間前`
  return new Date(isoString).toLocaleDateString('ja-JP', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function setStatus(state) {
  statusEl.className = `status status--${state}`
  const titles = { connected: '接続中', connecting: '接続中…', disconnected: '切断' }
  statusEl.title = titles[state] ?? state
}

// ── Notification card ────────────────────────────────────────────────────────

function renderFieldValue(raw) {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function createCard(entry) {
  const card = document.createElement('div')
  card.className = 'notif-card'
  card.dataset.level = entry.level || 'info'
  card.dataset.id = entry.id

  if (entry.color) {
    card.style.borderLeftColor = entry.color
  }

  const header = document.createElement('div')
  header.className = 'notif-header'

  const title = document.createElement('span')
  title.className = 'notif-title'
  title.textContent = entry.title || entry.channel

  const time = document.createElement('span')
  time.className = 'notif-time'
  time.textContent = relativeTime(entry.timestamp)
  time.title = new Date(entry.timestamp).toLocaleString('ja-JP')

  header.appendChild(title)
  header.appendChild(time)
  card.appendChild(header)

  if (entry.fields && entry.fields.length > 0) {
    const fieldsEl = document.createElement('div')
    fieldsEl.className = 'embed-fields'
    for (const f of entry.fields) {
      const fieldEl = document.createElement('div')
      fieldEl.className = f.inline ? 'embed-field embed-field--inline' : 'embed-field'

      const nameEl = document.createElement('div')
      nameEl.className = 'embed-field-name'
      nameEl.textContent = f.name

      const valueEl = document.createElement('div')
      valueEl.className = 'embed-field-value'
      valueEl.innerHTML = renderFieldValue(String(f.value))

      fieldEl.appendChild(nameEl)
      fieldEl.appendChild(valueEl)
      fieldsEl.appendChild(fieldEl)
    }
    card.appendChild(fieldsEl)
  } else if (entry.message) {
    const msg = document.createElement('p')
    msg.className = 'notif-message'
    msg.textContent = entry.message
    card.appendChild(msg)
  }

  return card
}

function prependCard(entry) {
  if (seenIds.has(entry.id)) return
  seenIds.add(entry.id)

  const card = createCard(entry)
  if (feed.firstChild) {
    feed.insertBefore(card, feed.firstChild)
  } else {
    feed.appendChild(card)
  }
  emptyState.hidden = true
}

// ── Channel list ─────────────────────────────────────────────────────────────

const CHANNEL_SETTINGS_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`

function renderChannels(channels, selectName = null) {
  channelList.innerHTML = ''
  channelsByName = {}
  const normalized = channels.map(c => (typeof c === 'string' ? { name: c } : c))
  const names = normalized.map(c => c.name)

  if (!names.length) {
    channelList.innerHTML = '<div class="loading-text">チャンネルなし</div>'
    activeChannel = null
    channelTitle.textContent = 'チャンネルを選択'
    return
  }

  for (const channel of normalized) {
    channelsByName[channel.name] = channel

    const row = document.createElement('div')
    row.className = 'channel-row'
    row.dataset.channel = channel.name

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'channel-item'

    const label = document.createElement('span')
    label.className = 'channel-item-label'
    label.textContent = channel.name
    btn.appendChild(label)
    btn.addEventListener('click', () => selectChannel(channel.name))

    const settingsBtn = document.createElement('button')
    settingsBtn.type = 'button'
    settingsBtn.className = 'channel-settings-btn'
    settingsBtn.title = 'Webhook URL'
    settingsBtn.setAttribute('aria-label', `${channel.name} の設定`)
    settingsBtn.innerHTML = CHANNEL_SETTINGS_ICON
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      openChannelSettings(channel.name)
    })

    row.appendChild(btn)
    row.appendChild(settingsBtn)
    channelList.appendChild(row)
  }

  const target = selectName
    ?? (activeChannel && names.includes(activeChannel) ? null : names[0])

  if (target) {
    selectChannel(target)
  } else if (activeChannel) {
    setActiveChannelRow(activeChannel)
    updateBadge(activeChannel)
  }
}

function setActiveChannelRow(channelName) {
  channelList.querySelectorAll('.channel-row').forEach(row => {
    row.querySelector('.channel-item')?.classList.toggle(
      'active',
      row.dataset.channel === channelName,
    )
  })
}

function updateBadge(channelName) {
  const row = channelList.querySelector(`.channel-row[data-channel="${channelName}"]`)
  if (!row) return
  const btn = row.querySelector('.channel-item')
  const count = unread[channelName] || 0
  let badge = btn.querySelector('.badge')
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'badge'
      btn.appendChild(badge)
    }
    badge.textContent = count > 99 ? '99+' : String(count)
  } else if (badge) {
    badge.remove()
  }
}

// ── Channel selection ─────────────────────────────────────────────────────────

async function selectChannel(name) {
  if (activeChannel === name) return

  activeChannel = name
  unread[name] = 0

  // UI 更新
  setActiveChannelRow(name)
  updateBadge(name)
  channelTitle.textContent = `# ${name}`
  feed.innerHTML = ''
  emptyState.hidden = true
  seenIds.clear()
  setStatus('connecting')

  // SSE を先に張り、履歴読み込み中の通知取りこぼしを防ぐ
  connectSSE(name)
  await loadHistory(name)

  closeSidebar()
}

async function loadHistory(channelName) {
  try {
    const res = await fetch(apiUrl(`api/history/${channelName}`))
    if (!res.ok) return
    const { logs } = await res.json()
    if (!logs.length) {
      emptyState.hidden = false
      return
    }
    // 古い順に並んでいるので reverse して新しい順に挿入
    for (const entry of [...logs].reverse()) {
      if (seenIds.has(entry.id)) continue
      seenIds.add(entry.id)
      feed.appendChild(createCard(entry))
    }
    // 最新が上になるよう先頭にスクロール
    feed.scrollTop = 0
  } catch {
    // ネットワーク失敗時はサイレントに無視
  }
}

// ── SSE ──────────────────────────────────────────────────────────────────────

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollNewEntries(channelName) {
  if (activeChannel !== channelName) return
  try {
    const res = await fetch(apiUrl(`api/history/${channelName}?limit=30`))
    if (!res.ok) return
    const { logs } = await res.json()
    let added = false
    for (const entry of [...logs].reverse()) {
      if (seenIds.has(entry.id)) continue
      if (activeChannel === entry.channel) {
        prependCard(entry)
        added = true
      }
    }
    if (added) feed.scrollTop = 0
  } catch {
    // サイレントに無視
  }
}

function startPolling(channelName) {
  stopPolling()
  // SSE がプロキシでバッファされる場合のフォールバック
  pollTimer = setInterval(() => pollNewEntries(channelName), 5000)
}

function connectSSE(channelName) {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  stopPolling()

  const url = apiUrl(`api/stream/${channelName}`)
  const es = new EventSource(url)
  eventSource = es

  es.onopen = () => {
    if (activeChannel === channelName) {
      setStatus('connected')
      startPolling(channelName)
    }
  }

  es.onmessage = (event) => {
    let entry
    try {
      entry = JSON.parse(event.data)
    } catch {
      return
    }

    if (activeChannel === entry.channel) {
      prependCard(entry)
    } else {
      unread[entry.channel] = (unread[entry.channel] || 0) + 1
      updateBadge(entry.channel)
    }

    // デスクトップ通知
    showDesktopNotification(entry)
  }

  es.onerror = () => {
    if (activeChannel === channelName) setStatus('disconnected')
    es.close()
    // 5 秒後に再接続
    setTimeout(() => {
      if (activeChannel === channelName) connectSSE(channelName)
    }, 5000)
  }
}

// ── Desktop / Push notification ─────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

async function subscribePush(forceNew = false) {
  if (!pushSupported()) return false

  try {
    const reg = await navigator.serviceWorker.ready

    const keyRes = await fetch(apiUrl('api/push/vapid-public-key'))
    if (!keyRes.ok) return false
    const { publicKey } = await keyRes.json()

    let sub = await reg.pushManager.getSubscription()
    if (sub && forceNew) {
      await sub.unsubscribe()
      sub = null
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    }

    const json = sub.toJSON()
    const res = await fetch(apiUrl('api/push/subscribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
      }),
    })

    pushSubscribed = res.ok
    return pushSubscribed
  } catch {
    pushSubscribed = false
    return false
  }
}

async function syncPushSubscription() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    pushSubscribed = false
    return
  }
  await subscribePush()
}

function showDesktopNotification(entry) {
  if (pushSubscribed) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const title = entry.title || `# ${entry.channel}`
  const body = entry.message
  const icon = 'icon.svg'

  const n = new Notification(title, { body, icon, tag: entry.id })
  n.onclick = () => {
    window.focus()
    if (activeChannel !== entry.channel) selectChannel(entry.channel)
    n.close()
  }
}

function updateNotifBtnState() {
  if (!('Notification' in window)) {
    notifBtn.hidden = true
    return
  }
  notifBtn.hidden = false
  if (Notification.permission === 'granted') {
    notifBtn.classList.add('granted')
    notifBtn.title = pushSubscribed
      ? 'Push 通知は有効です（バックグラウンド対応）'
      : '通知は有効です'
  } else {
    notifBtn.classList.remove('granted')
    notifBtn.title = 'Push 通知を許可する'
  }
}

notifBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
  if (Notification.permission === 'granted') {
    await subscribePush(true)
  }
  updateNotifBtnState()
})

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

// ── Create channel ────────────────────────────────────────────────────────────

const addChannelBtn = document.getElementById('add-channel-btn')
const createChannelDialog = document.getElementById('create-channel-dialog')
const createChannelForm = document.getElementById('create-channel-form')
const createChannelName = document.getElementById('create-channel-name')
const createChannelError = document.getElementById('create-channel-error')
const createChannelClose = document.getElementById('create-channel-close')
const createChannelSuccess = document.getElementById('create-channel-success')
const createChannelTitle = document.getElementById('create-channel-title')
const createChannelSuccessName = document.getElementById('create-channel-success-name')
const createChannelWebhook = document.getElementById('create-channel-webhook')
const createChannelCopy = document.getElementById('create-channel-copy')
const createChannelDone = document.getElementById('create-channel-done')

function resetCreateChannelDialog() {
  createChannelForm.hidden = false
  createChannelSuccess.hidden = true
  createChannelTitle.textContent = 'チャンネルを作成'
  createChannelName.value = ''
  createChannelError.hidden = true
  createChannelError.textContent = ''
}

function openCreateChannelDialog() {
  resetCreateChannelDialog()
  createChannelDialog?.classList.add('open')
  createChannelName?.focus()
}

function closeCreateChannelDialog() {
  createChannelDialog?.classList.remove('open')
}

addChannelBtn?.addEventListener('click', openCreateChannelDialog)

createChannelClose?.addEventListener('click', closeCreateChannelDialog)

createChannelDone?.addEventListener('click', closeCreateChannelDialog)

createChannelDialog?.addEventListener('click', (e) => {
  if (e.target === createChannelDialog) closeCreateChannelDialog()
})

createChannelForm?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = createChannelName.value.trim()
  if (!name) return

  createChannelError.hidden = true
  const submitBtn = createChannelForm.querySelector('.create-channel-submit')
  submitBtn.disabled = true

  try {
    const res = await fetch(apiUrl('api/channels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      let message = data.detail
      if (Array.isArray(message)) {
        message = message.map(e => e.msg).join(', ')
      } else if (typeof message !== 'string') {
        message = `作成に失敗しました (${res.status})`
      }
      createChannelError.textContent = message
      createChannelError.hidden = false
      return
    }

    createChannelForm.hidden = true
    createChannelSuccess.hidden = false
    createChannelTitle.textContent = 'チャンネルを作成しました'
    createChannelSuccessName.textContent = data.name
    createChannelWebhook.value = data.webhook_url

    const listRes = await fetch(apiUrl('api/channels'))
    if (listRes.ok) {
      const { channels } = await listRes.json()
      renderChannels(channels, data.name)
    }
  } catch {
    createChannelError.textContent = 'ネットワークエラーが発生しました'
    createChannelError.hidden = false
  } finally {
    submitBtn.disabled = false
  }
})

createChannelCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(createChannelWebhook.value)
    createChannelCopy.textContent = 'コピー済み'
    setTimeout(() => { createChannelCopy.textContent = 'コピー' }, 2000)
  } catch {
    createChannelWebhook.select()
    document.execCommand('copy')
  }
})

// ── Channel settings (Webhook URL) ────────────────────────────────────────────

const channelSettingsDialog = document.getElementById('channel-settings-dialog')
const channelSettingsClose = document.getElementById('channel-settings-close')
const channelSettingsName = document.getElementById('channel-settings-name')
const channelSettingsWebhook = document.getElementById('channel-settings-webhook')
const channelSettingsCopy = document.getElementById('channel-settings-copy')

function openChannelSettings(channelName) {
  const channel = channelsByName[channelName]
  if (!channel?.webhook_url) return

  channelSettingsName.textContent = channelName
  channelSettingsWebhook.value = channel.webhook_url
  channelSettingsDialog?.classList.add('open')
  closeSidebar()
}

function closeChannelSettingsDialog() {
  channelSettingsDialog?.classList.remove('open')
}

channelSettingsClose?.addEventListener('click', closeChannelSettingsDialog)

channelSettingsDialog?.addEventListener('click', (e) => {
  if (e.target === channelSettingsDialog) closeChannelSettingsDialog()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && channelSettingsDialog?.classList.contains('open')) {
    closeChannelSettingsDialog()
  }
})

channelSettingsCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(channelSettingsWebhook.value)
    channelSettingsCopy.textContent = 'コピー済み'
    setTimeout(() => { channelSettingsCopy.textContent = 'コピー' }, 2000)
  } catch {
    channelSettingsWebhook.select()
    document.execCommand('copy')
  }
})

// ── Auth ──────────────────────────────────────────────────────────────────────

const loginOverlay = document.getElementById('login-overlay')

async function checkAuth() {
  try {
    const res = await fetch(apiUrl('auth/me'))
    if (res.ok) return true
  } catch {
    // ネットワーク失敗時はサイレントに無視
  }
  return false
}

function addLogoutButton() {
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
  document.querySelector('.sidebar-header').appendChild(btn)
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  updateNotifBtnState()

  const loginLink = document.getElementById('login-link')
  if (loginLink) loginLink.href = apiUrl('auth/login')

  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('./sw.js').catch(() => {})
  }

  const urlChannel = new URLSearchParams(location.search).get('channel')

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
    addChannelBtn.hidden = false
    renderChannels(channels, urlChannel)
    try {
      await syncPushSubscription()
    } catch {
      pushSubscribed = false
    }
    updateNotifBtnState()
  } catch (err) {
    clearTimeout(timeout)
    const msg = err.name === 'AbortError' ? 'タイムアウト' : err.message
    channelList.innerHTML = `<div class="loading-text">読み込み失敗 (${msg})</div>`
  }
}

init()
