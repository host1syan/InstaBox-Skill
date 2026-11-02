#!/usr/bin/env node
// ibx 的 JSON 渲染器：stdin 读 JSON，按 mode 输出人可读结果。
// mode: machines | snapshots | ports | exec | field:<dot.path>
'use strict';

let raw = '';
process.stdout.on('error', e => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  const mode = process.argv[2] || 'field:';
  let o;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    process.stderr.write('ibx: 响应不是 JSON: ' + raw.slice(0, 500) + '\n');
    process.exit(3);
  }

  const pad = (s, n) => String(s == null ? '-' : s).padEnd(n);

  if (mode === 'machines') {
    const list = o.machines || o.items || (Array.isArray(o) ? o : []);
    if (!list.length) return process.stdout.write('（无机器）\n');
    for (const m of list) {
      const rt = m.runtime || {};
      const spec = m.spec || {};
      process.stdout.write(
        `${pad(m.id, 30)} ${pad(m.name, 16)} ${pad(m.state, 10)} ready=${pad(rt.ready, 6)} ` +
          `${spec.vcpus || '?'}vCPU/${spec.memMiB || '?'}MiB run=${m.runStartedAt || '-'}\n`
      );
    }
    return;
  }

  if (mode === 'snapshots') {
    const list = o.snapshots || o.items || (Array.isArray(o) ? o : []);
    if (!list.length) return process.stdout.write('（无快照）\n');
    for (const s of list) {
      process.stdout.write(
        `${pad(s.id, 30)} ${pad(s.name, 24)} ${pad(s.status || s.state, 10)} ${s.createdAt || '-'}\n`
      );
    }
    return;
  }

  if (mode === 'ports') {
    const list = o.ports || o.items || (Array.isArray(o) ? o : []);
    if (!list.length) return process.stdout.write('（无已发布端口）\n');
    for (const p of list) {
      process.stdout.write(
        `${pad(p.port, 8)} ${pad(p.protocol, 6)} ${pad(p.access, 8)} ${pad(p.name, 20)} ${p.url || p.tokenUrl || '-'}\n`
      );
    }
    return;
  }

  if (mode === 'logs') {
    process.stdout.write(`机器 ${o.machineId}  state=${o.state}\n`);
    const lines = String(o.console || '').replace(/\r/g, '').split('\n');
    const tail = lines.slice(-40).join('\n');
    process.stdout.write(`--- console (末 40 行${o.consoleTruncated ? '，已截断' : ''}) ---\n${tail}\n`);
    if (o.operations && o.operations.length) {
      process.stdout.write('--- operations ---\n');
      for (const op of o.operations) {
        process.stdout.write(
          `${op.id} ${pad(op.type, 10)} ${pad(op.state, 10)} ${op.phase || ''} ${op.error ? 'ERR=' + op.error.code : ''}\n`
        );
      }
    }
    return;
  }

  if (mode === 'metrics') {
    const ms = o.metrics || [];
    for (const m of ms.slice(-5)) {
      const memPct = ((m.memUsed / m.memTotal) * 100).toFixed(0);
      process.stdout.write(
        `${m.timestamp} cpu=${pad(m.cpuUsedPct + '%', 7)} mem=${pad(memPct + '%', 5)} ` +
          `in=${pad(m.netInBytesPerSec, 8)} out=${pad(m.netOutBytesPerSec, 8)}\n`
      );
    }
    return;
  }

  if (mode === 'disk') {
    for (const f of o.filesystems || []) {
      process.stdout.write(
        `${pad(f.mount, 8)} ${pad(f.usedPct + '%', 7)} ${pad(f.level, 9)} ` +
          `used=${(f.usedBytes / 1073741824).toFixed(1)}G free=${(f.availableBytes / 1073741824).toFixed(1)}G\n`
      );
    }
    return;
  }

  if (mode === 'files') {
    if (o.type === 'dir') {
      process.stdout.write(`${o.path}  (${o.mode}  ${(o.entries || []).length} 项)\n`);
      const sz = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + 'M' : b >= 1024 ? (b / 1024).toFixed(0) + 'K' : b + 'B');
      for (const e of o.entries || []) {
        process.stdout.write(
          `  ${e.type === 'dir' ? 'd' : '-'} ${pad(e.mode, 12)} ${pad(e.type === 'dir' ? '' : sz(e.size), 8)} ${e.name}\n`
        );
      }
    } else {
      process.stdout.write(`${o.path}  ${o.mode}  ${o.size}B\n`);
      if (o.content != null) process.stdout.write(o.content);
    }
    return;
  }

  if (mode === 'exec') {
    if (o.stdout) process.stdout.write(o.stdout.endsWith('\n') ? o.stdout : o.stdout + '\n');
    if (o.stderr) process.stderr.write(o.stderr.endsWith('\n') ? o.stderr : o.stderr + '\n');
    if (o.oomKilled) process.stderr.write('ibx: 命令被 OOM killer 杀掉\n');
    if (o.diskWarning) process.stderr.write('ibx: 磁盘告警 ' + JSON.stringify(o.diskWarning) + '\n');
    process.exit(Number.isInteger(o.exitCode) ? (o.exitCode > 0 ? 1 : 0) : 0);
  }

  // field:<dot.path>
  const path = mode.slice(6);
  if (!path) return process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  let v = o;
  for (const k of path.split('.')) {
    if (v == null) break;
    v = Array.isArray(v) && /^\d+$/.test(k) ? v[Number(k)] : v[k];
  }
  if (v === undefined || v === null) process.exit(4);
  process.stdout.write((typeof v === 'object' ? JSON.stringify(v) : String(v)) + '\n');
});
