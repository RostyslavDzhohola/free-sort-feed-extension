import { SITE_INDEXABLE } from "../../site.config.mjs";

export const site = {
  name: "Outliers",
  title: "Outliers — Find the Instagram Reels that broke out",
  description:
    "A free Chrome extension for Instagram research. Open a profile's Reels, press Run, and see the videos with at least 5× more views than followers.",
  storeUrl: "https://chromewebstore.google.com/detail/outliers/heogkfpbeagpoodininnfhdgjmpdalgj",
  contactEmail: "rosty.build@gmail.com",
  /** Shown on /privacy. Update when the policy changes or on launch day. */
  privacyEffectiveDate: "October 4, 2026",
  indexable: SITE_INDEXABLE,
} as const;

// The owner must confirm these are the intended public links before launch.
export const socialLinks = [
  { label: "Email", href: `mailto:${site.contactEmail}`, external: false },
  { label: "GitHub", href: "https://github.com/RostyslavDzhohola/free-sort-feed-extension", external: true },
  { label: "X", href: "https://x.com/dzhohola", external: true },
  { label: "Instagram", href: "https://www.instagram.com/heyrostyslav/", external: true },
] as const;

export const pageLinks = [
  { label: "Privacy", href: "/privacy/" },
  { label: "Support", href: "/support/" },
] as const;

export const sectionLinks = [
  { label: "Setup", id: "setup" },
  { label: "Setting the bar", id: "bar" },
  { label: "The panel", id: "tour" },
  { label: "Privacy", id: "privacy" },
  { label: "Questions", id: "faq" },
] as const;
