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

- `stream` (int, omitempty): stream frame type
- `data` (json.RawMessage, omitempty): stream data payload

Constants (see `go/wire/jsonrpc2/codec.go`):

- `StreamDisable = 0`: not a stream frame (normal request/response)
- `StreamOpen = 1`: a stream data frame
- `StreamClose = -1`: end-of-stream (EOF)

### 2.2 Wire semantics

If `stream != StreamDisable`, the message is treated as a **stream frame** (not a request/response):

- `id`: identifies which stream this frame belongs to (shares the same `id` namespace with request/response)
- `stream = StreamOpen`: data frame
  - `data`: the frame content (`json.RawMessage`)
- `stream = StreamClose`: EOF frame
  - `data` is typically omitted

### 2.3 Critical protocol contract: globally unique `id`

If a single connection is used bi-directionally (a `Codec` acts as both client and server), then both sides **must ensure `id` is globally unique across both directions**.

Otherwise, stream multiplexing may conflict (frames can be routed to the wrong receiver).

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
3. When `wake()` is called by the implementation, the codec will try to send exactly one stream frame:
   - If a data item is received from the channel: send `{ "id": ..., "stream": 1, "data": ... }`.
   - If the channel is closed: send `{ "id": ..., "stream": -1 }` and remove the sender.

### 3.2 Sender contracts (must follow)

- `Sender(wake)` must return quickly and must not perform heavy/blocking work.
- `wake()` must **not** be called before `Sender` returns.
- Each `wake()` call means: "a frame can be sent now" (one wake → at most one frame).
- Closing the sender channel indicates EOF.

## 4. StreamReceiver (receiving side)

### 4.1 Interface

```go
type StreamReceiver interface {
    Receiver(wake func()) chan<- json.RawMessage
}
```

If the request params or response result value implements `StreamReceiver`, the codec will:

1. Call `Receiver(wake)` to obtain a write channel.
2. Register that channel in `receivers[id]`.
3. When stream frames for that `id` arrive, the codec will deliver them **only when** the receiver calls `wake()`.

### 4.2 Receiver contracts (must follow)

- `Receiver(wake)` must return quickly.
- `wake()` must **not** be called before `Receiver` returns.
- `wake()` semantics: **the receiver is ready to receive exactly one data frame now**.
  - The codec may block sending into the receiver channel until it succeeds.
- The receiver channel is **owned/closed by the codec**:
  - On `StreamClose`, the codec will `close(receiver)` and remove the receiver mapping.

## 5. Pending queue and early/late arrival

Stream frames may arrive before a receiver is registered. To handle this, all `stream != 0` frames are first appended into an in-memory pending list (`pendingstreams`).

When the receiver calls `wake()`:

- The codec searches the pending list for the first element with `payload.ID == id`.
- If found:
  - `StreamOpen`: deliver `payload.Data` to the receiver channel and remove the pending element.
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