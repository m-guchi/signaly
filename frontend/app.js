'use strict'

// ── State ────────────────────────────────────────────────────────────────────

let activeChannel = null
let eventSource = null
let unread = {}  // channel_name -> count

// ── DOM ──────────────────────────────────────────────────────────────────────

const channelList = document.getElementById('channel-list')
const feed = document.getElementById('feed')
const emptyState = document.getElementById('empty-state')
const channelTitle = document.getElementById('channel-title')
const statusEl = document.getElementById('status')
const notifBtn = document.getElementById('notif-btn')

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

function createCard(entry) {
  const card = document.createElement('div')
  card.className = 'notif-card'
  card.dataset.level = entry.level || 'info'
  card.dataset.id = entry.id

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

  const msg = document.createElement('p')
  msg.className = 'notif-message'
  msg.textContent = entry.message

  card.appendChild(header)
  card.appendChild(msg)
  return card
}

function prependCard(entry) {
  const card = createCard(entry)
  if (feed.firstChild) {
    feed.insertBefore(card, feed.firstChild)
  } else {
    feed.appendChild(card)
  }
  emptyState.hidden = true
}

// ── Channel list ─────────────────────────────────────────────────────────────

function renderChannels(channels) {
  channelList.innerHTML = ''
  if (!channels.length) {
    channelList.innerHTML = '<div class="loading-text">チャンネルなし</div>'
    return
  }

  for (const name of channels) {
    const btn = document.createElement('button')
    btn.className = 'channel-item'
    btn.dataset.channel = name
    btn.textContent = name
    btn.addEventListener('click', () => selectChannel(name))
    channelList.appendChild(btn)
  }

  // 最初のチャンネルを自動選択
  selectChannel(channels[0])
}

function updateBadge(channelName) {
  const btn = channelList.querySelector(`[data-channel="${channelName}"]`)
  if (!btn) return
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
  channelList.querySelectorAll('.channel-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.channel === name)
  })
  updateBadge(name)
  channelTitle.textContent = `# ${name}`
  feed.innerHTML = ''
  emptyState.hidden = true
  setStatus('connecting')

  // 履歴を読み込む
  await loadHistory(name)

  // SSE 接続を張り替える
  connectSSE(name)
}

async function loadHistory(channelName) {
  try {
    const res = await fetch(`api/history/${channelName}`)
    if (!res.ok) return
    const { logs } = await res.json()
    if (!logs.length) {
      emptyState.hidden = false
      return
    }
    // 古い順に並んでいるので reverse して新しい順に挿入
    for (const entry of [...logs].reverse()) {
      feed.appendChild(createCard(entry))
    }
    // 最新が上になるよう先頭にスクロール
    feed.scrollTop = 0
  } catch {
    // ネットワーク失敗時はサイレントに無視
  }
}

// ── SSE ──────────────────────────────────────────────────────────────────────

function connectSSE(channelName) {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  const url = `api/stream/${channelName}`
  const es = new EventSource(url)
  eventSource = es

  es.onopen = () => {
    if (activeChannel === channelName) setStatus('connected')
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

// ── Desktop notification ──────────────────────────────────────────────────────

function showDesktopNotification(entry) {
  if (Notification.permission !== 'granted') return

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
  if (Notification.permission === 'granted') {
    notifBtn.classList.add('granted')
    notifBtn.title = 'デスクトップ通知は有効です'
  } else {
    notifBtn.classList.remove('granted')
    notifBtn.title = 'デスクトップ通知を許可する'
  }
}

notifBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
  updateNotifBtnState()
})

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  updateNotifBtnState()

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }

  try {
    const res = await fetch('api/channels')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { channels } = await res.json()
    renderChannels(channels)
  } catch {
    channelList.innerHTML = '<div class="loading-text">読み込み失敗</div>'
  }
}

init()
