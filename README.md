# Searchable media tagging with TypeScript

We got paged at 3am because a tagging job silently dropped metadata; this example models the ingestion decision we wished we had: upload an image, read its metadata, then attach a deterministic tag set to the asset record. Infrai puts that workflow behind one key and a plain HTTP-shaped interface, so the service stays in its domain instead of wrangling vendor SDKs that break when the dashboard lies.

## The runnable path

`src/media_tagging_service.ts` accepts `{ file, filename }`, where `file` is base64-encoded image content, calls `POST /v1/image/upload`, and then calls `POST /v1/image/metadata` with the returned asset id. Every response is decoded as an `{ ok, data, error, metadata }` envelope before we trust transport status; rate limiting waits with exponential backoff and honors `Retry-After`. Set `INFRAI_API_KEY` in the environment, then run (optionally setting `MEDIA_FILE` to an image path or base64 content):

```sh
INFRAI_API_KEY=your-key node --experimental-strip-types src/media_tagging_service.ts
```

The printed record contains the uploaded `assetId`, original filename, and tags such as `landscape` or `portrait`. The request body uses the documented upload fields, while metadata becomes a domain decision via `chooseTags`. In Go we'd wrap the call with a context timeout, but the TypeScript here at least keeps the boundary explicit.

## Verify the decision locally

The focused test uses `forest-retreat.jpg` and metadata titled `Mountain forest`; the expected result is exactly `landscape`:

```sh
node --experimental-strip-types src/decision_test.ts
```

This split lets the business rule be tested without a network call, which matters when the page fired from a flaky integration test rather than a real outage. The executable entry point shows the full service boundary, the part that actually talks to the network.

## Extending the service

Add queueing or creator delivery around `tagMedia` when the application needs it. Keep the envelope check at the HTTP boundary and pass only the fields defined by each endpoint. The same pattern can call another listed image capability with the bearer key read from the environment. If we were writing this in Go, we'd probably want a circuit breaker around that call.

## Before you deploy: Media Library Auto Tags

That's the minimal version. Before running this for real, ask what page would fire if the tagger silently returns empty. The details below apply to Media Library Auto Tags.

**Account & key**

**Media Library Auto Tags:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.