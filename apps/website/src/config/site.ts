import { DATAFAST, PROMO_VIDEO, RELEASE_1_1, SITE_INDEXABLE } from "../../site.config.mjs";
import type { IconId } from "../components/icons";

export const site = {
  name: "Outliers",
  title: "Outliers — Find the Instagram Reels that broke out",
  description:
    "A free Chrome extension for Instagram research. Open a profile's Reels, press Run, and see the videos with at least 5× more views than followers.",
  storeUrl: "https://chromewebstore.google.com/detail/outliers/heogkfpbeagpoodininnfhdgjmpdalgj",
  /** The extension's public source code. */
  repoUrl: "https://github.com/RostyslavDzhohola/free-sort-feed-extension",
  contactEmail: "rosty.build@gmail.com",
  /** Shown on /privacy. Update when the policy changes or on launch day. */
  privacyEffectiveDate: "October 27, 2026",
  indexable: SITE_INDEXABLE,
  /** DataFast analytics (cookieless), or false. See site.config.mjs. */
  analytics: DATAFAST,
  /** Outliers 1.1 copy and promo video, off until 1.1 is live in the store. See site.config.mjs. */
  release11: RELEASE_1_1,
  promoVideo: RELEASE_1_1 ? PROMO_VIDEO : null,
} as const;

/** A footer icon link. `href: null` hides the link, e.g. while a URL is pending. */
export interface SocialLink {
  icon: IconId;
  /** Accessible name and tooltip. */
  label: string;
  href: string | null;
}

// Every public identity link on the site lives here (DESIGN-SPEC §0.4). All confirmed by the owner.
export const socialLinks: SocialLink[] = [
  { icon: "email", label: `Email ${site.contactEmail}`, href: `mailto:${site.contactEmail}` },
  { icon: "instagram", label: "Instagram · @heyrostyslav", href: "https://www.instagram.com/heyrostyslav/" },
  { icon: "x", label: "X · @dzhohola", href: "https://x.com/dzhohola" },
  { icon: "tiktok", label: "TikTok · @rostyslavdzhohola", href: "https://www.tiktok.com/@rostyslavdzhohola" },
  { icon: "github", label: "GitHub · RostyslavDzhohola", href: "https://github.com/RostyslavDzhohola" },
  { icon: "youtube", label: "YouTube · @RostyslavDzhohola", href: "https://www.youtube.com/@RostyslavDzhohola" },
  { icon: "linkedin", label: "LinkedIn · Rostyslav Dzhohola", href: "https://www.linkedin.com/in/rostyslav-dzhohola/" },
  { icon: "portfolio", label: "Portfolio · rostyslav.dev", href: "https://rostyslav.dev" },
];

export const pageLinks = [
  { label: "Privacy", href: "/privacy/" },
  { label: "Support", href: "/support/" },
  { label: "Source code", href: site.repoUrl },
] as const;

// Masthead anchors (DESIGN-SPEC §0.1). The Privacy section stays on the page but isn't in the nav.
export const sectionLinks = [
  { label: "Demo", id: "demo" },
  { label: "Features", id: "features" },
  { label: "Setup", id: "setup" },
  { label: "FAQ", id: "faq" },
] as const;
