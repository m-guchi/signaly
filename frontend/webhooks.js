'use strict'

function apiUrl(path) {
  return '/' + path.replace(/^\//, '')
}

let channels = []
let channelTree = { groups: [], ungrouped: [] }
let activeChannel = null

const channelList = document.getElementById('channel-list')
const channelTitle = document.getElementById('channel-title')
const webhookDetail = document.getElementById('webhook-detail')
const webhookEmpty = document.getElementById('webhook-empty')
const webhookUrlInput = document.getElementById('webhook-url-input')
const webhookCopyBtn = document.getElementById('webhook-copy-btn')
const webhookRevealBtn = document.getElementById('webhook-reveal-btn')
const webhookUrlSection = document.getElementById('webhook-url-section')
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

function hideWebhookUrl() {
  if (webhookUrlSection) webhookUrlSection.hidden = true
  if (webhookRevealBtn) {
    webhookRevealBtn.hidden = false
    webhookRevealBtn.textContent = 'URL を表示'
  }
  if (webhookCopyBtn) webhookCopyBtn.textContent = 'コピー'
}

function showChannelListLoading() {
  channelList.innerHTML = '<div class="loading-text"><span class="loading-spinner" aria-hidden="true"></span>読み込み中…</div>'
}

function showChannelListError(detail, retryFn) {
  channelList.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = 'loading-text loading-text--error'

  const message = document.createElement('p')
  message.className = 'loading-text-message'
  message.textContent = '読み込みに失敗しました'

  const detailEl = document.createElement('p')
  detailEl.className = 'loading-text-detail'
  detailEl.textContent = detail

  wrap.append(message, detailEl)

  if (retryFn) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'loading-retry-btn'
    btn.textContent = '再試行'
    btn.addEventListener('click', retryFn)
    wrap.appendChild(btn)
  }

  channelList.appendChild(wrap)
}

function renderChannelList(selectName = null) {
  channelList.innerHTML = ''

  if (!channels.length && !channelTree.groups.length) {
    channelList.innerHTML = '<div class="loading-text">チャンネルなし</div>'
    activeChannel = null
    channelTitle.textContent = 'チャンネルを選択'
    webhookDetail.hidden = true
    webhookEmpty.hidden = false
    return
  }

  for (const group of channelTree.groups) {
    channelList.appendChild(createChannelGroupSection(group.name, group.channels))
  }

  if (channelTree.ungrouped.length) {
    const section = createChannelGroupSection('未分類', channelTree.ungrouped)
    section.classList.add('channel-group--ungrouped')
    channelList.appendChild(section)
  }

  const queryChannel = selectName ?? channelFromQuery()
  const target = queryChannel && channels.some(c => c.name === queryChannel)
    ? queryChannel
    : channels[0]?.name

  if (target) selectChannel(target)
}

function createChannelGroupSection(name, channelsInGroup) {
  const section = document.createElement('section')
  section.className = 'channel-group'

  const header = document.createElement('div')
  header.className = 'channel-group-header'
  const label = document.createElement('span')
  label.className = 'channel-group-label'
  label.textContent = name
  header.appendChild(label)
  section.appendChild(header)

  const list = document.createElement('div')
  list.className = 'channel-group-channels'
  for (const channel of channelsInGroup) {
    list.appendChild(createChannelRow(channel))
  }
  section.appendChild(list)

  return section
}

function createChannelRow(channel) {
  const row = document.createElement('div')
  row.className = 'channel-row'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'channel-item'
  btn.dataset.channel = channel.name

  const label = document.createElement('span')
  label.className = 'channel-item-label'
  label.textContent = channel.name
  btn.appendChild(label)

  btn.addEventListener('click', () => selectChannel(channel.name))
  row.appendChild(btn)
  return row
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
  hideWebhookUrl()
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

webhookRevealBtn?.addEventListener('click', () => {
  webhookUrlSection.hidden = false
  webhookRevealBtn.hidden = true
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

      const nameEl = document.createElement('span')
      nameEl.className = 'api-key-item-name'
      nameEl.textContent = key.name

      const prefixEl = document.createElement('span')
      prefixEl.className = 'api-key-item-prefix'
      prefixEl.textContent = `${key.key_prefix}…`

      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'api-key-delete'
      deleteBtn.dataset.id = key.id
      deleteBtn.title = '削除'
      deleteBtn.textContent = '削除'
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`「${key.name}」を削除しますか？`)) return
        await fetch(apiUrl(`api/keys/${key.id}`), { method: 'DELETE' })
        loadApiKeys()
      })

      li.appendChild(nameEl)
      li.appendChild(prefixEl)
      li.appendChild(deleteBtn)
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

SignalySettings.init({ apiUrl, closeSidebar })

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const loginLink = document.getElementById('login-link')
  if (loginLink) loginLink.href = apiUrl('auth/login')

  showChannelListLoading()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(apiUrl('api/channels'), { signal: controller.signal })
    clearTimeout(timeout)
    if (res.status === 401) {
      channelList.innerHTML = ''
      loginOverlay.classList.add('visible')
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    channels = data.channels || []
    channelTree = { groups: data.groups || [], ungrouped: data.ungrouped || [] }
    SignalySettings.showAuthenticated()
    renderChannelList()
    loadApiKeys()
  } catch (err) {
    clearTimeout(timeout)
    const msg = err.name === 'AbortError' ? 'タイムアウト' : err.message
    showChannelListError(msg, init)
  }
}

init()
