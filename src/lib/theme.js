// Colour scheme handling.
//
// Two different defaults on purpose:
//   - the player app defaults to DARK (used in a car at dusk, battery matters,
//     and the mood suits the game)
//   - the admin panel defaults to LIGHT (long planning sessions at a desk)
// A stored preference always wins over both.
//
// Dark mode is a class on <html> ('app-dark'), which is what the PrimeVue
// preset's darkModeSelector targets and what styles.css keys its tokens off.

const STORAGE_KEY = 'oo-theme'
const DARK_CLASS = 'app-dark'

/** 'light' | 'dark' | null (null = no explicit choice stored) */
export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch (_) {
    return null
  }
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle(DARK_CLASS, theme === 'dark')
}

export function setTheme(theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch (_) { /* private mode — the class is applied either way */ }
}

export function currentTheme() {
  return document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light'
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/**
 * Build-mode default, not route-based: the routes differ per build (see
 * router/index.js). In the app build '/' is the player UI; in the web build
 * '/' is the landing page. Keying off the path would get one of them wrong.
 */
export function defaultTheme() {
  return import.meta.env.VITE_APP_MODE === 'app' ? 'dark' : 'light'
}

export function initTheme() {
  applyTheme(getStoredTheme() || defaultTheme())
}
