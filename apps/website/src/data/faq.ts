// Questions and troubleshooting copy. Answers are trusted, static HTML.
// Copy must match real extension behaviour (v1.0.7); see DESIGN-SPEC §2 before editing.

export interface QA {
  question: string;
  answer: string;
}

/** Home page FAQ, verbatim from the approved prototype. */
export const homeFaq: QA[] = [
  {
    question: "Why is the Run button greyed out?",
    answer:
      "<p>Run unlocks once Outliers reads the profile's follower count, in both modes. Open <code>instagram.com/username/reels/</code> and let the page finish loading. Then close and reopen the side panel. If it still won't unlock, refresh the Instagram tab.</p>",
  },
  {
    question: "It says no Reels qualified, but I can see Reels.",
    answer:
      "<p>Usually that means nothing in the scan cleared the bar, and the panel tells you which bar it used. Try Min Views or a deeper scan. If the tiles don't show view counts, Outliers can't read them. Make sure you're on the Reels tab rather than Posts, refresh, and run again.</p>",
  },
  {
    question: "Can I change the filter after a scan?",
    answer: "<p>Yes. New settings apply to your next scan. Press Reset (it reloads the tab), then Run.</p>",
  },
  {
    question: "I set a small scan limit, but it scanned more.",
    answer:
      "<p>The scan limit tells Outliers how far to scroll. Instagram loads Reels in batches, so a very small limit can collect a few extra. The results header always shows how many Reels were actually scanned.</p>",
  },
  {
    question: "Does it sort by likes or comments?",
    answer: "<p>Not yet. Results are ranked by views. Sorting by likes has been requested and is on the roadmap.</p>",
  },
  {
    question: "Where do saved Reels go?",
    answer:
      "<p>Into your Library, kept in Chrome's local extension storage on this device. There's no cross-device sync. Export the Library as a CSV any time.</p>",
  },
  {
    question: "Is it really free? Which browsers?",
    answer:
      "<p>It's free, with no account. It's built for desktop Google Chrome and uses Chrome's side panel. If Instagram asks you to log in before showing Reels and view counts, log in first.</p>",
  },
];

/** /support diagnostics: fuller versions of the common problems, with steps. */
export const diagnostics: QA[] = [
  {
    question: "The Run button is greyed out",
    answer: `<p>Run unlocks only after Outliers reads the profile's follower count. That applies in both modes, including Min Views.</p>
<ol>
  <li>Open the profile's Reels tab: <code>instagram.com/username/reels/</code>.</li>
  <li>Wait for the page to finish loading, including the follower count in the profile header.</li>
  <li>Close and reopen the Outliers side panel.</li>
  <li>Still grey? Refresh the Instagram tab, then open the panel again.</li>
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
  {
    question: "I changed the filter after a scan, and the results didn't change",
    answer:
      "<p>Results belong to the scan that produced them. Filter and scan-limit changes apply to your next scan. Press Reset (it reloads the tab), then Run.</p>",
  },
  {
    question: "It scanned more Reels than my scan limit",
    answer:
      "<p>The scan limit tells Outliers how far to scroll. Instagram loads Reels in batches, so a very small limit can collect a few more than you set. The results header always shows how many Reels were actually scanned.</p>",
  },
  {
    question: "Can it sort by likes or comments?",
    answer: "<p>Not yet. Results are ranked by views. Sorting by likes has been requested and is on the roadmap.</p>",
  },
];

/** /support: the remaining home FAQ entries that aren't troubleshooting. */
export const otherQuestions: QA[] = [
  homeFaq[5]!,
  {
    question: "How do I remove saved Reels?",
    answer:
      "<p>Open the Library and press <b>Clear</b>. It removes saved Reels only; your scan limit and filter settings stay. Removing Outliers from Chrome deletes everything it stored.</p>",
  },
  homeFaq[6]!,
];

export const knownLimits: string[] = [
  "Built for desktop Google Chrome. It uses Chrome's side panel.",
  "Reads the counts Instagram shows you, so log in if Instagram asks.",
  "Ranks by views only. Likes sorting isn't available yet.",
  "The Library stays on one device. There's no sync.",
  "The results CSV covers the current scan. The Library has its own CSV export.",
];
