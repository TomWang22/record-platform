/**
 * Translate internal intelligence codes into customer-facing language.
 * Technical codes remain available only via diagnostics / developer details.
 */

const CODE_COPY: Record<string, string> = {
  SAMPLE_SIZE_BELOW_POLICY:
    'We found too few comparable sales to make a reliable claim yet.',
  NO_RELIABLE_SOLD_OR_AUCTION:
    'We do not have enough qualifying sold examples to estimate a reliable range yet. Current asking prices are shown separately and are not treated as sales.',
  AGGREGATED_ONLY:
    'Only aggregated market figures are available for this view — individual sale details are withheld.',
  NOT_INVOKED_BY_POLICY:
    'This analysis step was not run for this request under current product policy.',
  INSUFFICIENT_EVIDENCE:
    'There is not enough marketplace evidence to support a confident answer.',
  WEAK_EVIDENCE:
    'Available evidence is thin; treat this result as directional only.',
  STALE_EVIDENCE:
    'Some supporting evidence is older than our freshness window.',
  ABSTAIN:
    'We are holding back a claim because the evidence does not clear our bar.',
  UNAUTHORIZED:
    'You are not authorized to run this analysis on the selected context.',
  PRIVACY_REFUSAL:
    'This request touches private data we cannot use for recommendations or drafts.',
  SAFETY_REFUSAL:
    'We cannot assist with that negotiation tactic. A safe alternative is offered instead.',
  FABRICATED_LEVERAGE_REFUSED:
    'We cannot help with fabricated leverage. A transparent counter draft is offered instead.',
  UNSAFE_TACTIC_REFUSED:
    'We cannot assist with that negotiation tactic. A safe alternative is offered instead.',
  ZERO_RESULTS:
    'No qualifying comparable sales were found in the selected period.',
  SCHEMA_STRATEGY: 'Analysis used the standard structured strategy path.',
  RERANKER_CONFIGURATION: 'Results were ordered for marketplace relevance.',
  ENGINE_INVOCATION_STATUS: 'Analysis status is shown in plain language below.',
}

const CODE_PATTERN =
  /\b(SAMPLE_SIZE_BELOW_POLICY|NO_RELIABLE_SOLD_OR_AUCTION|AGGREGATED_ONLY|NOT_INVOKED_BY_POLICY|INSUFFICIENT_EVIDENCE|WEAK_EVIDENCE|STALE_EVIDENCE|UNAUTHORIZED|PRIVACY_REFUSAL|SAFETY_REFUSAL|FABRICATED_LEVERAGE_REFUSED|UNSAFE_TACTIC_REFUSED|ZERO_RESULTS|SCHEMA_STRATEGY|RERANKER_CONFIGURATION|ENGINE_INVOCATION_STATUS|ABSTAIN(?:_[A-Z0-9_]+)?)\b/gi

export function customerCopyForCode(code: string | null | undefined): string {
  if (!code) return ''
  const key = String(code).trim().toUpperCase()
  if (CODE_COPY[key]) return CODE_COPY[key]
  if (key.startsWith('ABSTAIN')) {
    return CODE_COPY.ABSTAIN
  }
  // Unknown codes: never show SCREAMING_SNAKE to customers.
  return 'Additional marketplace limits apply to this result.'
}

export function sanitizeCustomerFacingText(text: string | null | undefined): string {
  if (!text) return ''
  let out = String(text)
  out = out.replace(CODE_PATTERN, (match) => customerCopyForCode(match))
  // Common harness leakage patterns
  out = out.replace(/\bengine_invoked\s*=\s*\w+/gi, 'Analysis completed')
  out = out.replace(/\bschema strategy\b/gi, 'structured analysis')
  out = out.replace(/\breranker configuration\b/gi, 'relevance ranking')
  return out.trim()
}

export function evidenceCountLabel(count: number): string {
  if (count <= 0) {
    return 'No qualifying comparable sales were found in the selected period.'
  }
  if (count === 1) return '1 supporting observation'
  return `${count} supporting observations`
}

export function limitationCustomerMessage(limitation: {
  code?: string
  message?: string
}): string {
  const sanitized = sanitizeCustomerFacingText(limitation.message || '')
  if (sanitized && !/^[A-Z][A-Z0-9_]{3,}$/.test(sanitized)) {
    return sanitized
  }
  return customerCopyForCode(limitation.code) || sanitized || 'Additional limits apply.'
}
