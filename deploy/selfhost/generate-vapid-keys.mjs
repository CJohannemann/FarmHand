#!/usr/bin/env node
//
// Makes the key pair phone notifications are signed with, and writes it
// where it goes — nothing to copy and paste:
//
//   deploy/selfhost/.env   VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, for
//                          send-notifications.ts to sign with
//   .env (the repo root)   VITE_VAPID_PUBLIC_KEY, the public half only,
//                          for the app to turn alerts on with
//
// A phone's "alerts on" is tied to the key it signed up with, so once the
// keys are made this will not replace them: new keys would quietly stop
// every phone that already turned alerts on. --force replaces them anyway
// (and everyone then turns alerts on again).
//
//   node generate-vapid-keys.mjs
//   node generate-vapid-keys.mjs --force
//
// No dependency needed: createECDH's raw output is already the format
// VAPID wants — the same as PropertyManagement's copy of this script.
import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ENV = join(HERE, '.env')
const APP_ENV = join(HERE, '..', '..', '.env')
const force = process.argv.includes('--force')

for (const f of [SERVER_ENV, APP_ENV]) {
  if (!existsSync(f)) {
    console.error(`${f} doesn't exist yet — it is made during the server's first setup (see deploy/README.md).`)
    process.exit(1)
  }
}

const read = (f, name) => readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
if (read(SERVER_ENV, 'VAPID_PUBLIC_KEY') && !force) {
  console.log('Notification keys are already set up — nothing changed.')
  console.log('(node generate-vapid-keys.mjs --force makes new ones, and every phone then has to turn alerts on again.)')
  process.exit(0)
}

const ecdh = crypto.createECDH('prime256v1')
ecdh.generateKeys()
const b64url = (buf) => buf.toString('base64url')
const pub = b64url(ecdh.getPublicKey())
const priv = b64url(ecdh.getPrivateKey())

// Replaces the line if it's there (blank or not), adds it if it isn't.
function setLine(f, name, value) {
  let text = readFileSync(f, 'utf8')
  const line = `${name}=${value}`
  const re = new RegExp(`^${name}=.*$`, 'm')
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`
  writeFileSync(f, text)
}

setLine(SERVER_ENV, 'VAPID_PUBLIC_KEY', pub)
setLine(SERVER_ENV, 'VAPID_PRIVATE_KEY', priv)
setLine(APP_ENV, 'VITE_VAPID_PUBLIC_KEY', pub)

console.log('Notification keys made and saved:')
console.log(`  ${SERVER_ENV}  (both keys)`)
console.log(`  ${APP_ENV}  (the public key, for the app)`)
console.log('Next: bash deploy/deploy.sh, so the app is built with it.')
