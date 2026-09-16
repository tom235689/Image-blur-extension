'use strict';

/**
 * A very small Chrome DevTools Protocol client, enough to drive one page and
 * the extension's service worker. Node 22 and newer ship a global WebSocket,
 * so the test harness needs no dependencies.
 */

function connect(webSocketUrl) {
  const state = {
    id: 0,
    pending: new Map(),
    socket: new WebSocket(webSocketUrl)
  };

  state.socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const resolve = message.id && state.pending.get(message.id);
    if (resolve) {
      state.pending.delete(message.id);
      resolve(message);
    }
  };

  const session = {
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = (state.id += 1);
        state.pending.set(id, (message) => {
          if (message.error) {
            reject(new Error(method + ': ' + message.error.message));
            return;
          }
          resolve(message.result);
        });
        state.socket.send(JSON.stringify({ id, method, params: params || {} }));
      });
    },

    /** Evaluates an expression in the target and returns its value. */
    async evaluate(expression, options) {
      const result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: !!(options && options.awaitPromise)
      });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        const text = (details.exception && details.exception.description) || details.text;
        throw new Error('evaluate failed: ' + text);
      }
      return result.result.value;
    },

    close() {
      try {
        state.socket.close();
      } catch (error) {
        /* already gone */
      }
    }
  };

  return new Promise((resolve, reject) => {
    state.socket.onerror = () => reject(new Error('cannot connect to ' + webSocketUrl));
    state.socket.onopen = () => resolve(session);
  });
}

function endpoint(port, path) {
  return 'http://127.0.0.1:' + port + '/json' + path;
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

const browserTarget = (port) => fetchJson(endpoint(port, '/version'));
const targets = (port) => fetchJson(endpoint(port, '/list'));

module.exports = { connect, browserTarget, targets };
