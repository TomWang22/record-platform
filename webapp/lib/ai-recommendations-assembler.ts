export type RecommendationCandidateInput = {
  id: string
  title: string
  price?: number | null
  currency?: string | null
  tags?: string[]
  owner_scope?: string | null
}

export type RecommendationsAssemblyInput = {
  principalId: string
  candidates: RecommendationCandidateInput[]
  budget?: { max?: number | null; currency?: string | null }
  negativePreferences?: string[]
}

export const RECOMMENDATIONS_ASSEMBLER_VERSION = 'phase34b-recommendations-v1'

function normalizedTerms(values: string[] | undefined): string[] {
  return (values || []).map((value) => value.trim().toLowerCase()).filter(Boolean)
}

export function assembleRecommendationsRequest(input: RecommendationsAssemblyInput) {
  const limitations: string[] = []
  const negativePreferences = normalizedTerms(input.negativePreferences)
  const budgetCurrency = input.budget?.currency || undefined
  const budgetMax = Number(input.budget?.max)

  const candidates = input.candidates.flatMap((candidate) => {
    if (candidate.owner_scope && candidate.owner_scope !== input.principalId) {
      limitations.push(`Excluded ${candidate.id}: candidate is outside the requesting owner scope.`)
      return []
    }
    if (
      Number.isFinite(budgetMax) &&
      budgetMax >= 0 &&
      candidate.price != null &&
      Number(candidate.price) > budgetMax
    ) {
      limitations.push(`Excluded ${candidate.id}: exceeds the stated budget.`)
      return []
    }
    if (
      budgetCurrency &&
      candidate.currency &&
      candidate.currency.toUpperCase() !== budgetCurrency.toUpperCase()
    ) {
      limitations.push(`Excluded ${candidate.id}: currency differs from the stated budget.`)
      return []
    }
    const tags = normalizedTerms(candidate.tags)
    if (negativePreferences.some((preference) => tags.includes(preference))) {
      limitations.push(`Excluded ${candidate.id}: matches a negative preference.`)
      return []
    }
    return [{
      entity_id: candidate.id,
      title: candidate.title,
      price: candidate.price ?? null,
      currency: candidate.currency ?? budgetCurrency ?? null,
      owner_scope: input.principalId,
      reason_codes: [
        ...(Number.isFinite(budgetMax) && budgetMax >= 0 ? ['within_budget'] : []),
        'matched_preference',
      ],
    }]
  })

  return {
    requesting_principal_fixture: input.principalId,
    principal_id: input.principalId,
    candidates,
    // API schema expects Optional[float], not an object.
    budget: Number.isFinite(budgetMax) && budgetMax >= 0 ? budgetMax : null,
    budget_currency: budgetCurrency ?? null,
    negative_preferences: negativePreferences,
    no_pay_to_rank: true,
    sponsored_ranking_allowed: false,
    request_appreciation_prediction: false,
    allow_appreciation_prediction: false,
    authorized_scopes: ['authenticated_market', 'owner_private'],
    limitations,
    assembler_version: RECOMMENDATIONS_ASSEMBLER_VERSION,
    production_mutation_allowed: false,
  }
}
