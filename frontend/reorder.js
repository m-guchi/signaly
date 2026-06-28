'use strict'

const SignalyReorder = {
  _channelList: null,
  _dragEl: null,
  _dragType: null,
  _bound: false,

  init(channelList) {
    this._channelList = channelList
  },

  setActive(active) {
    document.getElementById('sidebar')?.classList.toggle('reorder-mode', active)
    if (active) {
      this._bind()
    } else {
      this._unbind()
      this._clearDropHints()
    }
  },

  collectLayout() {
    const groups = []
    const channels = []
    let groupOrder = 0
    const list = this._channelList
    if (!list) return { groups, channels }

    for (const child of list.children) {
      if (!child.classList.contains('channel-group')) continue

      if (child.classList.contains('channel-group--ungrouped')) {
        let order = 0
        for (const row of child.querySelectorAll('.channel-row')) {
          const channelId = row.dataset.channelId
          if (!channelId) continue
          channels.push({ id: channelId, group_id: null, sort_order: order++ })
        }
        continue
      }

      const groupId = child.dataset.groupId || child.getAttribute('data-group-id')
      if (!groupId) continue

      groups.push({ id: groupId, sort_order: groupOrder++ })
      let order = 0
      for (const row of child.querySelectorAll('.channel-row')) {
        const channelId = row.dataset.channelId
        if (!channelId) continue
        channels.push({ id: channelId, group_id: groupId, sort_order: order++ })
      }
    }

    return { groups, channels }
  },

  _bind() {
    if (this._bound || !this._channelList) return
    this._onDragStart = (e) => this._handleDragStart(e)
    this._onDragOver = (e) => this._handleDragOver(e)
    this._onDrop = (e) => this._handleDrop(e)
    this._onDragEnd = (e) => this._handleDragEnd(e)
    this._channelList.addEventListener('dragstart', this._onDragStart)
    this._channelList.addEventListener('dragover', this._onDragOver)
    this._channelList.addEventListener('drop', this._onDrop)
    this._channelList.addEventListener('dragend', this._onDragEnd)
    this._bound = true
  },

  _unbind() {
    if (!this._bound || !this._channelList) return
    this._channelList.removeEventListener('dragstart', this._onDragStart)
    this._channelList.removeEventListener('dragover', this._onDragOver)
    this._channelList.removeEventListener('drop', this._onDrop)
    this._channelList.removeEventListener('dragend', this._onDragEnd)
    this._bound = false
  },

  _clearDropHints() {
    this._channelList?.querySelectorAll('.reorder-drop-over').forEach((el) => {
      el.classList.remove('reorder-drop-over')
    })
    this._dragEl?.classList.remove('reorder-dragging')
    this._dragEl = null
    this._dragType = null
  },

  _handleDragStart(e) {
    const row = e.target.closest('.channel-row')
    if (row?.draggable) {
      this._dragEl = row
      this._dragType = 'channel'
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', row.dataset.channel || '')
      row.classList.add('reorder-dragging')
      return
    }

    const group = e.target.closest('.channel-group:not(.channel-group--ungrouped)')
    if (group?.draggable) {
      this._dragEl = group
      this._dragType = 'group'
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', group.dataset.groupId || '')
      group.classList.add('reorder-dragging')
    }
  },

  _handleDragOver(e) {
    if (!this._dragEl) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (this._dragType === 'channel') {
      const list = e.target.closest('.channel-group-channels')
      if (!list) return

      this._channelList.querySelectorAll('.channel-group-channels').forEach((el) => {
        el.classList.toggle('reorder-drop-over', el === list)
      })

      const row = e.target.closest('.channel-row')
      if (row && row !== this._dragEl && row.parentElement === list) {
        const rect = row.getBoundingClientRect()
        const after = e.clientY > rect.top + rect.height / 2
        list.insertBefore(this._dragEl, after ? row.nextSibling : row)
        return
      }

      if (!list.querySelector('.channel-row')) {
        list.appendChild(this._dragEl)
      }
      return
    }

    if (this._dragType === 'group') {
      const target = e.target.closest('.channel-group:not(.channel-group--ungrouped)')
      const ungrouped = this._channelList.querySelector('.channel-group--ungrouped')
      if (!target || target === this._dragEl) return

      const rect = target.getBoundingClientRect()
      const after = e.clientY > rect.top + rect.height / 2
      this._channelList.insertBefore(this._dragEl, after ? target.nextSibling : target)
      if (ungrouped) this._channelList.appendChild(ungrouped)
    }
  },

  _handleDrop(e) {
    e.preventDefault()
    this._clearDropHints()
  },

  _handleDragEnd() {
    this._clearDropHints()
  },
}
