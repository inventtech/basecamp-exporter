import type { Config } from "./config.ts";
import type { BasecampTodo } from "./types.ts";

const BASE_HOST = "https://3.basecampapi.com";

export type TodoStatus = "active" | "archived" | "trashed";

export interface FetchTodosOptions {
  /** Stop paginating once a to-do older than this is reached (by `updated_at`). */
  since?: Date;
  /** Include completed to-dos (default endpoint returns only incomplete). */
  completed?: boolean;
  /** Override the default `active` status to fetch archived/trashed records. */
  status?: TodoStatus;
  /** Restrict to specific project (bucket) IDs. Omit for the whole account. */
  buckets?: number[];
  /** Called after each page with the running total fetched so far. */
  onProgress?: (count: number) => void;
}

/**
 * Fetch to-dos across the whole account via the recordings endpoint.
 *
 * Why recordings instead of walking each project's to-do lists: a single
 * paginated query returns to-dos from every project, each carrying its
 * `bucket` (project) and `parent` (to-do list), so grouping happens client-side.
 *
 * Results are sorted by `updated_at` descending, which lets `since` short-circuit
 * pagination as soon as we cross the cutoff instead of downloading everything.
 */
export async function fetchTodos(
  config: Config,
  opts: FetchTodosOptions = {},
): Promise<BasecampTodo[]> {
  const params = new URLSearchParams({
    type: "Todo",
    sort: "updated_at",
    direction: "desc",
  });
  if (opts.completed) params.set("completed", "true");
  if (opts.status && opts.status !== "active") params.set("status", opts.status);
  if (opts.buckets?.length) params.set("bucket", opts.buckets.join(","));

  let url: string | null = `${BASE_HOST}/${config.accountId}/projects/recordings.json?${params}`;
  const todos: BasecampTodo[] = [];

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        "User-Agent": config.userAgent,
        Accept: "application/json",
      },
    });

    // Basecamp rate-limits to 50 requests / 10s and returns Retry-After.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "10");
      await Bun.sleep(Math.max(1, retryAfter) * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Basecamp API ${res.status} ${res.statusText}: ${body}`);
    }

    const batch = (await res.json()) as BasecampTodo[];
    for (const todo of batch) {
      if (opts.since && new Date(todo.updated_at) < opts.since) {
        return todos; // sorted desc, so every remaining record is older
      }
      todos.push(todo);
    }
    opts.onProgress?.(todos.length);

    url = nextLink(res.headers.get("Link"));
  }

  return todos;
}

/** Parse the `rel="next"` URL out of an RFC 5988 `Link` header. */
export function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1]! : null;
}
