const net = require('net');
const fs = require('fs');

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

const host = 'ping.online.net';
const port = 5203;

// TODO: implement MTU discovery
const MTU = 1464;

//const verbose = console.debug;
const verbose = () => undefined;

/** 
 * Run one full iteration of the iPerf protocol
 * 
 * @param {string} options.host
 * @param {number} options.port
 * @param {number} options.time length in seconds
 * @param {boolean} options.reverse download instead of upload
 * @param {number} options.bandwidth bandwidth in KBd (kilobauds)
 * @param {number} options.variation relative bandwidth variation [0..1]
 * @return {Promise<void>}
*/
function iPerf(options) {
    let cookie;
    const { host, port, time, reverse, bandwidth, variation } = options || {};

    console.log(`Trying ${host}:${port}, reverse: ${!!reverse}`);

    return new Promise((resolve) => {
        const control = net.connect({
            port,
            host
        });
        let stream;

        function cleanup() {
            try {
                stream.close();
            } catch (e) { }
            try {
                control.close();
            } catch (e) { }
            resolve();
        }

        const freq = bandwidth / 8 / MTU;
        const period = 1000 / freq;
        verbose({ freq, variation, period });
        function upload() {
            if (stream.writableFinished)
                return;
            let length = MTU;
            if (Math.random() > 0.9)
                length = Math.ceil(Math.random() * MTU);
            verbose('sending ', length);
            stream.write(Buffer.alloc(length));
            setTimeout(upload, period + (Math.random() - 0.5) * 2 * variation);
        }

        control.on('connect', () => {
            verbose('control connection established');
        });

        control.once('ready', () => {
            const cookieChars = 'abcdefghijklmnopqrstuvwxyz234567';
            cookie = new Uint8Array(37);
            cookie.map((_, i) => cookie[i] = cookieChars[Math.floor(Math.random() * cookieChars.length)].charCodeAt(0));
            verbose('sending cookie', cookie.reduce((s, x) => s + String.fromCharCode(x), ''));
            control.write(cookie);
        });

        control.on('close', cleanup);
        control.on('error', cleanup);

        control.on('data', (data) => {
            for (let i = 0; i < data.length; i++) {
                if (data[i] != 0) verbose('processing incoming message', data[i]);
                switch (data[i]) {
                    case PARAM_EXCHANGE:
                        verbose('sending parameters');
                        const params = {
                            tcp: true,
                            omit: 0,
                            time,
                            parallel: 1,
                            bandwidth,
                            pacing_timer: 1000,
                            client_version: 'vpn-noise-generator 1.0'
                        };
                        if (reverse) params.reverse = true;
                        const length = new Uint8Array(4);
                        length[3] = JSON.stringify(params).length;
                        control.write(length);
                        control.write(JSON.stringify(params));
                        break;
                    case CREATE_STREAMS:
                        verbose('create stream');
                        stream = net.connect({
                            port,
                            host
                        });
                        stream.on('connect', () => verbose('stream: connected'));
                        stream.on('data', (data) => verbose('stream: received ', data.length, data));
                        stream.on('close', cleanup);
                        stream.on('error', cleanup);
                        stream.once('ready', () => {
                            verbose('stream: sending cookie');
                            stream.write(cookie);
                            if (!reverse)
                                setImmediate(upload);
                        });
                        break;
                    case TEST_START:
                        break;
                    case TEST_RUNNING:
                        verbose('we have green light');
                        break;
                    case EXCHANGE_RESULTS:
                    case DISPLAY_RESULTS:
                    case IPERF_DONE:
                    case SERVER_TERMINATE:
                        verbose('server close');
                        cleanup();
                        break;
                }
            }
        })
    });
}

const config = JSON.parse(fs.readFileSync('vpn-noise.json'));
for (const stream of config.streams) {
    (async () => {
        console.log(`Launching stream, ${stream.rate} KBit/s with ${stream.variation} variability, reverse: ${stream.reverse}`);
        let server = 0;
        while (true) {
            server %= config.servers.length;
            await iPerf({
                host: config.servers[server].host,
                port: config.servers[server].port,
                reverse: stream.reverse,
                bandwidth: stream.rate,
                stddev: stream.variation
            });
            server++;
            break;
        }
    })();
}
