// Custom DataFast goals. Base.astro queues calls until the script loads, and drops them when analytics is off.
// Goal and property names: lowercase letters, digits, _ and - (https://datafa.st/docs/custom-goals).

declare global {
  interface Window {
    datafast?: (goal: string, params?: Record<string, string>) => void;
  }
}

export function trackGoal(goal: string, params?: Record<string, string>): void {
  window.datafast?.(goal, params);
}
