'use client'

import type { MarketplaceListing } from '@/lib/listings-types'
import {
  auctionAmenityEntries,
  oboAmenityEntries,
  parseAuctionFromRow,
  parseOboFromRow,
  parseShippingFromRow,
  resolveSaleMode,
  shippingAmenityEntries,
  type ListingAuctionSettings,
  type ListingOboSettings,
  type ListingShippingInfo,
} from '@/lib/listing-rp-metadata'

export type ListingSaleMode = 'fixed' | 'obo' | 'auction'

export type ListingFormValues = {
  title: string
  description: string
  saleMode: ListingSaleMode
  price: string
  status: string
  images: string[]
  primaryImageIndex: number
  videoUrl: string
  shipping: ListingShippingInfo
  obo: ListingOboSettings
  auction: ListingAuctionSettings
  shipsFromCity: string
  shipsFromRegion: string
  shipsFromCountry: string
}

export function listingToFormValues(listing: MarketplaceListing): ListingFormValues {
  const row = listing as unknown as Record<string, unknown>
  const saleMode = resolveSaleMode(row)
  const price =
    listing.price != null
      ? String(listing.price)
      : listing.price_cents != null
        ? String((listing.price_cents / 100).toFixed(2))
        : ''
  const images = listing.images?.length
    ? [...listing.images]
    : listing.primaryImageUrl
      ? [listing.primaryImageUrl]
      : []
  const shipping = parseShippingFromRow(row)
  return {
    title: listing.title,
    description: listing.description ?? '',
    saleMode:
      saleMode === 'auction' ? 'auction' : saleMode === 'obo' ? 'obo' : 'fixed',
    price,
    status: String(listing.status ?? listing.listing_status ?? 'active'),
    images,
    primaryImageIndex: 0,
    videoUrl: '',
    shipping: {
      ...shipping,
      shipsFromCity: shipping.shipsFromCity ?? listing.seller_city ?? '',
      shipsFromRegion: shipping.shipsFromRegion ?? listing.seller_region ?? '',
      shipsFromCountry: shipping.shipsFromCountry ?? listing.seller_country ?? listing.country ?? '',
    },
    obo: parseOboFromRow(row),
    auction: parseAuctionFromRow(row),
    shipsFromCity: shipping.shipsFromCity ?? listing.seller_city ?? '',
    shipsFromRegion: shipping.shipsFromRegion ?? listing.seller_region ?? '',
    shipsFromCountry: shipping.shipsFromCountry ?? listing.seller_country ?? listing.country ?? 'US',
  }
}

export function formValuesToPatchBody(values: ListingFormValues): Record<string, unknown> {
  const n = Number(values.price)
  const pricing_mode =
    values.saleMode === 'auction' ? 'auction' : values.saleMode === 'obo' ? 'obo' : 'fixed'
  const amenityParts = [
    ...shippingAmenityEntries({
      ...values.shipping,
      shipsFromCity: values.shipsFromCity || values.shipping.shipsFromCity,
      shipsFromRegion: values.shipsFromRegion || values.shipping.shipsFromRegion,
      shipsFromCountry: values.shipsFromCountry || values.shipping.shipsFromCountry,
    }),
    ...(values.saleMode === 'obo' ? oboAmenityEntries(values.obo) : []),
    ...(values.saleMode === 'auction' ? auctionAmenityEntries(values.auction) : []),
    `sale_type:${values.saleMode === 'auction' ? 'auction' : values.saleMode === 'obo' ? 'obo' : 'fixed'}`,
  ]
  if (values.videoUrl.trim()) {
    amenityParts.push(`video_url:${values.videoUrl.trim()}`)
  }
  const body: Record<string, unknown> = {
    title: values.title.trim(),
    description: values.description.trim(),
    pricing_mode,
    amenities: amenityParts,
    city: values.shipsFromCity.trim() || undefined,
    state_or_province: values.shipsFromRegion.trim() || undefined,
    country: values.shipsFromCountry.trim() || undefined,
  }
  if (Number.isFinite(n) && n >= 0) {
    body.price_cents = Math.round(n * 100)
  }
  return body
}

type Props = {
  values: ListingFormValues
  onChange: (v: ListingFormValues) => void
}

