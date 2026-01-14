# jsonrpc2 Codec & Streaming

This document describes the wire format and behavior of `go/wire/jsonrpc2`'s `Codec`, including a **Streaming extension** built on top of JSON-RPC 2.0.

> Note: The streaming mechanism described here is **not** part of the JSON-RPC 2.0 specification. It is an internal extension used to multiplex stream frames on the same connection using the JSON-RPC `id`.

## 1. Base JSON-RPC 2.0 messages

Each message is encoded as a single JSON value terminated by a newline (via `json.Encoder.Encode` / `json.Decoder.Decode`).

Common fields:

- `jsonrpc`: always `"2.0"`
- `id`: request/response correlation ID (string)
- `method`: request method name (request)
- `params`: request params (request)
- `result`: response result (response)
- `error`: response error payload (response)

If `method` is non-empty, the message is treated as a request; otherwise it is treated as a response.

## 2. Streaming extension: `stream` / `data`

### 2.1 Fields

`Payload` adds two extra fields:

- `stream` (int, omitempty): stream state / frame type
- `data` (json.RawMessage, omitempty): stream data payload

Constants (see `go/wire/jsonrpc2/codec.go`):

- `StreamDisable = 0`: normal request/response, no stream expected
- `StreamOpen = 1`: stream is enabled for this `id` (declared on the **base** request/response)
- `StreamSync = 2`: stream data frame
- `StreamClose = 3`: end-of-stream (EOF) frame

### 2.2 Wire semantics

The `stream` field is used in two different ways:

1) **Stream-enabled base message** (`stream == StreamOpen`)

- This is still a normal JSON-RPC request/response (it may contain `method`/`params` or `result`/`error`).
- It declares that this `id` may have subsequent stream frames multiplexed on the same connection.
- It allows early-arriving stream frames to be buffered for later delivery.

2) **Stream frame** (`stream > StreamOpen`)

If `stream > StreamOpen`, the message is treated as a stream frame (not a request/response):

- `id`: identifies which stream this frame belongs to (shares the same `id` namespace with request/response)
- `stream = StreamSync`: data frame
  - `data`: the frame content (`json.RawMessage`)
- `stream = StreamClose`: EOF frame
  - `data` is typically omitted

### 2.3 Critical protocol contract: globally unique `id`

If a single connection is used bi-directionally (a `Codec` acts as both client and server), then both sides **must ensure `id` is globally unique across both directions**.

Otherwise, stream multiplexing may conflict (frames can be routed to the wrong receiver).

### 2.4 Timeout / cleanup (`WaitStreamTimeout`)

To mitigate unbounded in-memory buffering when a peer misbehaves (e.g. declares `StreamOpen` and then sends stream frames but the receiver is never registered / never wakes), the codec can be configured with a stream timeout:

```go
codec := NewCodec(rwc, WaitStreamTimeout(30*time.Second))
```

If unset, it defaults to **30 seconds**.

Once the timeout triggers, the codec removes the receiver mapping for that `id` and triggers a cleanup attempt for pending stream frames for the same `id`.

> Design note: This is a best-effort safety net. It does not provide a hard memory cap under sustained high-rate streaming.

## 3. StreamSender (sending side)

### 3.1 Interface

```go
type StreamSender interface {
    Sender(wake func()) <-chan json.RawMessage
}
```

If the request params or response result value implements `StreamSender`, the codec will:

1. Call `Sender(wake)` to obtain a read-only channel.
2. Register that channel in `senders[id]`.
3. Mark the **base** request/response as stream-enabled by setting `stream = StreamOpen`.
4. When `wake()` is called by the implementation, the codec will try to send exactly one stream frame:
   - If a data item is received from the channel: send `{ "id": ..., "stream": 2, "data": ... }`.
   - If the channel is closed: send `{ "id": ..., "stream": 3 }` and remove the sender.

### 3.2 Sender contracts (must follow)

- `Sender(wake)` must return quickly and must not perform heavy/blocking work.
- `wake()` must **not** be called before `Sender` returns.
- Each `wake()` call means: "a frame can be sent now" (one wake → at most one frame).
- Closing the sender channel indicates EOF.

## 4. StreamReceiver (receiving side)

### 4.1 Interface

```go
type StreamReceiver interface {
    Receiver(wake func(), close func()) chan<- json.RawMessage
}
```

If the request params or response result value implements `StreamReceiver`, the codec will:

1. Only if the corresponding base request/response has `stream = StreamOpen`, call `Receiver(wake, close)` to obtain a write channel.
2. Register that channel in `receivers[id]`.
3. When stream frames for that `id` arrive, the codec will deliver them **only when** the receiver calls `wake()`.
4. If the receiver wants to **proactively close** the stream (e.g. cancel early), it can call `close()`.

### 4.2 Receiver contracts (must follow)

- `Receiver(wake, close)` must return quickly.
- `wake()` and `close()` must **not** be called before `Receiver` returns.
- `wake()` semantics: **the receiver is ready to receive exactly one data frame now**.
  - The codec may block sending into the receiver channel until it succeeds.
- `close()` semantics: **the receiver wants to close the stream proactively**.
  - The codec will close the receiver channel and clean up resources for this `id`.
  - This is idempotent: calling `close()` multiple times is safe.
- The receiver channel is **owned/closed by the codec**:
  - On `StreamClose` from peer, the codec will `close(receiver)` and remove the receiver mapping.
  - On `close()` from receiver, the codec will also `close(receiver)` and remove the mapping.

## 5. Pending queue and early/late arrival

Stream frames may arrive before a receiver is registered. To handle this, stream frames (`stream > StreamOpen`) are appended into an in-memory pending list (`pendingstreams`) **only for ids that have been opened** (i.e. a `StreamOpen` base message has established a receiver entry for that `id`).

When the receiver calls `wake()`:

- The codec searches the pending list for the first element with `payload.ID == id`.
- If found:
  - `StreamSync`: deliver `payload.Data` to the receiver channel and remove the pending element.
  - `StreamClose`: close the receiver channel, remove the receiver mapping, and remove the pending element.
- If not found (wake happens before frames arrive): the codec schedules a `requeue` for that `id` and tries again later.

> Design choices: `pendingstreams` is currently unbounded, and the requeue mechanism is intentionally polling-based. These are accepted trade-offs for now.

## 6. Close semantics

`Codec.Close()` performs graceful shutdown based on normal request/response pending state only. It **does not** wait for pending stream delivery.

If you need to wait for stream completion, do it at a higher (application) level.

## 7. Edge cases

- If the peer sends a JSON `null` message, `Decode(&payload)` yields `payload == nil`. The current implementation ignores it (to avoid panic), but this should generally be treated as a protocol violation by the peer.

---

To integrate streaming:

- Implement `StreamSender` on request params or response results to **send** stream frames.
- Implement `StreamReceiver` on request params or response results to **receive** stream frames.

And follow the contracts above strictly.
