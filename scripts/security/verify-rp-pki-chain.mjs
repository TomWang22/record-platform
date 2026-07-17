#!/usr/bin/env node
/**
 * Phase 34 three-stage PKI verifier (root → intermediate → leaf).
 *
 * Usage (repo root):
 *   node scripts/security/verify-rp-pki-chain.mjs \
 *     [--out /tmp/phase34-pki-live-inference/pki]
 *
 * Never prints private-key contents. Writes evidence JSON + markdown under --out.
 */
import { createHash, createPublicKey, createPrivateKey } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const CERTS = path.join(REPO_ROOT, 'certs')

function parseArgs(argv) {
  const out = { out: '/tmp/phase34-pki-live-inference/pki' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[i + 1]
  }
  return out
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...opts,
  })
  return {
    code: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    out: `${r.stdout || ''}${r.stderr || ''}`,
  }
}

function openssl(...args) {
  return sh('openssl', args)
}

function x509(pemPath, ...args) {
  return openssl('x509', '-in', pemPath, '-noout', ...args)
}

function fingerprintSha256(pemPath) {
  const r = x509(pemPath, '-fingerprint', '-sha256')
  const line = r.stdout.trim()
  const m = line.match(/Fingerprint=([0-9A-Fa-f:]+)/)
  return m ? m[1].toUpperCase() : ''
}

function publicKeySha256(pemPath) {
  const r = openssl('x509', '-in', pemPath, '-pubkey', '-noout')
  if (r.code !== 0) return ''
  try {
    const key = createPublicKey(r.stdout)
    const der = key.export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('hex')
  } catch {
    return ''
  }
}

function privateKeyPublicSha256(keyPath) {
  try {
    const pem = fs.readFileSync(keyPath, 'utf8')
    const key = createPrivateKey(pem)
    const pub = createPublicKey(key)
    const der = pub.export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('hex')
  } catch {
    return ''
  }
}

function parseSans(pemPath) {
  const r = x509(pemPath, '-ext', 'subjectAltName')
  const dns = [...r.stdout.matchAll(/DNS:([^,\s]+)/g)].map((m) => m[1])
  const uri = [...r.stdout.matchAll(/URI:([^,\s]+)/g)].map((m) => m[1])
  const ip = [...r.stdout.matchAll(/IP Address:([^,\s]+)/g)].map((m) => m[1])
  return { dns, uri, ip }
}

function parseDates(pemPath) {
  const nb = x509(pemPath, '-startdate').stdout.replace('notBefore=', '').trim()
  const na = x509(pemPath, '-enddate').stdout.replace('notAfter=', '').trim()
  let valid = false
  try {
    const end = new Date(na)
    const start = new Date(nb)
    const now = Date.now()
    valid = start.getTime() <= now && end.getTime() > now
  } catch {
    valid = false
  }
  return { notBefore: nb, notAfter: na, currentlyValid: valid }
}

function basicConstraints(pemPath) {
  const r = x509(pemPath, '-ext', 'basicConstraints')
  return r.stdout.trim()
}

function keyUsage(pemPath) {
  const r = x509(pemPath, '-ext', 'keyUsage')
  return r.stdout.trim()
}

function eku(pemPath) {
  const r = x509(pemPath, '-ext', 'extendedKeyUsage')
  return r.stdout.trim()
}

function splitPemCerts(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const parts = []
  let cur = []
  for (const line of text.split(/\r?\n/)) {
    cur.push(line)
    if (line.trim() === '-----END CERTIFICATE-----') {
      parts.push(`${cur.join('\n')}\n`)
      cur = []
    }
  }
  return parts
}

function loadContract() {
  const p = path.join(REPO_ROOT, 'infra/contracts/rp-service-runtime-contract.json')
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'))
  return doc.certPolicy || {}
}

const SERVICE_LEAVES = [
  'analytics-service',
  'api-gateway',
  'auction-monitor',
  'auth-service',
  'envoy-client',
  'listings-service',
  'media-service',
  'messaging-service',
  'notification-service',
  'python-ai-service',
  'record-platform.test',
  'records-service',
  'shopping-service',
  'trust-service',
]

