'use strict';
// NEXUS: минимальный FTP-клиент без внешних зависимостей (sys-ftpd на Nintendo Switch).
const net = require('net'), fs = require('fs'), path = require('path');

class Ftp {
  constructor(o = {}) {
    this.host = String(o.host || '').trim(); this.port = +o.port || 21;
    this.user = String(o.user || 'anonymous'); this.pass = String(o.pass || '');
    this.timeout = +o.timeout || 15000; this.sock = null; this.buf = '';
  }
  _take() {
    const m = this.buf.match(/^(\d{3})([ -])([^\r\n]*)(?:\r\n)?/);
    if (!m) return null;
    const code = +m[1];
    if (m[2] === '-') {
      const rest = this.buf.slice(m[0].length);
      const end = rest.match(new RegExp('^' + code + ' [^\\r\\n]*(?:\\r\\n)?', 'm'));
      if (!end) return null;
      const text = rest.slice(0, end.index + end[0].length);
      this.buf = rest.slice(end.index + end[0].length);
      return {code, text: text.replace(/\r\n/g, '\n').trim()};
    }
    const text = m[3];
    this.buf = this.buf.slice(m[0].length);
    return {code, text};
  }
  _read(timeout = this.timeout) {
    return new Promise((ok, no) => {
      const s = this.sock; if (!s) return no(new Error('FTP: нет соединения'));
      const cleanup = () => { clearTimeout(t); s.removeListener('data', onData); s.removeListener('error', onErr); s.removeListener('close', onClose); };
      const check = () => { const r = this._take(); if (r) { cleanup(); ok(r); } };
      const onData = d => { this.buf += d; check(); };
      const onErr = e => { cleanup(); no(e); };
      const onClose = () => { cleanup(); no(new Error('FTP: соединение закрыто')); };
      const t = setTimeout(() => { cleanup(); no(new Error('FTP: таймаут ответа')); }, timeout);
      s.setEncoding('utf8'); s.on('data', onData); s.once('error', onErr); s.once('close', onClose); check();
    });
  }
  connect() {
    return new Promise((ok, no) => {
      const s = net.connect({host: this.host, port: this.port});
      this.sock = s; s.setTimeout(this.timeout);
      const to = () => fail(new Error('FTP: таймаут подключения'));
      const fail = e => { try { s.destroy(); } catch {} no(e); };
      s.once('error', fail);
      s.once('timeout', to);
      s.once('connect', async () => {
        s.removeListener('error', fail); s.removeListener('timeout', to);
        s.setTimeout(0);
        try { const g = await this._read(); if (g.code >= 400) throw new Error('FTP: ' + g.text); ok(g); } catch (e) { no(e); }
      });
    });
  }
  async cmd(line) {
    if (!this.sock) throw new Error('FTP: нет соединения');
    this.sock.write(line + '\r\n');
    return this._read();
  }
  async login() {
    let r = await this.cmd('USER ' + this.user);
    if (r.code === 331) r = await this.cmd('PASS ' + this.pass);
    if (r.code >= 400) throw new Error('FTP: ' + r.text);
    return r;
  }
  async typeI() { const r = await this.cmd('TYPE I'); if (r.code >= 400) throw new Error('FTP: ' + r.text); }
  _data() {
    return new Promise((ok, no) => {
      const open = (host, port) => {
        const d = net.connect({host, port}); d.setTimeout(this.timeout);
        d.once('connect', () => ok(d)); d.once('error', no); d.once('timeout', () => no(new Error('FTP: таймаут данных')));
      };
      this.cmd('EPSV').then(r => {
        if (r.code === 229) { const m = r.text.match(/\((.)\1\1(\d+)\1\)/); if (m) return open(this.host, +m[2]); }
        return this.cmd('PASV').then(p => {
          if (p.code !== 227) throw new Error('FTP: ' + p.text);
          const m = p.text.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/); if (!m) throw new Error('FTP: не разобрать PASV');
          open(m.slice(1, 5).join('.'), (+m[5]) * 256 + (+m[6]));
        });
      }).catch(no);
    });
  }
  _collect(stream) {
    return new Promise((ok, no) => {
      let b = ''; stream.setEncoding('utf8');
      stream.on('data', d => b += d); stream.once('error', no);
      stream.once('end', () => ok(b)); stream.once('close', () => ok(b));
    });
  }
  async _transfer(line) {
    const d = await this._data();
    const p = this._collect(d);
    const r = await this.cmd(line);
    if (r.code >= 400) { try { d.destroy(); } catch {} throw new Error('FTP: ' + r.text); }
    const text = await p;
    const fin = await this._read();
    if (fin.code >= 400) throw new Error('FTP: ' + fin.text);
    return text;
  }
  async list(dir) {
    let text;
    try { text = await this._transfer('MLSD ' + dir); }
    catch { text = await this._transfer('LIST ' + dir); }
    return text.split(/\r?\n/).filter(Boolean).map(line => {
      if (line.includes(';')) {
        const i = line.indexOf(' '); if (i < 0) return null;
        const facts = {}; for (const f of line.slice(0, i).split(';')) { const [k, v] = f.split('='); if (k) facts[k.toLowerCase()] = v; }
        const name = line.slice(i + 1).trim(); if (!name || name === '.' || name === '..') return null;
        const m = facts.modify || '';
        const mtime = m.length >= 8 ? new Date(+m.slice(0, 4), +m.slice(4, 6) - 1, +m.slice(6, 8), +(m.slice(8, 10) || 0), +(m.slice(10, 12) || 0), +(m.slice(12, 14) || 0)).getTime() : 0;
        return {name, dir: facts.type === 'dir' || facts.type === 'cdir' || facts.type === 'pdir', size: +facts.size || 0, mtime};
      }
      let m = line.match(/^([\-dl])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/);
      if (m) return {name: m[3].trim(), dir: m[1] === 'd', size: +m[2], mtime: 0};
      m = line.match(/^(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(AM|PM)\s+(<DIR>|\d+)\s+(.+)$/i);
      if (m) { const y = 2000 + +m[3], h = (+m[4]) % 12 + (/pm/i.test(m[6]) ? 12 : 0); return {name: m[8].trim(), dir: /^<DIR>$/i.test(m[7]), size: /^<DIR>$/i.test(m[7]) ? 0 : +m[7], mtime: new Date(y, +m[1] - 1, +m[2], h, +m[5]).getTime()}; }
      const n = line.split(/\s+/).slice(8).join(' '); return n ? {name: n, dir: false, size: 0, mtime: 0} : null;
    }).filter(e => e && e.name !== '.' && e.name !== '..');
  }
  async walk(base, depth = 0, out = []) {
    if (depth > 4 || out.length > 6000) return out;
    let items = [];
    try { items = await this.list(base); } catch (e) { if (depth === 0) throw e; return out; }
    for (const it of items) {
      const p = (base.replace(/\/+$/, '') || '') + '/' + it.name;
      if (it.dir) await this.walk(p, depth + 1, out);
      else out.push({path: p, name: it.name, size: it.size, mtime: it.mtime});
      if (out.length > 6000) break;
    }
    return out;
  }
  async download(remote, local) {
    await fs.promises.mkdir(path.dirname(local), {recursive: true});
    const d = await this._data();
    const file = fs.createWriteStream(local);
    const endP = new Promise((ok, no) => { file.once('finish', ok); file.once('error', no); d.once('error', no); });
    d.pipe(file);
    const r = await this.cmd('RETR ' + remote);
    if (r.code >= 400) { try { d.destroy(); } catch {} try { file.destroy(); } catch {} throw new Error('FTP: ' + r.text); }
    await endP;
    const fin = await this._read();
    if (fin.code >= 400) throw new Error('FTP: ' + fin.text);
    return local;
  }
  close() { try { this.sock?.end(); } catch {} try { this.sock?.destroy(); } catch {} this.sock = null; }
}

module.exports = {Ftp};
