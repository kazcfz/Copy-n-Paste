// Installs a temporary add-on through Firefox's Remote Debugging Protocol (what `web-ext run` does).
// Packets are `<byte length>:<json>`.
const net = require('net');
const path = require('path');

function installOnce(port, addonPath) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let buffer = Buffer.alloc(0);
        let step = 'greeting';
        const send = packet => {
            const json = JSON.stringify(packet);
            socket.write(`${Buffer.byteLength(json)}:${json}`);
        };
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            for (; ;) {
                const colon = buffer.indexOf(':');
                if (colon < 0)
                    return;
                const length = Number(buffer.subarray(0, colon).toString());
                if (buffer.length < colon + 1 + length)
                    return;
                const packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
                buffer = buffer.subarray(colon + 1 + length);

                if (step === 'greeting') {
                    step = 'root';
                    send({ to: 'root', type: 'getRoot' });
                } else if (step === 'root' && packet.addonsActor) {
                    step = 'install';
                    send({ to: packet.addonsActor, type: 'installTemporaryAddon', addonPath: path.resolve(addonPath) });
                } else if (step === 'install' && (packet.addon || packet.error)) {
                    socket.end();
                    if (packet.error)
                        reject(new Error(`${packet.error}: ${packet.message}`));
                    else
                        resolve(packet.addon);
                }
            }
        });
        socket.on('error', reject);
    });
}

// The debugger server starts shortly after the browser, so retry refused connections
async function installTemporaryAddon(port, addonPath) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await installOnce(port, addonPath);
        } catch (error) {
            if (error.code !== 'ECONNREFUSED' || attempt > 50)
                throw error;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
}

module.exports = { installTemporaryAddon };
