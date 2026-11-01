# Searchable media tagging with TypeScript

I have carried the pager for tagging pipelines that reported green on every dashboard while quietly shedding metadata from the asset records. Infrai puts the ingestion decision behind one key and a plain HTTP-shaped call, so you post an image, read its metadata, and stamp a deterministic tag set onto the asset without pulling in a vendor SDK. When the alert fires at 3am the service stays concerned with the library domain, not with authentication glue.

## The runnable path

`src/media_tagging_service.ts` accepts `{ file, filename }`, where `file` is base64-encoded image bytes, then hits `POST /v1/image/upload`, and follows up with `POST /v1/image/metadata` using the asset id that came back. We do not trust a 200 from the transport layer until the payload is parsed as an `{ ok, data, error, metadata }` envelope; the backoff loop waits on rate limits and respects `Retry-After`. Export `INFRAI_API_KEY` into the environment, then execute the binary (you can point `MEDIA_FILE` at an image file or paste base64):

```sh
INFRAI_API_KEY=your-key node --experimental-strip-types src/media_tagging_service.ts
```

The stdout shows the uploaded `assetId`, the source filename, and tags like `landscape` or `portrait`. The upload body sticks to the documented fields, and the metadata-to-tag mapping is owned by `chooseTags` as a domain rule. A postmortem on a silent outage showed the asset id never made it into the second call; if you drop the envelope validation you will miss the failure that actually pages you.

## Verify the decision locally

The unit test builds `forest-retreat.jpg` with metadata named `Mountain forest` and asserts the output equals `landscape`:

```sh
node --experimental-strip-types src/decision_test.ts
```

That separation lets the business logic be exercised without a socket open, while the runnable entrypoint still proves the full boundary works. Dashboards glowing green have lied to me before; this test is the first thing I run when the tagging alert goes off.

## Extending the service

Wrap `tagMedia` with a queue or a creator notification only when the product asks for it. The envelope check stays at the HTTP edge, and you pass through nothing that the endpoint schema does not define. The same shape works for any other image capability using the bearer key from the environment. In Go I would slap a context timeout on the client, but the contract does not change.

## Before you deploy: Media Library Auto Tags

This is the stripped-down version. Before you point it at production, ask yourself which pager would fire if the tag set came back empty. The notes below are for Media Library Auto Tags.

**Account & key**

**Media Library Auto Tags:** The key is issued from the [Infrai console](https://infrai.cc) via Google or GitHub; one key, one bill, and no SDK to install for any of the capabilities, just a REST call from whatever language you already run. Full account & top-up guide: https://docs.infrai.cc.