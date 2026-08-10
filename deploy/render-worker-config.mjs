import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  /** @type {Record<string, string | boolean | undefined> & { _: string[] }} */
  const out = { _: [] }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }

    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
      continue
    }
    out[key] = true
  }

  return out
}

function q(value) {
  return JSON.stringify(String(value))
}

function replaceLine(content, key, value) {
  const re = new RegExp(`^${key}\\s*=.*$`, 'm')
  const line = `${key} = ${q(value)}`
  if (!re.test(content)) throw new Error(`Expected TOML key not found: ${key}`)
  return content.replace(re, line)
}

function replaceOrInsertAfter(content, key, value, afterKey) {
  const re = new RegExp(`^${key}\\s*=.*$`, 'm')
  const line = `${key} = ${q(value)}`
  if (re.test(content)) return content.replace(re, line)

  const afterRe = new RegExp(`^${afterKey}\\s*=.*$`, 'm')
  if (!afterRe.test(content)) throw new Error(`Cannot insert ${key}: after-key not found: ${afterKey}`)
  return content.replace(afterRe, (m) => `${m}\n${line}`)
}

function required(name, value) {
  const v = String(value ?? '').trim()
  if (!v) throw new Error(`Missing required: ${name}`)
  return v
}

const args = parseArgs(process.argv.slice(2))

const templatePath = path.resolve(String(args.template ?? 'apps/worker/wrangler.toml.example'))
const outPath = path.resolve(String(args.out ?? 'apps/worker/wrangler.toml'))

const workerName = required('worker-name', args['worker-name'] ?? process.env.INKRYPT_WORKER_NAME)
const accountId = required('account-id', args['account-id'] ?? process.env.CLOUDFLARE_ACCOUNT_ID)

const rpName = required('rp-name', args['rp-name'] ?? process.env.INKRYPT_RP_NAME ?? 'Inkrypt')
const rpId = required('rp-id', args['rp-id'] ?? process.env.INKRYPT_RP_ID ?? process.env.DOMAIN)
const origin = required('origin', args.origin ?? process.env.INKRYPT_ORIGIN ?? (rpId ? `https://${rpId}` : ''))
const corsOrigin = required('cors-origin', args['cors-origin'] ?? process.env.INKRYPT_CORS_ORIGIN ?? origin)
const cookieSameSite = required('cookie-samesite', args['cookie-samesite'] ?? process.env.INKRYPT_COOKIE_SAMESITE ?? 'Lax')
const releaseSha = required('release-sha', args['release-sha'] ?? process.env.GITHUB_SHA ?? 'development')

const d1Name = required('d1-name', args['d1-name'] ?? process.env.INKRYPT_D1_NAME)
const d1Id = required('d1-id', args['d1-id'] ?? process.env.INKRYPT_D1_ID)

let content = fs.readFileSync(templatePath, 'utf8')

content = replaceLine(content, 'name', workerName)
content = replaceOrInsertAfter(content, 'account_id', accountId, 'name')

content = replaceLine(content, 'RP_NAME', rpName)
content = replaceLine(content, 'RP_ID', rpId)
content = replaceLine(content, 'ORIGIN', origin)
content = replaceLine(content, 'CORS_ORIGIN', corsOrigin)
content = replaceLine(content, 'COOKIE_SAMESITE', cookieSameSite)
content = replaceLine(content, 'ENVIRONMENT', 'production')
content = replaceLine(content, 'TENANCY_MODE', 'single')
content = replaceLine(content, 'VAULT_USERNAME', 'vault')
content = replaceLine(content, 'RELEASE_SHA', releaseSha)

content = replaceLine(content, 'database_name', d1Name)
content = replaceLine(content, 'database_id', d1Id)

fs.writeFileSync(outPath, content)
process.stdout.write(`Wrote ${outPath}\n`)
