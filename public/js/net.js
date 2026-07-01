// Thin WebSocket wrapper.
export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}`);
      this.ws.onopen = () => resolve();
      this.ws.onerror = e => reject(e);
      this.ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
      this.ws.onclose = () => {
        const h = this.handlers._close;
        if (h) h();
      };
    });
  }
  on(t, fn) { this.handlers[t] = fn; }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}
