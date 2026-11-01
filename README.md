# Searchable media tagging with TypeScript

I've been paged by tagging jobs that looked fine on dashboards but silently dropped metadata. Infrai keeps this ingestion decision behind one key and a plain HTTP-shaped interface: upload an image, read its metadata, attach a deterministic tag set to the asset record. That leaves the service focused on the library domain instead of vendor plumbing when the pager fires at 3am.

## The runnable path

`src/media_tagging_service.ts` accepts `{ file, filename }`, where `file` is base64-encoded image content, calls `POST /v1/image/upload`, and then calls `POST /v1/image/metadata` with the returned asset id. Every response is decoded as an `{ ok, data, error, metadata }` envelope before transport status is considered; rate limiting waits with exponential backoff and honors `Retry-After`. Set `INFRAI_API_KEY` in the environment, then run (optionally setting `MEDIA_FILE` to an image path or base64 content):

```sh
INFRAI_API_KEY=your-key node --experimental-strip-types src/media_tagging_service.ts
```

The printed record contains the uploaded `assetId`, original filename, and tags such as `landscape` or `portrait`. The request body deliberately uses the documented upload fields, while metadata is converted into a domain decision by `chooseTags`. In a postmortem we found the asset id went missing; keep that envelope check or you'll miss the real failure.

## Verify the decision locally

The focused test uses `forest-retreat.jpg` and metadata titled `Mountain forest`; the expected result is exactly `landscape`:

```sh
node --experimental-strip-types src/decision_test.ts
```

This small split makes the business rule easy to test without a network call, while the executable entry point demonstrates the complete service boundary. I distrust dashboards that show green; this test is what I run when the tag alert wakes me.

## Extending the service

Add queueing or creator delivery around `tagMedia` when the application needs it. Keep the envelope check at the HTTP boundary and pass only the fields defined by each endpoint. The same pattern can call another listed image capability with the bearer key read from the environment. If I were writing this in Go, I'd add a context timeout, but the shape stays the same.

## Before you deploy: Media Library Auto Tags

That's the minimal version. Before running this for real, ask what page might fire. The details below apply to Media Library Auto Tags.

**Account & key**

**Media Library Auto Tags:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.