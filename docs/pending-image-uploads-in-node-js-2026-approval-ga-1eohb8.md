# Pending Image Uploads in Node.js 2026: Approval Gates Explained

Keep every new image private under an opaque storage key, record it as `pending`, and make approval the only transaction that can attach that key to the searchable media library. The deciding constraint is not upload throughput. It is whether an unreviewed product image can become reachable through a CDN URL, search index, derivative job, or stale cache before a reviewer acts.

TL;DR: treat publication as a state transition, not as moving a file between two folders. A Node.js API can issue a short-lived upload authorization and coordinate that transition, while the durable record remains the source of truth. Put `pending`, `approved`, and `rejected` in an explicit state machine; bind approval to the expected record version; publish only after validation; and make retries idempotent. For an e-commerce media library, this also avoids paying to generate and cache thumbnails that may never be approved.

The page I care about is `published_asset_without_approval_total > 0`. A chart showing a healthy moderation queue while a pending image is publicly cacheable is reassurance from the wrong subsystem.

## How should an API hold image uploads in a pending state?

The obvious design has `pending/` and `public/` prefixes, then copies an object after approval. That looks legible in a storage browser, but the folder name is merely part of a key in many object stores; it is not an authorization boundary by itself. Public access policy, signed URL scope, application routes, CDN origin rules, and indexers decide reachability. If any of those treats the pending prefix as public, moderation has already failed.

There is a second trap. Suppose a seller uploads `front.jpg`, a reviewer approves database row 81 at version 3, and the seller replaces the bytes while the decision is in flight. An approval that names only row 81 can publish content the reviewer never saw. The decision must therefore bind to an immutable object identity and integrity value, such as a server-recorded digest, plus a version used for compare-and-set.

Keep the original private and immutable. Use a random storage key rather than a user filename, store the declared media type separately, and verify the decoded file type and dimensions in a worker before marking it reviewable. File extensions and browser-supplied `Content-Type` values are hints, not proof; MDN's image format guide is useful for deciding which formats the application accepts, but the server still has to validate the uploaded bytes.

This failure mode is quiet. Search can be correct, the review UI can be correct, and a guessed or logged origin URL can still expose the object. That is why I distrust a dashboard labeled "moderation success rate." What page fired when a pending key was served?

Nothing public yet.

## The publish gate is a small state machine

Use one durable media record per upload. A practical record carries `id`, `tenant_id`, `object_key`, `sha256`, `state`, `version`, validation results, reviewer identity, and timestamps. The permitted transitions are narrow:

| From | Command | To | Side effect |
|---|---|---|---|
| `pending` | validation passes | `reviewable` | enqueue human review |
| `pending` | validation fails | `rejected` | schedule private-object deletion |
| `reviewable` | approve expected version | `approved` | emit a transactional outbox event |
| `reviewable` | reject expected version | `rejected` | schedule private-object deletion |
| `approved` | withdraw | `withdrawn` | remove discovery records and purge delivery caches |

Do not let the upload-complete handler publish. It should only confirm that the expected private object exists, capture server-observed metadata, and queue validation. Approval updates the row and inserts a `media.approved` outbox record in the same database transaction. A relay can then create derivatives, update the search document, and expose a delivery identifier. This transaction-plus-outbox pattern closes the awkward gap where the database commits but the process dies before sending a message.

Delivery deserves a separate name from storage. A public media ID can resolve only records in `approved`, while the underlying object key never appears in storefront HTML or search results. If a derivative job retries, derive its idempotency key from the media ID, approved version, transformation name, and encoder version. Repeating the same work then replaces the same logical result instead of creating a growing set of cache entries.

Walk through the ugly race before choosing an API shape. At 12:00:00, upload A creates media row 81 at version 1 and receives an authorization for private key `tenant-7/01J.../original`; after byte validation, the worker advances the row to `reviewable`, version 2, and the review screen renders the exact digest it received. A reviewer opens that screen. Meanwhile, a replacement request creates upload B as a new record rather than overwriting A, because allowing the client to mutate A's storage key would destroy the review boundary. If the product requires one stable "front image" slot, that slot points to neither candidate yet. Approval of A submits media ID 81 and expected version 2, the transaction changes it to version 3, and the outbox relay eventually materializes its public version. If the reviewer double-clicks, the second compare-and-set returns HTTP 409; if the response to the first click was lost, the client reloads row 81 and sees the recorded decision instead of guessing whether to try a different mutation. Upload B remains pending. Only after an explicit later decision may the catalog slot point to B. This costs another row and another private object during review, but it preserves the answer to the question an incident review will ask: which bytes did the human approve?

