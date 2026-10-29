/**
 * Photo-drop catalog — code-defined, no DB needed for a handful of bundles.
 *
 * Delivery layout: files live in the private `josefine-store` bucket under
 * `<id>/` — the success page signs whatever it finds there, so adding files
 * to a bundle is just an upload. Preview thumbs are public teasers in
 * `public/store/` — swap the placeholder paths when real covers exist.
 */
export interface StoreBundle {
  id: string; // also the storage folder + stripe metadata key
  name: string;
  blurb: string;
  photoCount: number;
  priceCents: number;
  currency: "usd";
  /** public teaser image paths */
  previews: string[];
}

export const STORE_BUNDLES: StoreBundle[] = [
  {
    id: "vol-1",
    name: "vol. 1 — everyday",
    blurb: "the camera roll she'd actually send — odin, coffee, the flat",
    photoCount: 12,
    priceCents: 499,
    currency: "usd",
    previews: ["/josefine-dusk.jpg"],
  },
  {
    id: "vol-2",
    name: "vol. 2 — shoot days",
    blurb: "bts from fittings + castings, the ones that don't make the grid",
    photoCount: 25,
    priceCents: 1499,
    currency: "usd",
    previews: ["/josefine-dusk.jpg"],
  },
];

export function bundleById(id: string): StoreBundle | undefined {
  return STORE_BUNDLES.find((b) => b.id === id);
}
