import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { useInkryptStore } from './state/store'
import { extractPairingSecretFromText } from './lib/pairingSecret'
import { AuthView } from './views/AuthView'
import { VaultView } from './views/VaultView'

export function App() {
  const unlocked = useInkryptStore((s) => Boolean(s.masterKey))
  const apiSessionStatus = useInkryptStore((s) => s.apiSessionStatus)
  const hydrateRememberedSession = useInkryptStore((s) => s.hydrateRememberedSession)
  const refreshApiSession = useInkryptStore((s) => s.refreshApiSession)
  const setPairingPrefillSecret = useInkryptStore((s) => s.setPairingPrefillSecret)
  const [hydrating, setHydrating] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onRevoked = () => useInkryptStore.getState().revokeSession()
    const onSessionExpired = () => useInkryptStore.getState().markApiSessionAnonymous()
    window.addEventListener('inkrypt:device-revoked', onRevoked as EventListener)
    window.addEventListener('inkrypt:session-expired', onSessionExpired as EventListener)
    return () => {
      window.removeEventListener('inkrypt:device-revoked', onRevoked as EventListener)
      window.removeEventListener('inkrypt:session-expired', onSessionExpired as EventListener)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void Promise.all([hydrateRememberedSession(), refreshApiSession()]).finally(() => {
      if (alive) setHydrating(false)
    })
    return () => {
      alive = false
    }
  }, [hydrateRememberedSession, refreshApiSession])

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
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">正在恢复上次会话…</span>
      </div>
    )
  }

  return unlocked && apiSessionStatus === 'authenticated' ? <VaultView /> : <AuthView />
}
