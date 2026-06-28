'use strict'

const SignalyDialog = {
  _cleanups: new Map(),

  isMobile() {
    return window.matchMedia('(max-width: 767px)').matches
  },

  open(dialog, { focusEl = null } = {}) {
    if (!dialog) return
    dialog.classList.add('open')
    this._bindViewport(dialog)
    if (!focusEl) return

    requestAnimationFrame(() => {
      focusEl.focus({ preventScroll: true })
      this._centerFocus(dialog, focusEl)
    })
  },

  close(dialog) {
    if (!dialog) return
    dialog.classList.remove('open')
    this._unbindViewport(dialog)
  },

  _bindViewport(dialog) {
    if (!this.isMobile() || !window.visualViewport) return

    this._unbindViewport(dialog)

    const sync = () => {
      if (!dialog.classList.contains('open')) return
      const vv = window.visualViewport
      // 自動ズーム（scale !== 1）ではレイアウトを追従させない
      if (vv.scale !== 1) return
      dialog.style.top = `${vv.offsetTop}px`
      dialog.style.left = `${vv.offsetLeft}px`
      dialog.style.right = 'auto'
      dialog.style.bottom = 'auto'
      dialog.style.width = `${vv.width}px`
      dialog.style.height = `${vv.height}px`
    }

    sync()
    const vv = window.visualViewport
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)

    this._cleanups.set(dialog, () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      dialog.style.top = ''
      dialog.style.left = ''
      dialog.style.right = ''
      dialog.style.bottom = ''
      dialog.style.width = ''
      dialog.style.height = ''
      this._cleanups.delete(dialog)
    })
  },

  _unbindViewport(dialog) {
    const cleanup = this._cleanups.get(dialog)
    if (cleanup) cleanup()
  },

  _centerFocus(dialog, focusEl) {
    if (!this.isMobile()) return

    const scrollContainer = dialog.querySelector('.create-channel-body') || dialog.querySelector('.changelog-panel')
    if (!scrollContainer) return

    requestAnimationFrame(() => {
      const containerRect = scrollContainer.getBoundingClientRect()
      const focusRect = focusEl.getBoundingClientRect()
      const delta = (focusRect.top + focusRect.height / 2) - (containerRect.top + containerRect.height / 2)
      if (Math.abs(delta) > 4) {
        scrollContainer.scrollTop += delta
      }
    })
  },
}
