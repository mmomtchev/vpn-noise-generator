# The iPerf3 protocol

iPerf3 uses a simple protocol that can be used over TCP, UDP or SCTP. The protocol is implemented by a number of public accessible servers.

## The control connection

The exchange starts with a 37-bytes random cookie using only the characters found in `'abcdefghijklmnopqrstuvwxyz234567'` sent by the client.

The server answers with one-byte messages that drive the state machine.

These messages are:

```js
const TEST_START = 1;
const TEST_RUNNING = 2;
const RESULT_REQUEST = 3; /* not used */
const TEST_END = 4;
const STREAM_BEGIN = 5; /* not used */
const STREAM_RUNNING = 6; /* not used */
const STREAM_END = 7; /* not used */
const ALL_STREAMS_END = 8; /* not used */
const PARAM_EXCHANGE = 9;
const CREATE_STREAMS = 10;
const SERVER_TERMINATE = 11;
const CLIENT_TERMINATE = 12;
const EXCHANGE_RESULTS = 13;
const DISPLAY_RESULTS = 14;
const IPERF_START = 15;
const IPERF_DONE = 16;
const ACCESS_DENIED = -1;
const SERVER_ERROR = -2;
```

### The parameter exchange

The most important of these messages is the `PARAM_EXCHANGE` - the server asks the client to send its configuration (basically its CLI options).

The client must send its configuration starting with its length, sent as a 32-bit number in network byte order followed by an ASCII JSON-encoded configuration object.

| bytes 0-3 | bytes 4... |
|---|---|
| network-order 32 bit msg length | JSON-encoded configuration |

Version 3.1, when run without any options will send:

```js
{
    tcp: true,
    omit: 0,
    parallel: 1,
    pacing_timer: 1000,
    client_version: '3.10'
}
```

`pacing_timer` is the period of the timer used for sending the streams - `iperf3` uses a rather basic mechanism and sends all of its data at the beginning of each second - counting on the OS buffering mechanism to distribute the load.

### Transition to stream mode

Once the server has received the configuration it will send `CREATE_STREAMS` and `TEST_RUNNING` - which will be two separate TCP packets with 1-byte payloads.

From this moment on, the client is free to start its data connections.

### The stream connections

The client can open one or multiple connections. Every connection must start with the cookie. The server cannot handle multiple concurrent clients - new clients connecting while a test is running will get `ACCESS_DENIED` as their first server message.

After the cookie is sent, the server will

* simply wait to receive data if `reverse: true` is absent from the configuration
* start sending data if `reverse: true` is present according to `bandwidth` in bauds, `time` in seconds and `length` in bytes parameters

Every message starts with a header:
| bytes 0-3 | bytes bytes 4-7 | bytes 8-11 (default) or 8-15 (64bit counters CLI option) |
|---|---|---|
| timestamp (s) | timestamp (µs) | packet counter

The rest of the data is not defined.

### Session end

At the end of the test, the server sends `EXCHANGE_RESULTS` over the control connection along with its data in JSON format prefixed with a 32-bit length. Both sides send their results, first the client, then the server. Both sides can then proceed to display human-readable statistics.

