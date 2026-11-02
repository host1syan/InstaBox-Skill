#!/usr/bin/env node
// 从 stdin 读一行 JSON 参数数组，输出 JSON 对象。bun 下 argv 不可用，故用 stdin。
// 用法: echo '["3000","msedge","public"]' | node mkjson.js publish
'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let a = [];
  try {
    a = JSON.parse(raw.trim() || '[]');
  } catch {
    process.stderr.write('mkjson: 参数不是 JSON 数组\n');
    process.exit(2);
  }
  const mode = process.argv[2];
  let o;
  switch (mode) {
    case 'port':
      o = { port: Number(a[0]), access: a[2] || 'public' };
      if (a[1]) o.name = a[1];
      break;
    case 'snapshot':
      o = { name: a[0] };
      if (a[1]) o.description = a[1];
      break;
    case 'restore':
      o = { snapshotId: a[0] };
      break;
    case 'exec':
      o = { cmd: a[0] };
      break;
    default:
      o = a[0];
  }
  process.stdout.write(JSON.stringify(o));
});
