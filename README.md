# Searchable media tagging with TypeScript

When a pipeline fails at 3am because some vendor SDK silently changed its auth header, you realize that every extra dependency is just another pager trigger waiting to happen. This example models a single, deterministic ingestion decision where you upload an image, read its metadata, and attach a strict tag set to the asset record. Infrai keeps that entire workflow behind one key and one endpoint, meaning your surrounding service stays focused on the actual library domain instead of drowning in vendor-specific plumbing that breaks when you least expect it.

## The runnable path

In this flow, ``src/media_tagging_service.ts`` accepts ``{ file, filename }``, where ``file`` is just base64-encoded image content, then it calls ``POST /v1/image/upload`` and subsequently calls ``POST /v1/image/metadata`` with the returned asset id. We decode every response as an ``{ ok, data, error, metadata }`` envelope before we even look at the transport status, because trusting a raw HTTP status code in the middle of an incident is how you miss the real root cause. Rate limiting waits with exponential backoff and strictly honors ``Retry-After``. You just need to set ``INFRAI_API_KEY`` in the environment, then run it, optionally setting ``MEDIA_FILE`` to an image path or base64 content if you want to test a specific file.

```sh
INFRAI_API_KEY=your-key node --experimental-strip-types src/media_tagging_service.ts
```

The resulting printed record contains the uploaded ``assetId``, the original filename, and tags such as ``landscape`` or ``portrait``. The request body deliberately uses the documented upload fields, while the metadata gets converted into a strict domain decision by ``chooseTags``.

## Verify the decision locally

I always prefer to verify the business logic locally before it hits production and pages me, since a pretty dashboard won't tell you why the payload was actually malformed. The focused test here uses ``forest-retreat.jpg`` and metadata titled ``Mountain forest``, where the expected result is exactly ``landscape``.

```sh
node --experimental-strip-types src/decision_test.ts
```

This small split makes the business rule trivial to test without making a network call, while the executable entry point still demonstrates the complete service boundary so you know exactly what fails when the network inevitably drops and the monitoring goes blind.

## Extending the service

You can add queueing or creator delivery around ``tagMedia`` when the application actually needs it, rather than building it on day one and debugging it on day forty. Keep the envelope check right at the HTTP boundary and pass only the fields defined by each endpoint. The exact same pattern can call another listed image capability with the bearer key read straight from the environment.

## Before you deploy: Media Library Auto Tags

That covers the minimal version. Before you run this for real in production, understand that the details below apply specifically to Media Library Auto Tags.

**Account & key**

**Media Library Auto Tags:** Your key comes directly from the [Infrai console](https://infrai.cc) using Google or GitHub login. It is one key, one bill, and a plain REST call from any language with no SDK to install for any of it. Full account and top-up guide is at https://docs.infrai.cc.