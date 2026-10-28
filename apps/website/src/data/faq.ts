// Questions and troubleshooting copy. Answers are trusted, static HTML.
// Copy must match the store version of the extension (v1.0.8); see DESIGN-SPEC §2 before editing.
// Entries that changed in 1.1 have a second version, used only when site.release11 is on.
import { site } from "../config/site";

export interface QA {
  question: string;
  answer: string;
}

const free: QA = {
  question: "Is it really free? Which browsers?",
  answer: `<p>It's free, with no account, no trial and no paid plan, and <a href="${site.repoUrl}" target="_blank" rel="noopener noreferrer">its code is on GitHub</a>. It's built for desktop Google Chrome and uses Chrome's side panel. If ${site.release11 ? "Instagram or TikTok" : "Instagram"} asks you to log in before showing videos and their counts, log in first.</p>`,
};

const savedReels: QA = {
  question: "Where do saved Reels go?",
  answer:
    "<p>Into your Library, kept in Chrome's local extension storage on this device. There's no cross-device sync. Export the Library as a CSV any time.</p>",
};

const sortByLikes: QA = site.release11
  ? {
      question: "Does it sort by likes or comments?",
      answer:
        "<p>Yes. Sort by views, likes, comments, engagement rate or views ÷ followers, highest or lowest first. On TikTok you can also sort by shares, saves, post date and length. Choose <b>All</b> under Show to list every scanned video without the outlier filter.</p>",
    }
  : {
      question: "Does it sort by likes or comments?",
      answer: "<p>Not yet. Results are ranked by views. Sorting by likes and comments is coming soon, along with TikTok support.</p>",
    };

const runGreyedOut: QA = site.release11
  ? {
      question: "Why is the Run button greyed out?",
      answer:
        "<p>5× Outliers needs the profile's follower count, so Run waits until Outliers reads it. Min Views and All don't need it. Open a profile and the panel picks it up by itself, checking again while the page loads. If it still won't unlock, scroll to the top of the profile so the follower count is showing, or refresh the tab.</p>",
    }
  : {
      question: "Why is the Run button greyed out?",
      answer:
        "<p>Run unlocks once Outliers reads the profile's follower count, in both modes. Open a profile on Instagram and the panel picks it up by itself, checking again while the page loads. If it still won't unlock, scroll to the top of the profile so the follower count is showing, or refresh the Instagram tab.</p>",
    };

const changeAfterScan: QA = site.release11
  ? {
      question: "Can I change the filter after a scan?",
      answer:
        "<p>Yes. Show (5× Outliers, Min Views or All) and Sort apply at once to the videos you already scanned, in the panel and on the page. To scan further, raise the scan limit, press Reset, then Run.</p>",
    }
  : {
      question: "Can I change the filter after a scan?",
      answer: "<p>Yes. New settings apply to your next scan. Press Reset (it reloads the tab), then Run.</p>",
    };

const tiktok: QA[] = site.release11
  ? [
      {
        question: "Does it work on TikTok?",
        answer:
          "<p>Yes. Open a profile at <code>tiktok.com/@handle</code> and run it the same way. TikTok access is optional: the first time, press <b>Turn on TikTok</b> and Chrome asks you once.</p>",
      },
    ]
  : [];

/** Home page FAQ. */
export const homeFaq: QA[] = [
  free,
  {
    question: "Does Outliers collect my data?",
    answer:
      `<p>The extension doesn't. It has no server, no account and no analytics, so your research never leaves your browser. This website does count visits and button clicks, with cookieless DataFast analytics. The <a href="/privacy/">privacy policy</a> has the details.</p>`,
  },
  ...tiktok,
  runGreyedOut,
  {
    question: "It says no Reels qualified, but I can see Reels.",
    answer:
      "<p>Usually that means nothing in the scan cleared the bar, and the panel tells you which bar it used. Try Min Views or a deeper scan. If the tiles don't show view counts, Outliers can't read them. Make sure you're on the Reels tab rather than Posts, refresh, and run again.</p>",
  },
  changeAfterScan,
  {
    question: "I set a small scan limit, but it scanned more.",
    answer:
      "<p>The scan limit tells Outliers how far to scroll. Instagram loads Reels in batches, so a very small limit can collect a few extra. The results header always shows how many Reels were actually scanned.</p>",
  },
  sortByLikes,
  savedReels,
];

/** /support diagnostics: fuller versions of the common problems, with steps. */
export const diagnostics: QA[] = [
  {
    question: "The Run button is greyed out",
    answer: `<p>${
      site.release11
        ? "In 5× Outliers, Run unlocks only after Outliers reads the profile's follower count. Min Views and All don't need it."
        : "Run unlocks only after Outliers reads the profile's follower count. That applies in both modes, including Min Views."
    }</p>
<ol>
  <li>Open the profile's Reels tab: <code>instagram.com/username/reels/</code>. The panel follows the tab you're on and keeps checking while the page loads.</li>
  <li>If the panel says it couldn't read the follower count yet, scroll to the top of the profile so the count in the header is showing.</li>
  <li>Still grey? Refresh the Instagram tab.</li>
</ol>
<p>Outliers can only read what Instagram shows you in that tab. If Instagram asks you to log in before it shows the profile, log in first.</p>`,
  },
  {
    question: "It says no Reels qualified, but I can see Reels",
    answer: `<p>Most often the scan worked and nothing cleared the bar. The panel shows the bar it used.</p>
<ul>
  <li><b>The bar is high.</b> In 5× mode the bar grows with the account: a profile with 200,000 followers needs Reels past 1,000,000 views. Switch to Min Views or raise the scan limit, then press Reset and Run.</li>
  <li><b>The counts couldn't be read.</b> If view counts aren't visible on the tiles, Outliers can't read them. Make sure you're on the Reels tab rather than Posts, refresh, and run again.</li>
</ul>`,
  },
  site.release11
    ? {
        question: "I raised the scan limit after a scan, and nothing changed",
        answer: "<p>Show and Sort apply at once to the videos you already scanned. A new scan limit applies to your next scan: press Reset, then Run.</p>",
      }
    : {
        question: "I changed the filter after a scan, and the results didn't change",
        answer:
          "<p>Results belong to the scan that produced them. Filter and scan-limit changes apply to your next scan. Press Reset (it reloads the tab), then Run.</p>",
      },
  {
    question: "It scanned more Reels than my scan limit",
    answer:
      "<p>The scan limit tells Outliers how far to scroll. Instagram loads Reels in batches, so a very small limit can collect a few more than you set. The results header always shows how many Reels were actually scanned.</p>",
  },
  { ...sortByLikes, question: "Can it sort by likes or comments?" },
];

/** /support: the remaining home FAQ entries that aren't troubleshooting. */
export const otherQuestions: QA[] = [
  savedReels,
  {
    question: "How do I remove saved Reels?",
    answer:
      "<p>Open the Library and press <b>Clear</b>. It removes saved Reels only; your scan limit and filter settings stay. Removing Outliers from Chrome deletes everything it stored.</p>",
  },
  free,
];

export const knownLimits: string[] = [
  "Built for desktop Google Chrome. It uses Chrome's side panel.",
  site.release11
    ? "Reads the counts Instagram and TikTok show you, so log in if either asks."
    : "Reads the counts Instagram shows you, so log in if Instagram asks.",
  ...(site.release11 ? [] : ["Ranks by views only. Sorting by likes and comments isn't available yet."]),
  "The Library stays on one device. There's no sync.",
  "The results CSV covers the current scan. The Library has its own CSV export.",
];