## A minimal safe implementation

The HTTP handlers may live in Node.js, but the contract below is deliberately shown in Go: the required properties are database-level compare-and-set, idempotency, and an outbox, not a framework decorator. `Approve` receives the version displayed to the reviewer. A concurrent replacement or earlier decision makes the update affect zero rows and returns a conflict.

```go
package media

import (
	"context"
	"database/sql"
	"errors"
)

var ErrConflict = errors.New("media changed or is no longer reviewable")

type Service struct {
	DB *sql.DB
}

func (s *Service) Approve(ctx context.Context, mediaID string, expectedVersion int64, reviewerID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE media
		SET state = 'approved', reviewer_id = ?, version = version + 1,
		    approved_at = CURRENT_TIMESTAMP
		WHERE id = ? AND state = 'reviewable' AND version = ?`,
		reviewerID, mediaID, expectedVersion)
	if err != nil {
		return err
	}

	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return ErrConflict
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO outbox (event_key, event_type, aggregate_id)
		VALUES (?, 'media.approved', ?)`, mediaID+":approved", mediaID)
	if err != nil {
		return err
	}

	return tx.Commit()
}
```

The unique constraint on `outbox.event_key` is part of this contract. So is authorization: the handler must establish that the reviewer may act for the record's tenant, and that check should occur inside the transaction or be encoded in the update predicate. A client-provided reviewer ID is not authentication.

Reject ambiguity.

For upload authorization, scope the credential to one opaque key, one method, a bounded size, and a short expiration supported by the chosen storage system. Do not accept a destination key from the browser. The application creates the pending row first, chooses the key, and returns only the narrowly scoped upload authorization. The completion call must be safe to retry and must never change `reviewable` or `approved` back to `pending`.

## Storage and cache cost follow the state boundary

Moderation often starts as a policy project and becomes a storage bill. The useful rule is straightforward: retain one private original while review is pending; generate only the inspection rendition needed by reviewers; delay storefront sizes, format variants, search indexing, and long-lived CDN caching until approval. Rejected originals should follow a documented retention policy and a lifecycle deletion path.

The bytes are cheap only until they multiply.

There is a trade-off. Precomputing every derivative before review shortens time from approval to storefront visibility, but spends compute and storage on rejected images and expands the set of objects that access policy must protect. Generating after approval reduces speculative work, though publication now includes processing latency. For a large e-commerce catalog, measure the approval-to-visible service-level objective against the rejection rate and derivative fan-out; do not choose based on a generic claim that one path is faster.

Cache keys must include the approved content version. Reusing `/media/sku-42/front` for different bytes asks every intermediary to agree on invalidation timing, which is a brittle rollback plan. An immutable URL such as a public media ID plus version lets old HTML age out naturally, while an emergency withdrawal can deny resolution and purge the known delivery keys. Set cache behavior deliberately according to HTTP caching semantics; a private review response must not inherit the storefront's public cache policy.

## Verification, paging, and rollback

Test the invariant across components, not just in the approval handler. Before release, upload a valid image and an invalid file with an image extension; confirm that neither private key is reachable anonymously. Race replacement against approval. Replay completion and approval requests. Kill the outbox relay after it claims an event, restart it, and verify that the same derivative keys and search document are produced without duplicates.

Then exercise withdrawal after the image has been cached. The expected result is removal from search and catalog references, denial at the delivery resolver, and purge requests for known cache keys. An object deletion alone is insufficient because copies may exist in derivatives and caches.

Page on invariant violations and sustained inability to drain work, not on every failed thumbnail. Useful signals include the count of non-approved records returned by the public resolver, oldest unprocessed outbox age, oldest reviewable item age, validation failure rate by reason, and withdrawal purge failures. Queue depth is context; age is usually closer to customer impact. One event retry at 03:00 should not wake anyone.

Rollback is a feature flag that stops publication consumers while preserving the approval ledger, followed by a controlled drain after the defect is fixed. Do not roll back by changing approved rows to pending en masse: that erases the distinction between a review decision and its downstream materialization. If bad content escaped, withdraw the affected approved versions, remove discovery references, purge caches, and keep an audit trail of who initiated each transition.

The postmortem question is simple: which invariant broke? "The queue was busy" is not a cause. The useful answer identifies whether authorization exposed a private key, approval targeted stale bytes, the outbox lost an event, a consumer ignored state, or a cache continued serving a withdrawn version.

## References

- MDN, Image file type and format guide: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types
- RFC 9111, HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111
- OWASP, File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- AWS Prescriptive Guidance, Transactional outbox pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
