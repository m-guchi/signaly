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
  const escaped = String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>')
    .replace(/:rocket:/g, '🚀')
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
  title.innerHTML = renderFieldValue(entry.title || entry.channel)

  const time = document.createElement('span')
  time.className = 'notif-time'
  time.textContent = relativeTime(entry.timestamp)
  time.title = new Date(entry.timestamp).toLocaleString('ja-JP')

  header.appendChild(title)
  header.appendChild(time)
  card.appendChild(header)

  if (entry.message) {
    const msg = document.createElement('div')
    msg.className = 'notif-message'
    msg.innerHTML = renderFieldValue(entry.message)
    card.appendChild(msg)
  }

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
    settingsBtn.title = 'チャンネル設定'
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

async function unsubscribePush() {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const json = sub.toJSON()
      await fetch(apiUrl('api/push/unsubscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      await sub.unsubscribe()
    }
    pushSubscribed = false
    return true
  } catch {
    pushSubscribed = false
    return false
  }
}

function showDesktopNotification(entry) {
  if (pushSubscribed) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const title = entry.title || `# ${entry.channel}`
  const body = entry.message
  const icon = typeof APP_VERSION !== 'undefined'
    ? `icon-192.png?v=${APP_VERSION}`
    : 'icon-192.png'

  const n = new Notification(title, { body, icon, tag: entry.id })
  n.onclick = () => {
    window.focus()
    if (activeChannel !== entry.channel) selectChannel(entry.channel)
    n.close()
  }
}

