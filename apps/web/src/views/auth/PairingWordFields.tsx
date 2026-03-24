import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  PAIRING_SECRET_WORD_COUNT,
  PAIRING_WORDLIST,
  extractPairingSecretFromText,
  resolvePairingWord,
  splitPairingSecretWords,
} from '../../lib/pairingSecret'

export type PairingWordFieldsHandle = {
  focusWord: (index: number) => void
}

type PairingWordFieldsProps = {
  pairWords: string[]
  onPairWordsChange: Dispatch<SetStateAction<string[]>>
}

function normalizePairWordInput(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z]/g, '')
}

export const PairingWordFields = forwardRef<PairingWordFieldsHandle, PairingWordFieldsProps>(
  function PairingWordFields({ pairWords, onPairWordsChange }, ref) {
    const [activePairWordIdx, setActivePairWordIdx] = useState<number | null>(null)
    const pairWordRefs = useRef<Array<HTMLInputElement | null>>([])

    useImperativeHandle(ref, () => ({
      focusWord(index: number) {
        pairWordRefs.current[index]?.focus()
      },
    }))

    const activePairWordPrefix = useMemo(() => {
      if (activePairWordIdx === null) return ''
      return normalizePairWordInput(pairWords[activePairWordIdx] ?? '')
    }, [activePairWordIdx, pairWords])

    const activePairWordSuggestions = useMemo(() => {
      const prefix = activePairWordPrefix
      if (activePairWordIdx === null) return []
      if (prefix.length < 2) return []
      if (!prefix) return []
      if (resolvePairingWord(prefix) === prefix) return []

      const out: string[] = []
      for (const word of PAIRING_WORDLIST) {
        if (word.startsWith(prefix)) out.push(word)
        if (out.length >= 8) break
      }
      return out
    }, [activePairWordIdx, activePairWordPrefix])

    return (
      <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {pairWords.map((word, idx) => {
            const resolved = resolvePairingWord(word)
            const cleaned = normalizePairWordInput(word)
            const invalid = Boolean(cleaned) && cleaned.length >= 4 && !resolved

            return (
              <Input
                key={idx}
                ref={(el) => {
                  pairWordRefs.current[idx] = el
                }}
                className={cn(invalid && 'border-destructive ring-destructive/20')}
                value={word}
                onChange={(e) => {
                  const nextWord = normalizePairWordInput(e.target.value)
                  onPairWordsChange((prev) => {
                    const next = [...prev]
                    next[idx] = nextWord
                    return next
                  })
                }}
                onFocus={() => setActivePairWordIdx(idx)}
                onBlur={() => {
                  if (!resolved || resolved === word) return
                  onPairWordsChange((prev) => {
                    const next = [...prev]
                    next[idx] = resolved
                    return next
                  })
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    pairWordRefs.current[Math.min(idx + 1, PAIRING_SECRET_WORD_COUNT - 1)]?.focus()
                    return
                  }
                  if (e.key === 'Backspace' && !word && idx > 0) {
                    pairWordRefs.current[idx - 1]?.focus()
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (!text) return

                  const extracted = extractPairingSecretFromText(text)
                  if (extracted) {
                    e.preventDefault()
                    onPairWordsChange(splitPairingSecretWords(extracted))
                    requestAnimationFrame(() => {
                      pairWordRefs.current[Math.min(PAIRING_SECRET_WORD_COUNT - 1, idx + 1)]?.focus()
                    })
                    return
                  }

                  const words = splitPairingSecretWords(text)
                  if (words.length <= 1) return
                  e.preventDefault()
                  onPairWordsChange((prev) => {
                    const next = [...prev]
                    for (let i = 0; i < words.length && idx + i < PAIRING_SECRET_WORD_COUNT; i += 1) {
                      next[idx + i] = words[i]
                    }
                    return next
                  })
                }}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={`单词 ${idx + 1}`}
              />
            )
          })}
        </div>

        {activePairWordSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activePairWordSuggestions.map((word) => (
              <Button
                key={word}
                variant="outline"
                size="sm"
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  const idx = activePairWordIdx
                  if (idx === null) return
                  onPairWordsChange((prev) => {
                    const next = [...prev]
                    next[idx] = word
                    return next
                  })
                  requestAnimationFrame(() => {
                    pairWordRefs.current[Math.min(idx + 1, PAIRING_SECRET_WORD_COUNT - 1)]?.focus()
                  })
                }}
              >
                {word}
              </Button>
            ))}
          </div>
        )}
      </>
    )
  },
)

PairingWordFields.displayName = 'PairingWordFields'