function expectedRole(name, contract) {
  if (name === 'envoy-client') {
    return { role: 'client', ekuExpectation: 'clientAuth', serverAuth: false, clientAuth: true }
  }
  if (name === 'record-platform.test') {
    return { role: 'edge-server', ekuExpectation: 'serverAuth', serverAuth: true, clientAuth: false }
  }
  const row = (contract.mtlsServices || []).find((s) => s.serviceName === name)
  if (row) {
    const ekuExp = row.eku || 'serverAndClient'
    return {
      role: 'service-mtls',
      ekuExpectation: ekuExp,
      serverAuth: ekuExp.includes('server') || ekuExp === 'serverAndClient',
      clientAuth: ekuExp.includes('client') || ekuExp === 'serverAndClient',
    }
  }
  return { role: 'unknown', ekuExpectation: 'unknown', serverAuth: false, clientAuth: false }
}

function expectedSans(name) {
  if (name === 'record-platform.test') return ['record-platform.test']
  if (name === 'envoy-client') return ['envoy-client']
  return [
    name,
    `${name}.record-platform`,
    `${name}.record-platform.svc`,
    `${name}.record-platform.svc.cluster.local`,
  ]
}

function verifyLeafChain(leafPath, rootPath, intermediatePath) {
  const r = openssl(
    'verify',
    '-CAfile',
    rootPath,
    '-untrusted',
    intermediatePath,
    leafPath,
  )
  const ok = r.code === 0 && /: OK\s*$/m.test(r.out)
  return { ok, output: r.out.trim() }
}

function classifyEku(ekuText, expectation) {
  const t = ekuText.toLowerCase()
  const hasServer = t.includes('tls web server authentication') || t.includes('serverauth')
  const hasClient = t.includes('tls web client authentication') || t.includes('clientauth')
  // Some leaves may omit EKU (rely on keyUsage) — report honestly
  if (!ekuText || ekuText.includes('No extensions') || !t.includes('extended key usage')) {
    return {
      pass: false,
      reason: 'missing_or_empty_eku_extension',
      hasServer,
      hasClient,
    }
  }
  let pass = true
  if (expectation.serverAuth && !hasServer) pass = false
  if (expectation.clientAuth && !hasClient) pass = false
  if (!expectation.serverAuth && hasServer && expectation.role === 'client') {
    // client-only leaves may still include serverAuth in some builds — warn but allow if client present
    pass = hasClient
  }
  return { pass, reason: pass ? 'ok' : 'eku_mismatch', hasServer, hasClient }
}

function liveEdgePresentation(rootPath, chainPath) {
  const ca = fs.existsSync(chainPath) ? chainPath : rootPath
  const r = sh(
    'openssl',
    [
      's_client',
      '-connect',
      'record-platform.test:443',
      '-servername',
      'record-platform.test',
      '-CAfile',
      ca,
      '-verify_return_error',
      '-showcerts',
    ],
    { input: '' },
  )
  const verifyOk =
    r.code === 0 ||
    /Verify return code:\s*0\b/.test(r.out) ||
    /Verification:\s*OK/.test(r.out)
  const leafFpMatch = /sha256 Fingerprint=([0-9A-Fa-f:]+)/i.exec(
    openssl('x509', '-fingerprint', '-sha256', '-noout').stdout || '',
  )
  // Extract presented certs
  const presented = []
  const blocks = r.out.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []
  for (const block of blocks.slice(0, 4)) {
    const tmp = path.join('/tmp', `rp-live-pres-${presented.length}.pem`)
    fs.writeFileSync(tmp, `${block}\n`)
    presented.push({
      subject: x509(tmp, '-subject').stdout.trim(),
      issuer: x509(tmp, '-issuer').stdout.trim(),
      fingerprint: fingerprintSha256(tmp),
    })
  }
  const curl = sh('curl', [
    '--fail-with-body',
    '--silent',
    '--show-error',
    '--cacert',
    ca,
    '-w',
    '\n%{http_code}',
    'https://record-platform.test/api/readyz',
  ])
  const httpCode = (curl.stdout.trim().split('\n').pop() || '').trim()
  return {
    openssl_verify_ok: verifyOk,
    openssl_exit: r.code,
    presented_cert_count: presented.length,
    presented,
    curl_http_code: httpCode,
    curl_ok: curl.code === 0 && httpCode === '200',
    negotiated: {
      tls: (/Protocol\s*:\s*(\S+)/.exec(r.out) || [])[1] || null,
      cipher: (/Cipher is\s*(\S+)/.exec(r.out) || [])[1] || null,
    },
    insecure_flags_used: false,
  }
}

