// Videos covering every metric the extension reads, including the gaps (hidden likes, unknown counts,
// a known zero), for the parity tests.
export const videoFixtures = [
  { url: "https://www.instagram.com/sample.studio/reel/DEMO0009/", href: "/sample.studio/reel/DEMO0009/", views: 1_380_000, ratio: 1_380_000 / 18_400, platform: "instagram", likes: 41_200, comments: 880 },
  { url: "https://www.instagram.com/sample.studio/reel/DEMO0019/", href: "/sample.studio/reel/DEMO0019/", views: 312_000, ratio: 312_000 / 18_400, platform: "instagram", likes: null, comments: 1_200, likesHidden: true },
  { url: 'https://example.test/with,comma"quote', href: "", views: 92_000, ratio: 5 },
  { url: "https://www.instagram.com/sample.studio/reel/DEMO0002/", href: "/sample.studio/reel/DEMO0002/", views: 12_800, ratio: 12_800 / 18_400, platform: "instagram", likes: 410, comments: 12 },
  { url: "https://www.tiktok.com/@sample.studio/video/7000000000000000001", href: "/@sample.studio/video/7000000000000000001", views: 214_000, ratio: 0, platform: "tiktok", likes: 9_100, comments: 140, shares: 300, saves: 1_020, postedAt: 1_759_500_000, durationSec: 41 },
  { url: "https://www.tiktok.com/@sample.studio/video/7000000000000000002", href: "/@sample.studio/video/7000000000000000002", views: 0, ratio: 0, platform: "tiktok", likes: 0, comments: 0, shares: 0, saves: 0, postedAt: 1_759_000_000, durationSec: 9 },
  { url: "https://www.tiktok.com/@sample.studio/video/7000000000000000003", href: "/@sample.studio/video/7000000000000000003", views: null, ratio: 0, platform: "tiktok", likes: 12, comments: null, shares: null, saves: null, postedAt: null, durationSec: null },
  { url: "https://www.instagram.com/sample.studio/reel/DEMO0030/", href: "/sample.studio/reel/DEMO0030/", views: 92_000, ratio: 5, platform: "instagram", likes: 2_000, comments: 40 },
];