SignalySettings.init({
  apiUrl,
  closeSidebar,
  notifications: {
    isSupported: () => 'Notification' in window,
    pushSupported,
    getPushSubscribed: () => pushSubscribed,
    subscribePush,
    unsubscribePush,
    onStateChange: () => SignalySettings.updateSettingsBtnState(),
  },
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
const createChannelRevealWebhook = document.getElementById('create-channel-reveal-webhook')
const createChannelWebhookSection = document.getElementById('create-channel-webhook-section')

function hideWebhookSection(revealBtn, section, copyBtn = null) {
  if (section) section.hidden = true
  if (revealBtn) {
    revealBtn.hidden = false
    revealBtn.textContent = 'URL を表示'
  }
  if (copyBtn) copyBtn.textContent = 'コピー'
}

function resetCreateChannelDialog() {
  createChannelForm.hidden = false
  createChannelSuccess.hidden = true
  createChannelTitle.textContent = 'チャンネルを作成'
  createChannelName.value = ''
  createChannelError.hidden = true
  createChannelError.textContent = ''
  hideWebhookSection(createChannelRevealWebhook, createChannelWebhookSection, createChannelCopy)
}

function openCreateChannelDialog() {
  resetCreateChannelDialog()
  SignalyDialog.open(createChannelDialog, { focusEl: createChannelName })
}

function closeCreateChannelDialog() {
  SignalyDialog.close(createChannelDialog)
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
    hideWebhookSection(createChannelRevealWebhook, createChannelWebhookSection, createChannelCopy)

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

createChannelRevealWebhook?.addEventListener('click', () => {
  createChannelWebhookSection.hidden = false
  createChannelRevealWebhook.hidden = true
})

// ── Channel settings ──────────────────────────────────────────────────────────

const channelSettingsDialog = document.getElementById('channel-settings-dialog')
const channelSettingsClose = document.getElementById('channel-settings-close')
const channelSettingsRename = document.getElementById('channel-settings-rename')
const channelSettingsRenameBtn = document.getElementById('channel-settings-rename-btn')
const channelSettingsError = document.getElementById('channel-settings-error')
const channelSettingsWebhook = document.getElementById('channel-settings-webhook')
const channelSettingsCopy = document.getElementById('channel-settings-copy')
const channelSettingsRevealWebhook = document.getElementById('channel-settings-reveal-webhook')
const channelSettingsWebhookSection = document.getElementById('channel-settings-webhook-section')
const channelSettingsDelete = document.getElementById('channel-settings-delete')
const channelDeleteDialog = document.getElementById('channel-delete-dialog')
const channelDeleteName = document.getElementById('channel-delete-name')
const channelDeleteError = document.getElementById('channel-delete-error')
const channelDeleteCancel = document.getElementById('channel-delete-cancel')
const channelDeleteConfirm = document.getElementById('channel-delete-confirm')

let channelSettingsId = null
let channelSettingsOriginalName = null

function parseApiError(data, fallback) {
  let message = data?.detail
  if (Array.isArray(message)) {
    message = message.map(e => e.msg).join(', ')
  } else if (typeof message !== 'string') {
    message = fallback
  }
  return message
}

async function refreshChannels(selectName = null) {
  const res = await fetch(apiUrl('api/channels'))
  if (!res.ok) return false
  const { channels } = await res.json()
  renderChannels(channels, selectName)
  return true
}

function resetChannelSettingsDialog() {
  channelSettingsId = null
  channelSettingsOriginalName = null
  channelSettingsError.hidden = true
  channelSettingsError.textContent = ''
  hideWebhookSection(channelSettingsRevealWebhook, channelSettingsWebhookSection, channelSettingsCopy)
  channelSettingsRenameBtn.disabled = false
  channelSettingsDelete.disabled = false
}

function openChannelSettings(channelName) {
  const channel = channelsByName[channelName]
  if (!channel) return

  channelSettingsId = channel.id
  channelSettingsOriginalName = channelName
  channelSettingsRename.value = channelName
  channelSettingsWebhook.value = channel.webhook_url || ''
  channelSettingsError.hidden = true
  hideWebhookSection(channelSettingsRevealWebhook, channelSettingsWebhookSection, channelSettingsCopy)
  closeSidebar()
  SignalyDialog.open(channelSettingsDialog, { focusEl: channelSettingsRename })
  channelSettingsRename?.select()
}

function closeChannelSettingsDialog() {
  SignalyDialog.close(channelSettingsDialog)
  resetChannelSettingsDialog()
}

channelSettingsClose?.addEventListener('click', closeChannelSettingsDialog)

channelSettingsDialog?.addEventListener('click', (e) => {
  if (e.target === channelSettingsDialog && !channelDeleteDialog?.classList.contains('open')) {
    closeChannelSettingsDialog()
  }
})

function openChannelDeleteDialog() {
  if (!channelSettingsOriginalName) return
  channelDeleteName.textContent = channelSettingsOriginalName
  channelDeleteError.hidden = true
  channelDeleteError.textContent = ''
  channelDeleteConfirm.disabled = false
  channelDeleteCancel.disabled = false
  SignalyDialog.open(channelDeleteDialog, { focusEl: channelDeleteCancel })
}

function closeChannelDeleteDialog() {
  SignalyDialog.close(channelDeleteDialog)
  channelDeleteError.hidden = true
  channelDeleteError.textContent = ''
  channelDeleteConfirm.disabled = false
  channelDeleteCancel.disabled = false
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && channelDeleteDialog?.classList.contains('open')) {
    closeChannelDeleteDialog()
    return
  }
  if (e.key === 'Escape' && channelSettingsDialog?.classList.contains('open')) {
    closeChannelSettingsDialog()
  }
})

channelSettingsRevealWebhook?.addEventListener('click', () => {
  channelSettingsWebhookSection.hidden = false
  channelSettingsRevealWebhook.hidden = true
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

channelSettingsRenameBtn?.addEventListener('click', async () => {
  const newName = channelSettingsRename.value.trim()
  if (!newName || !channelSettingsId) return
  if (newName === channelSettingsOriginalName) return

  channelSettingsError.hidden = true
  channelSettingsRenameBtn.disabled = true

  try {
    const res = await fetch(apiUrl(`api/channels/${channelSettingsId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      channelSettingsError.textContent = parseApiError(data, '変更に失敗しました')
      channelSettingsError.hidden = false
      return
    }

    const oldName = channelSettingsOriginalName
    if (unread[oldName]) {
      unread[newName] = (unread[newName] || 0) + unread[oldName]
      delete unread[oldName]
    }

    channelSettingsOriginalName = newName
    channelSettingsId = data.id
    channelsByName[newName] = data

    const wasActive = activeChannel === oldName
    await refreshChannels(wasActive ? newName : activeChannel)
    closeChannelSettingsDialog()
  } catch {
    channelSettingsError.textContent = 'ネットワークエラーが発生しました'
    channelSettingsError.hidden = false
  } finally {
    channelSettingsRenameBtn.disabled = false
  }
})

channelSettingsDelete?.addEventListener('click', () => {
  if (!channelSettingsId || !channelSettingsOriginalName) return
  openChannelDeleteDialog()
})

channelDeleteCancel?.addEventListener('click', closeChannelDeleteDialog)

channelDeleteDialog?.addEventListener('click', (e) => {
  if (e.target === channelDeleteDialog) closeChannelDeleteDialog()
})

channelDeleteConfirm?.addEventListener('click', async () => {
  if (!channelSettingsId || !channelSettingsOriginalName) return

  channelDeleteError.hidden = true
  channelDeleteConfirm.disabled = true
  channelDeleteCancel.disabled = true
  channelSettingsDelete.disabled = true
  channelSettingsRenameBtn.disabled = true

  try {
    const res = await fetch(apiUrl(`api/channels/${channelSettingsId}`), {
      method: 'DELETE',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      channelDeleteError.textContent = parseApiError(data, '削除に失敗しました')
      channelDeleteError.hidden = false
      return
    }

    const deletedName = channelSettingsOriginalName
    delete unread[deletedName]
    closeChannelDeleteDialog()
    closeChannelSettingsDialog()

    if (activeChannel === deletedName && eventSource) {
      eventSource.close()
      eventSource = null
    }

    await refreshChannels(activeChannel === deletedName ? null : activeChannel)
  } catch {
    channelDeleteError.textContent = 'ネットワークエラーが発生しました'
    channelDeleteError.hidden = false
  } finally {
    channelDeleteConfirm.disabled = false
    channelDeleteCancel.disabled = false
    channelSettingsDelete.disabled = false
    channelSettingsRenameBtn.disabled = false
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

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {

  const loginLink = document.getElementById('login-link')
  if (loginLink) loginLink.href = apiUrl('auth/login')

  if ('serviceWorker' in navigator) {
    const swUrl = typeof APP_VERSION !== 'undefined'
      ? `./sw.js?v=${APP_VERSION}`
      : './sw.js'
    await navigator.serviceWorker.register(swUrl).catch(() => {})
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
    SignalySettings.showAuthenticated()
    addChannelBtn.hidden = false
    renderChannels(channels, urlChannel)
    try {
      await syncPushSubscription()
    } catch {
      pushSubscribed = false
    }
    SignalySettings.updateSettingsBtnState()
  } catch (err) {
    clearTimeout(timeout)
    const msg = err.name === 'AbortError' ? 'タイムアウト' : err.message
    channelList.innerHTML = `<div class="loading-text">読み込み失敗 (${msg})</div>`
  }
}

init()