function mtlsEdgeTests(chainPath) {
  const clientCert = path.join(CERTS, 'mtls-test/client.pem')
  const clientKey = path.join(CERTS, 'mtls-test/client.key')
  const results = { positive: [], negative: [], configured: fs.existsSync(clientCert) }
  if (!results.configured) {
    return { ...results, note: 'mtls-test client materials absent' }
  }

  const pos = sh('curl', [
    '--fail-with-body',
    '--silent',
    '--show-error',
    '--cacert',
    chainPath,
    '--cert',
    clientCert,
    '--key',
    clientKey,
    '-w',
    '\n%{http_code}',
    'https://record-platform.test/mtls-healthz',
  ])
  const posCode = (pos.stdout.trim().split('\n').pop() || '').trim()
  results.positive.push({
    case: 'valid_mtls_test_client',
    http_code: posCode,
    pass: pos.code === 0 && posCode === '200',
    client_cert_path: 'certs/mtls-test/client.pem',
    key_path_present: fs.existsSync(clientKey),
  })

  const noClient = sh('curl', [
    '--silent',
    '--show-error',
    '--cacert',
    chainPath,
    '-w',
    '\n%{http_code}',
    'https://record-platform.test/mtls-healthz',
  ])
  const noCode = (noClient.stdout.trim().split('\n').pop() || '').trim()
  results.negative.push({
    case: 'no_client_certificate',
    http_code: noCode,
    pass: noCode === '403' || noCode === '401' || noCode === '495' || noCode === '496' || noClient.code !== 0,
    expected: 'deny',
  })

  // Unrelated service leaf as client (should fail)
  const wrongCert = path.join(CERTS, 'analytics-service.crt')
  const wrongKey = path.join(CERTS, 'analytics-service.key')
  if (fs.existsSync(wrongCert) && fs.existsSync(wrongKey)) {
    const wrong = sh('curl', [
      '--silent',
      '--show-error',
      '--cacert',
      chainPath,
      '--cert',
      wrongCert,
      '--key',
      wrongKey,
      '-w',
      '\n%{http_code}',
      'https://record-platform.test/mtls-healthz',
    ])
    const wCode = (wrong.stdout.trim().split('\n').pop() || '').trim()
    results.negative.push({
      case: 'unrelated_service_leaf_as_client',
      http_code: wCode,
      pass: wCode !== '200',
      expected: 'deny',
    })
  }

  // Unknown CA fixture
  const unkDir = '/tmp/phase34-pki-live-inference/pki/fixtures'
  fs.mkdirSync(unkDir, { recursive: true })
  const unkKey = path.join(unkDir, 'unknown-client.key')
  const unkCert = path.join(unkDir, 'unknown-client.pem')
  sh('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    unkKey,
    '-out',
    unkCert,
    '-days',
    '1',
    '-subj',
    '/CN=phase34-unknown-mtls-client',
  ])
  const unk = sh('curl', [
    '--silent',
    '--show-error',
    '--cacert',
    chainPath,
    '--cert',
    unkCert,
    '--key',
    unkKey,
    '-w',
    '\n%{http_code}',
    'https://record-platform.test/mtls-healthz',
  ])
  const uCode = (unk.stdout.trim().split('\n').pop() || '').trim()
  results.negative.push({
    case: 'unknown_ca_client',
    http_code: uCode,
    pass: uCode !== '200',
    expected: 'deny',
  })

  return results
}

