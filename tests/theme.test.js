import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createPinia } from 'pinia'
import { THEME_STORAGE_KEY, useThemeStore } from '../src/stores/theme.js'

function browserFixture({ savedTheme, prefersDark = false, blockedStorage = false } = {}) {
  const storage = new Map(savedTheme === undefined ? [] : [[THEME_STORAGE_KEY, savedTheme]])
  const classes = new Set()
  const root = {
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name) },
      contains: name => classes.has(name)
    },
    dataset: {},
    style: {}
  }
  const meta = { setAttribute(name, value) { this[name] = value } }
  return {
    storage,
    root,
    meta,
    window: {
      localStorage: {
        getItem(key) {
          if (blockedStorage) throw new Error('Storage unavailable')
          return storage.get(key) ?? null
        },
        setItem(key, value) {
          if (blockedStorage) throw new Error('Storage unavailable')
          storage.set(key, value)
        }
      },
      matchMedia: () => ({ matches: prefersDark })
    },
    document: {
      documentElement: root,
      querySelector: selector => selector === 'meta[name="theme-color"]' ? meta : null
    }
  }
}

function installBrowser(t, fixture) {
  for (const name of ['window', 'document']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value: fixture[name] })
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else delete globalThis[name]
    })
  }
}

function createStore(t) {
  const store = useThemeStore(createPinia())
  t.after(() => store.$dispose())
  return store
}

test('saved night theme overrides system preference and applies the complete document theme', t => {
  const fixture = browserFixture({ savedTheme: 'dark' })
  installBrowser(t, fixture)
  const store = createStore(t)
  assert.equal(store.theme, 'dark')
  assert.equal(fixture.root.classList.contains('dark'), true)
  assert.equal(fixture.root.dataset.theme, 'dark')
  assert.equal(fixture.root.style.colorScheme, 'dark')
  assert.equal(fixture.meta.content, '#141b1a')
})

test('a saved day theme is retained even when the system prefers night mode', t => {
  const fixture = browserFixture({ savedTheme: 'light', prefersDark: true })
  installBrowser(t, fixture)
  const store = createStore(t)
  assert.equal(store.theme, 'light')
  assert.equal(fixture.root.classList.contains('dark'), false)
})

test('an invalid stored theme falls back to the system and is replaced with a valid choice', t => {
  const fixture = browserFixture({ savedTheme: 'invalid', prefersDark: true })
  installBrowser(t, fixture)
  const store = createStore(t)
  assert.equal(store.theme, 'dark')
  assert.equal(fixture.storage.get(THEME_STORAGE_KEY), 'dark')
})

test('theme toggles persist immediately and survive creating the store again', t => {
  const fixture = browserFixture()
  installBrowser(t, fixture)
  const store = createStore(t)
  assert.equal(store.theme, 'light')
  store.toggleTheme()
  assert.equal(store.theme, 'dark')
  assert.equal(fixture.storage.get(THEME_STORAGE_KEY), 'dark')
  store.$dispose()
  const restored = createStore(t)
  assert.equal(restored.theme, 'dark')
  restored.toggleTheme()
  assert.equal(restored.theme, 'light')
  assert.equal(fixture.storage.get(THEME_STORAGE_KEY), 'light')
  assert.equal(fixture.root.classList.contains('dark'), false)
  assert.equal(fixture.meta.content, '#ffffff')
  restored.setTheme('invalid')
  assert.equal(restored.theme, 'light')
})

test('blocked local storage does not prevent initialization or switching themes', t => {
  const fixture = browserFixture({ blockedStorage: true, prefersDark: true })
  installBrowser(t, fixture)
  const store = createStore(t)
  assert.equal(store.theme, 'dark')
  store.toggleTheme()
  assert.equal(store.theme, 'light')
  assert.equal(fixture.root.dataset.theme, 'light')
})

test('the pre-render bootstrap restores the same choice before the application runs', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const bootstrap = html.match(/<script id="theme-init">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(bootstrap)
  for (const options of [
    { savedTheme: 'dark', prefersDark: false, expected: 'dark' },
    { savedTheme: 'light', prefersDark: true, expected: 'light' },
    { savedTheme: 'invalid', prefersDark: true, expected: 'dark' },
    { blockedStorage: true, prefersDark: true, expected: 'dark' }
  ]) {
    const fixture = browserFixture(options)
    runInNewContext(bootstrap, { window: fixture.window, document: fixture.document })
    assert.equal(fixture.root.dataset.theme, options.expected)
    assert.equal(fixture.root.classList.contains('dark'), options.expected === 'dark')
    assert.equal(fixture.root.style.colorScheme, options.expected)
  }
})

test('the store can be created without browser globals for server rendering', t => {
  const store = createStore(t)
  assert.equal(store.theme, 'light')
  store.toggleTheme()
  assert.equal(store.theme, 'dark')
})
