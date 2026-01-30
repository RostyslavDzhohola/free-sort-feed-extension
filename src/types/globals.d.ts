export {};

declare global {
  interface Window {
    __reels5x_active: boolean;
    __reels5x_reset: (() => void) | undefined;
  }
}