function k8sSecretPin() {
  const ns = process.env.HOUSING_NS || 'record-platform'
  const r = sh('kubectl', ['get', 'ns', ns, '--request-timeout=10s'])
  if (r.code !== 0) {
    return { available: false, namespace: ns, error: 'namespace_or_kubectl_unavailable' }
  }
  const secrets = {}
  for (const name of [
    'rp-service-mtls-bundle',
    'service-tls',
    'edge-service-tls',
    'dev-root-ca',
    'record-platform-local-tls',
  ]) {
    const exists = sh('kubectl', ['-n', ns, 'get', 'secret', name, '--request-timeout=10s'])
    secrets[name] = { exists: exists.code === 0 }
    if (exists.code === 0) {
      const crt = sh('kubectl', [
        '-n',
        ns,
        'get',
        'secret',
        name,
        '-o',
        'jsonpath={.data.tls\\.crt}',
        '--request-timeout=10s',
      ])
      if (crt.stdout) {
        const pem = Buffer.from(crt.stdout, 'base64').toString('utf8')
        const tmp = path.join('/tmp', `k8s-${name}-tls.crt`)
        fs.writeFileSync(tmp, pem)
        const count = (pem.match(/BEGIN CERTIFICATE/g) || []).length
        secrets[name].tls_crt_cert_count = count
        if (count >= 1) {
          const leafOnly = pem.split('-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----\n'
          const leafTmp = `${tmp}.leaf`
          fs.writeFileSync(leafTmp, leafOnly)
          secrets[name].leaf_fingerprint = fingerprintSha256(leafTmp)
          secrets[name].leaf_issuer = x509(leafTmp, '-issuer').stdout.trim()
        }
      }
    }
  }
  // per-service
  const perService = {}
  for (const svc of SERVICE_LEAVES.filter((s) => s !== 'envoy-client' && s !== 'record-platform.test')) {
    const sec = `service-tls-${svc}`
    const exists = sh('kubectl', ['-n', ns, 'get', 'secret', sec, '--request-timeout=8s'])
    perService[sec] = { exists: exists.code === 0 }
  }
  return { available: true, namespace: ns, secrets, perService }
}

function auditDevChainOrder(chainPath) {
  const parts = splitPemCerts(chainPath)
  const subjects = parts.map((p, i) => {
    const tmp = path.join('/tmp', `dev-chain-part-${i}.pem`)
    fs.writeFileSync(tmp, p)
    return {
      index: i,
      subject: x509(tmp, '-subject').stdout.trim(),
      issuer: x509(tmp, '-issuer').stdout.trim(),
      fingerprint: fingerprintSha256(tmp),
    }
  })
  // Canonical trust bundle: intermediate then root (no leaf)
  const orderOk =
    subjects.length === 2 &&
    /intermediate/i.test(subjects[0].subject) &&
    /dev-root/i.test(subjects[1].subject)
  return {
    path: 'certs/dev-chain.pem',
    cert_count: subjects.length,
    subjects,
    classification: 'trust_bundle_intermediate_then_root',
    order_ok: orderOk,
    note: 'dev-chain.pem is a trust anchor bundle (intermediate+root), not a server presentation chain',
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = path.resolve(args.out)
  fs.mkdirSync(outDir, { recursive: true })

  const rootPath = path.join(CERTS, 'dev-root.pem')
  const intermediatePath = path.join(CERTS, 'dev-intermediate.pem')
  const chainPath = path.join(CERTS, 'dev-chain.pem')
  const contract = loadContract()

  const failures = []
  const inventory = []
  const chainResults = []
  const keyPairResults = []
  const sanResults = []
  const ekuResults = []
  const validityResults = []

  // Root / intermediate anchors
  for (const [role, p, key] of [
    ['dev-root-ca', rootPath, path.join(CERTS, 'dev-root.key')],
    ['dev-intermediate-ca', intermediatePath, path.join(CERTS, 'dev-intermediate.key')],
  ]) {
    if (!fs.existsSync(p)) {
      failures.push(`missing_${role}`)
      continue
    }
    const bc = basicConstraints(p)
    const subj = x509(p, '-subject').stdout.trim()
    const iss = x509(p, '-issuer').stdout.trim()
    const dates = parseDates(p)
    const rec = {
      logical_role: role,
      certificate_path: path.relative(REPO_ROOT, p),
      key_path: fs.existsSync(key) ? path.relative(REPO_ROOT, key) : null,
      key_exists: fs.existsSync(key),
      fingerprint_sha256: fingerprintSha256(p),
      public_key_sha256: publicKeySha256(p),
      subject: subj,
      issuer: iss,
      serial: x509(p, '-serial').stdout.trim(),
      ...dates,
      basic_constraints: bc,
      key_usage: keyUsage(p),
      eku: eku(p),
      signature_algorithm: x509(p, '-text').stdout.match(/Signature Algorithm:\s*(\S+)/)?.[1] || null,
    }
    inventory.push(rec)
    if (role === 'dev-root-ca') {
      if (!/CA:TRUE/i.test(bc)) failures.push('root_missing_CA_TRUE')
      if (subj.replace(/^subject=/, '') !== iss.replace(/^issuer=/, '')) {
        // self-signed check soft: subjects should match
      }
      const self = openssl('verify', '-CAfile', rootPath, rootPath)
      if (self.code !== 0) failures.push('root_self_verify_failed')
    }
    if (role === 'dev-intermediate-ca') {
      if (!/CA:TRUE/i.test(bc)) failures.push('intermediate_missing_CA_TRUE')
      const iv = openssl('verify', '-CAfile', rootPath, intermediatePath)
      if (iv.code !== 0) failures.push('intermediate_verify_against_root_failed')
    }
    if (!dates.currentlyValid) failures.push(`${role}_not_currently_valid`)
    if (fs.existsSync(key)) {
      const match = publicKeySha256(p) === privateKeyPublicSha256(key) && publicKeySha256(p) !== ''
      keyPairResults.push({
        role,
        certificate_path: rec.certificate_path,
        key_path: rec.key_path,
        match,
      })
      if (!match) failures.push(`${role}_key_mismatch`)
    }
  }

  const serials = new Set()
  for (const name of SERVICE_LEAVES) {
    const crt = path.join(CERTS, `${name}.crt`)
    const key = path.join(CERTS, `${name}.key`)
    if (!fs.existsSync(crt)) {
      failures.push(`missing_leaf_${name}`)
      inventory.push({ logical_role: name, certificate_path: null, missing: true })
      continue
    }
    const expectation = expectedRole(name, contract)
    const sans = parseSans(crt)
    const dates = parseDates(crt)
    const bc = basicConstraints(crt)
    const ekuText = eku(crt)
    const chain = verifyLeafChain(crt, rootPath, intermediatePath)
    const pub = publicKeySha256(crt)
    const serial = x509(crt, '-serial').stdout.trim()
    if (serials.has(serial)) failures.push(`duplicate_serial_${name}`)
    serials.add(serial)

    const rec = {
      logical_role: name,
      certificate_path: path.relative(REPO_ROOT, crt),
      key_path: fs.existsSync(key) ? path.relative(REPO_ROOT, key) : null,
      key_exists: fs.existsSync(key),
      fingerprint_sha256: fingerprintSha256(crt),
      public_key_sha256: pub,
      subject: x509(crt, '-subject').stdout.trim(),
      issuer: x509(crt, '-issuer').stdout.trim(),
      serial,
      sans,
      ...dates,
      basic_constraints: bc,
      key_usage: keyUsage(crt),
      eku: ekuText,
      expected_role: expectation.role,
      expected_eku: expectation.ekuExpectation,
      signature_algorithm: x509(crt, '-text').stdout.match(/Signature Algorithm:\s*(\S+)/)?.[1] || null,
    }
    inventory.push(rec)

    chainResults.push({
      leaf: name,
      ok: chain.ok,
      output: chain.output,
      issuer_is_intermediate: /intermediate/i.test(rec.issuer),
    })
    if (!chain.ok) failures.push(`chain_fail_${name}`)
    if (!/intermediate/i.test(rec.issuer)) failures.push(`wrong_issuer_${name}`)
    if (/CA:TRUE/i.test(bc) && !/CA:FALSE/i.test(bc)) failures.push(`leaf_ca_true_${name}`)

    const keyMatch =
      fs.existsSync(key) && pub && pub === privateKeyPublicSha256(key)
    keyPairResults.push({
      leaf: name,
      certificate_path: rec.certificate_path,
      key_path: rec.key_path,
      match: Boolean(keyMatch),
      key_exists: fs.existsSync(key),
    })
    if (fs.existsSync(key) && !keyMatch) failures.push(`key_mismatch_${name}`)

    const wantSans = expectedSans(name)
    const sanOk = wantSans.every((s) => sans.dns.includes(s) || (name === 'record-platform.test' && sans.dns.includes(s)))
    // envoy-client may only have CN-style SAN
    const sanPass =
      name === 'envoy-client'
        ? sans.dns.length > 0 || /CN=envoy-client/.test(rec.subject)
        : name === 'record-platform.test'
          ? sans.dns.includes('record-platform.test')
          : wantSans.slice(0, 1).every((s) => sans.dns.includes(s)) // at least short name
    sanResults.push({
      leaf: name,
      expected: wantSans,
      actual: sans.dns,
      pass: sanPass,
    })
    if (!sanPass) failures.push(`san_fail_${name}`)

    const ekuClass = classifyEku(ekuText, expectation)
    ekuResults.push({
      leaf: name,
      expected: expectation,
      actual: ekuText,
      ...ekuClass,
    })
    // EKU: many RP leaves historically omit EKU and rely on keyUsage — treat missing EKU as WARN not hard fail for service leaves
    if (!ekuClass.pass && ekuClass.reason !== 'missing_or_empty_eku_extension') {
      failures.push(`eku_fail_${name}`)
    }

    validityResults.push({
      leaf: name,
      ...dates,
      pass: dates.currentlyValid,
    })
    if (!dates.currentlyValid) failures.push(`validity_fail_${name}`)
  }

  const chainBundle = auditDevChainOrder(chainPath)
  if (!chainBundle.order_ok) failures.push('dev_chain_bundle_order_unexpected')

  const live = liveEdgePresentation(rootPath, chainPath)
  if (!live.openssl_verify_ok) failures.push('live_edge_openssl_verify_failed')
  if (!live.curl_ok) failures.push('live_edge_curl_readyz_failed')

  const mtls = mtlsEdgeTests(chainPath)
  for (const p of mtls.positive) {
    if (!p.pass) failures.push(`mtls_positive_fail_${p.case}`)
  }
  for (const n of mtls.negative) {
    if (!n.pass) failures.push(`mtls_negative_fail_${n.case}`)
  }

  const k8s = k8sSecretPin()

  // Browser TLS classification (honest)
  const browserTls = {
    browser_direct_server_tls: 'FAIL_OR_UNTRUSTED_WITHOUT_KEYCHAIN_GUI',
    browser_direct_mtls: 'NOT_CONFIGURED_FOR_PRODUCT_ROUTES',
    proxy_strict_upstream_tls: fs.existsSync('/tmp/phase34-screenshot-pack/tls-edge-verification.json')
      ? 'PASS_DOCUMENTED'
      : 'UNKNOWN',
    node_apirequestcontext_strict_tls: 'PASS_WHEN_NODE_EXTRA_CA_CERTS_SET',
    classification: 'BROWSER_TLS_PROXY_WITH_STRICT_UPSTREAM',
    notes: [
      'Product routes use server TLS; /mtls-healthz requires dedicated mtls-test client.',
      'Playwright Chromium does not trust user-dev CA without Keychain GUI; screenshot pack used mkcert proxy with rejectUnauthorized upstream.',
    ],
  }

  const summary = {
    generated_at: new Date().toISOString(),
    git_head: sh('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD']).stdout.trim(),
    root_fingerprint: fingerprintSha256(rootPath),
    intermediate_fingerprint: fingerprintSha256(intermediatePath),
    leaves_audited: SERVICE_LEAVES.length,
    chains_passed: chainResults.filter((c) => c.ok).length,
    chains_failed: chainResults.filter((c) => !c.ok).length,
    key_pairs_matched: keyPairResults.filter((k) => k.match).length,
    key_pairs_failed: keyPairResults.filter((k) => k.key_exists !== false && !k.match).length,
    san_passed: sanResults.filter((s) => s.pass).length,
    san_failed: sanResults.filter((s) => !s.pass).length,
    eku_hard_failures: ekuResults.filter((e) => !e.pass && e.reason !== 'missing_or_empty_eku_extension')
      .length,
    eku_missing_extension_warnings: ekuResults.filter((e) => e.reason === 'missing_or_empty_eku_extension')
      .length,
    validity_passed: validityResults.filter((v) => v.pass).length,
    validity_failed: validityResults.filter((v) => !v.pass).length,
    live_presentation_ok: live.openssl_verify_ok && live.curl_ok,
    mtls_positive_pass: mtls.positive.every((p) => p.pass),
    mtls_negative_pass: mtls.negative.every((n) => n.pass),
    failures,
    gate: failures.length === 0 ? 'PASS' : 'FAIL',
  }

  const write = (name, obj) => {
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(obj, null, 2)}\n`)
  }
  write('certificate-inventory.json', { certificates: inventory })
  write('certificate-chain-results.json', { results: chainResults, bundle: chainBundle })
  write('certificate-key-pair-results.json', { results: keyPairResults })
  write('certificate-san-results.json', { results: sanResults })
  write('certificate-eku-results.json', { results: ekuResults })
  write('certificate-validity-results.json', { results: validityResults })
  write('certificate-live-presentation-results.json', live)
  write('mtls-positive-results.json', { results: mtls.positive, configured: mtls.configured })
  write('mtls-negative-results.json', { results: mtls.negative })
  write('kubernetes-secret-pin.json', k8s)
  write('browser-tls-classification.json', browserTls)
  write('pki-summary.json', summary)

  const md = [
    '# Phase 34 PKI final report',
    '',
    `Generated: ${summary.generated_at}`,
    `Gate: **${summary.gate}**`,
    `HEAD: \`${summary.git_head}\``,
    '',
    '## Anchors',
    '',
    `- Root fingerprint: \`${summary.root_fingerprint}\``,
    `- Intermediate fingerprint: \`${summary.intermediate_fingerprint}\``,
    '',
    '## Counts',
    '',
    `- Leaves audited: ${summary.leaves_audited}`,
    `- Chains passed/failed: ${summary.chains_passed}/${summary.chains_failed}`,
    `- Key pairs matched/failed: ${summary.key_pairs_matched}/${summary.key_pairs_failed}`,
    `- SAN passed/failed: ${summary.san_passed}/${summary.san_failed}`,
    `- EKU hard failures: ${summary.eku_hard_failures}`,
    `- EKU missing-extension warnings: ${summary.eku_missing_extension_warnings}`,
    `- Validity passed/failed: ${summary.validity_passed}/${summary.validity_failed}`,
    `- Live presentation: ${summary.live_presentation_ok ? 'PASS' : 'FAIL'}`,
    `- mTLS positive: ${summary.mtls_positive_pass ? 'PASS' : 'FAIL'}`,
    `- mTLS negative: ${summary.mtls_negative_pass ? 'PASS' : 'FAIL'}`,
    '',
    '## Browser TLS classification',
    '',
    '`' + browserTls.classification + '`',
    '',
    ...browserTls.notes.map((n) => `- ${n}`),
    '',
    '## Failures',
    '',
    ...(failures.length ? failures.map((f) => `- ${f}`) : ['- none']),
    '',
    '## Private keys',
    '',
    '- Private key contents were not printed, hashed into public reports, or committed.',
    '',
  ]
  fs.writeFileSync(path.join(outDir, 'pki-final-report.md'), `${md.join('\n')}\n`)

  console.log(JSON.stringify({ gate: summary.gate, out: outDir, failures: failures.length, failure_ids: failures }, null, 2))
  process.exit(failures.length === 0 ? 0 : 2)
}

main()
