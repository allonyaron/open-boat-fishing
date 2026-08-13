import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

export function getPostHogServer(): PostHog {
  if (!_client) {
    _client = new PostHog(process.env.POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return _client;
}