export function ListingEditForm({ values, onChange }: Props) {
  const set = (patch: Partial<ListingFormValues>) => onChange({ ...values, ...patch })

  function moveImage(from: number, to: number) {
    if (to < 0 || to >= values.images.length) return
    const next = [...values.images]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    let primary = values.primaryImageIndex
    if (primary === from) primary = to
    else if (from < primary && to >= primary) primary -= 1
    else if (from > primary && to <= primary) primary += 1
    set({ images: next, primaryImageIndex: primary })
  }

  return (
    <div className="space-y-8" data-testid="listing-edit-form">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Basics</h2>
        <label className="block text-sm">
          <span className="font-medium">Title</span>
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Description</span>
          <textarea
            rows={4}
            className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Listing status</span>
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
            value={values.status}
            onChange={(e) => set({ status: e.target.value })}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
            <option value="draft">Draft</option>
          </select>
        </label>
      </section>

      <section className="space-y-3" data-testid="listing-edit-media">
        <h2 className="text-lg font-semibold">Media</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {values.images.map((url, i) => (
            <div key={`${url}-${i}`} className="flex gap-2 rounded-xl border p-2 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
              <div className="flex flex-1 flex-col gap-1">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    checked={values.primaryImageIndex === i}
                    onChange={() => set({ primaryImageIndex: i })}
                  />
                  Primary
                </label>
                <button
                  type="button"
                  className="text-xs text-brand"
                  disabled={i === 0}
                  onClick={() => moveImage(i, i - 1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="text-xs text-brand"
                  disabled={i >= values.images.length - 1}
                  onClick={() => moveImage(i, i + 1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => {
                    const next = values.images.filter((_, j) => j !== i)
                    set({
                      images: next,
                      primaryImageIndex: Math.min(values.primaryImageIndex, Math.max(0, next.length - 1)),
                    })
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <label className="block text-sm">
          <span className="font-medium">Add image URL</span>
          <div className="mt-1 flex gap-2">
            <input
              id="listing-edit-new-image"
              className="flex-1 rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              placeholder="https://…"
            />
            <button
              type="button"
              className="rounded-xl bg-brand px-3 py-2 text-sm text-white"
              onClick={() => {
                const el = document.getElementById('listing-edit-new-image') as HTMLInputElement | null
                const url = el?.value.trim()
                if (!url) return
                set({ images: [...values.images, url] })
                if (el) el.value = ''
              }}
            >
              Add
            </button>
          </div>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Video URL (optional)</span>
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
            value={values.videoUrl}
            onChange={(e) => set({ videoUrl: e.target.value })}
            placeholder="https://…"
          />
        </label>
      </section>

      <section className="space-y-3" data-testid="listing-edit-shipping">
        <h2 className="text-lg font-semibold">Shipping</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Domestic cost (USD)
            <input
              type="number"
              min={0}
              step="0.01"
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={
                values.shipping.domesticCostCents != null
                  ? values.shipping.domesticCostCents / 100
                  : ''
              }
              onChange={(e) => {
                const v = e.target.value
                set({
                  shipping: {
                    ...values.shipping,
                    domesticCostCents: v === '' ? undefined : Math.round(Number(v) * 100),
                  },
                })
              }}
            />
          </label>
          <label className="text-sm">
            International cost (USD)
            <input
              type="number"
              min={0}
              step="0.01"
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={
                values.shipping.internationalCostCents != null
                  ? values.shipping.internationalCostCents / 100
                  : ''
              }
              onChange={(e) => {
                const v = e.target.value
                set({
                  shipping: {
                    ...values.shipping,
                    internationalCostCents: v === '' ? undefined : Math.round(Number(v) * 100),
                  },
                })
              }}
            />
          </label>
          <label className="text-sm">
            Service
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={values.shipping.service ?? ''}
              onChange={(e) =>
                set({ shipping: { ...values.shipping, service: e.target.value } })
              }
            />
          </label>
          <label className="text-sm">
            Package type
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={values.shipping.packageType ?? ''}
              onChange={(e) =>
                set({ shipping: { ...values.shipping, packageType: e.target.value } })
              }
            />
          </label>
          <label className="text-sm">
            Ships from — city
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={values.shipsFromCity}
              onChange={(e) => set({ shipsFromCity: e.target.value })}
            />
          </label>
          <label className="text-sm">
            State / region
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={values.shipsFromRegion}
              onChange={(e) => set({ shipsFromRegion: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Country
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={values.shipsFromCountry}
              onChange={(e) => set({ shipsFromCountry: e.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.shipping.domesticShipping ?? true}
              onChange={(e) =>
                set({ shipping: { ...values.shipping, domesticShipping: e.target.checked } })
              }
            />
            Domestic shipping
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.shipping.internationalShipping ?? false}
              onChange={(e) =>
                set({
                  shipping: { ...values.shipping, internationalShipping: e.target.checked },
                })
              }
            />
            International
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.shipping.localPickup ?? false}
              onChange={(e) =>
                set({ shipping: { ...values.shipping, localPickup: e.target.checked } })
              }
            />
            Local pickup
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.shipping.combinedShipping ?? false}
              onChange={(e) =>
                set({ shipping: { ...values.shipping, combinedShipping: e.target.checked } })
              }
            />
            Combined shipping
          </label>
        </div>
        <label className="block text-sm">
          <span className="font-medium">Shipping notes</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
            value={values.shipping.notes ?? ''}
            onChange={(e) =>
              set({ shipping: { ...values.shipping, notes: e.target.value } })
            }
          />
        </label>
      </section>

      <section className="space-y-3" data-testid="listing-edit-sale-mode">
        <h2 className="text-lg font-semibold">Sale mode</h2>
        <select
          className="w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
          value={values.saleMode}
          onChange={(e) => set({ saleMode: e.target.value as ListingSaleMode })}
        >
          <option value="fixed">Fixed price</option>
          <option value="obo">OBO (best offer)</option>
          <option value="auction">Auction</option>
        </select>
        {(values.saleMode === 'fixed' || values.saleMode === 'obo') && (
          <label className="block text-sm">
            <span className="font-medium">Price (USD)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
              value={values.price}
              onChange={(e) => set({ price: e.target.value })}
            />
          </label>
        )}
      </section>

      {values.saleMode === 'obo' && (
        <section className="space-y-3" data-testid="listing-edit-obo">
          <h2 className="text-lg font-semibold">OBO settings</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Max offer attempts
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={values.obo.maxOfferAttempts ?? ''}
                onChange={(e) =>
                  set({
                    obo: {
                      ...values.obo,
                      maxOfferAttempts: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Offer expiration (hours)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={values.obo.offerExpirationHours ?? ''}
                onChange={(e) =>
                  set({
                    obo: {
                      ...values.obo,
                      offerExpirationHours: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Auto-accept (USD)
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={
                  values.obo.autoAcceptCents != null ? values.obo.autoAcceptCents / 100 : ''
                }
                onChange={(e) =>
                  set({
                    obo: {
                      ...values.obo,
                      autoAcceptCents:
                        e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100),
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Auto-decline below (USD)
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={
                  values.obo.autoDeclineCents != null ? values.obo.autoDeclineCents / 100 : ''
                }
                onChange={(e) =>
                  set({
                    obo: {
                      ...values.obo,
                      autoDeclineCents:
                        e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100),
                    },
                  })
                }
              />
            </label>
          </div>
        </section>
      )}

      {values.saleMode === 'auction' && (
        <section className="space-y-3" data-testid="listing-edit-auction">
          <h2 className="text-lg font-semibold">Auction settings</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Starting bid (USD)
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={
                  values.auction.startingBidCents != null
                    ? values.auction.startingBidCents / 100
                    : ''
                }
                onChange={(e) =>
                  set({
                    auction: {
                      ...values.auction,
                      startingBidCents:
                        e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100),
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Reserve (USD)
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={
                  values.auction.reserveCents != null ? values.auction.reserveCents / 100 : ''
                }
                onChange={(e) =>
                  set({
                    auction: {
                      ...values.auction,
                      reserveCents:
                        e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100),
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Buy it now (USD)
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={
                  values.auction.buyItNowCents != null ? values.auction.buyItNowCents / 100 : ''
                }
                onChange={(e) =>
                  set({
                    auction: {
                      ...values.auction,
                      buyItNowCents:
                        e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100),
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Starts at
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={
                  values.auction.startsAt
                    ? values.auction.startsAt.slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  set({
                    auction: {
                      ...values.auction,
                      startsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Ends at
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={values.auction.endsAt ? values.auction.endsAt.slice(0, 16) : ''}
                onChange={(e) =>
                  set({
                    auction: {
                      ...values.auction,
                      endsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    },
                  })
                }
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Rollover / auto-relist
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-slate-950"
                value={values.auction.rolloverMode ?? 'none'}
                onChange={(e) =>
                  set({
                    auction: { ...values.auction, rolloverMode: e.target.value },
                  })
                }
              >
                <option value="none">No rollover</option>
                <option value="relist_once">Relist once if unsold</option>
                <option value="relist_until_sold">Relist until sold</option>
              </select>
            </label>
          </div>
        </section>
      )}
    </div>
  )
}
