import { useEffect, useState } from 'react'
import { useInkryptStore } from './state/store'
import { extractPairingSecretFromText } from './lib/pairingSecret'
import { AuthView } from './views/AuthView'
import { VaultView } from './views/VaultView'

export function App() {
  const unlocked = useInkryptStore((s) => Boolean(s.masterKey))
  const hydrateRememberedSession = useInkryptStore((s) => s.hydrateRememberedSession)
  const setPairingPrefillSecret = useInkryptStore((s) => s.setPairingPrefillSecret)
  const [hydrating, setHydrating] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onRevoked = () => useInkryptStore.getState().lock()
    window.addEventListener('inkrypt:device-revoked', onRevoked as EventListener)
    return () => window.removeEventListener('inkrypt:device-revoked', onRevoked as EventListener)
  }, [])

  useEffect(() => {
    let alive = true
    void hydrateRememberedSession().finally(() => {
      if (alive) setHydrating(false)
    })
    return () => {
      alive = false
    }
  }, [hydrateRememberedSession])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const secret = extractPairingSecretFromText(window.location.href)
    if (!secret) return

    setPairingPrefillSecret(secret)

    try {
      window.history.replaceState(window.history.state, '', '/')
    } catch {
      // If replaceState is unavailable, best-effort remove the fragment.
      try {
        window.location.hash = ''
      } catch {
        // ignore
      }
    }
  }, [setPairingPrefillSecret])

  useEffect(() => {
    if (unlocked) setPairingPrefillSecret(null)
  }, [setPairingPrefillSecret, unlocked])

  if (hydrating) {
    return (
      <div className="appBoot" aria-busy="true" aria-label="正在恢复上次会话">
        <span className="spinner" aria-hidden="true" />
        <span>正在恢复上次会话…</span>
      </div>
    )
  }

  return unlocked ? <VaultView /> : <AuthView />
}
