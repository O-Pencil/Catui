/**
 * [WHO]: runToolTests() —— 工具层单元测试（read / bash / write / edit / grep / ls）
 * [FROM]: src/tools.ts（executeTool + formatReport）、fs、path
 * [TO]: test/run-all.tsx（被统一 runner 调用）
 * [HERE]: learning/phase-1-while-loop/test/unit/tools.tsx
 *
 * 设计原则：
 *   - 纯本地，不调任何 API
 *   - 临时文件全部在 process.cwd() 下用带 pid 的唯一名创建（确保 ls '.' 能看到）
 *   - 必须在 finally 里 unlink + 注册 process.on('exit') 兜底，防止脏数据
 *   - 测试名 + ✅/❌ 输出格式跟 run-all.tsx 对齐
 */

import fs from 'fs';
import path from 'path';
import { executeTool, formatReport } from '../../src/tools.ts';

// ─── 测试基础设施 ─────────────────────────────────────────────

const PID = process.pid;
let pass = 0;
let fail = 0;
const errors: string[] = [];

// 收集所有创建的临时路径，统一兜底清理
const tempFiles: string[] = [];
let cleanupRegistered = false;

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = (): void => {
    for (const p of tempFiles) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // 清理失败不抛——本来就是兜底
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}

function tmpPath(name: string): string {
  // 放在 cwd 下：ls '.' 场景要求"能看到"这个文件
  const p = path.join(process.cwd(), `__tools_test_${PID}_${name}__`);
  tempFiles.push(p);
  return p;
}

function safeUnlink(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // 忽略
  }
}

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const queue: TestCase[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  queue.push({ name, fn });
}

function assert(cond: any, reason: string): void {
  if (!cond) throw new Error(reason);
}

async function runAll(): Promise<void> {
  for (const tc of queue) {
    process.stdout.write(`  · ${tc.name}\n`);
    try {
      await tc.fn();
      pass++;
      process.stdout.write(`    ✅ 通过\n`);
    } catch (err: any) {
      fail++;
      const reason = err?.message || String(err);
      errors.push(`${tc.name}: ${reason}`);
      process.stdout.write(`    ❌ 失败: ${reason}\n`);
    }
  }
}

// ─── 16 个测试用例 ─────────────────────────────────────────────

// 1. read 存在文件
test('read 存在文件 → ok:true, content 有内容', async () => {
  const p = tmpPath('read_ok');
  fs.writeFileSync(p, 'hello world', 'utf8');
  try {
    const r = await executeTool('read', { path: p });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert(typeof r.content === 'string' && r.content.length > 0, 'content 应有内容');
    assert(r.content === 'hello world', `content 不匹配: ${r.content}`);
  } finally {
    safeUnlink(p);
  }
});

// 2. read 不存在文件
test('read 不存在文件 → ok:false, error 含 ENOENT', async () => {
  const ghost = path.join(process.cwd(), `__tools_test_${PID}_ghost_never__`);
  const r = await executeTool('read', { path: ghost });
  assert(r.ok === false, `expected ok:false, got ${JSON.stringify(r)}`);
  assert(typeof r.error === 'string' && r.error.includes('ENOENT'), `error 应含 ENOENT, got: ${r.error}`);
});

// 3. bash 'echo hi'
test("bash 'echo hi' → ok:true, stdout 是 'hi\\n'", async () => {
  const r = await executeTool('bash', { command: 'echo hi' });
  assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
  assert(r.stdout === 'hi\n', `expected 'hi\\n', got: ${JSON.stringify(r.stdout)}`);
});

// 4. bash 'false'
test("bash 'false' → ok:false", async () => {
  const r = await executeTool('bash', { command: 'false' });
  assert(r.ok === false, `expected ok:false, got ${JSON.stringify(r)}`);
  assert(typeof r.error === 'string' && r.error.length > 0, 'error 应有内容');
});

// 5. bash 'exit 1'
test("bash 'exit 1' → ok:false", async () => {
  const r = await executeTool('bash', { command: 'exit 1' });
  assert(r.ok === false, `expected ok:false, got ${JSON.stringify(r)}`);
  assert(typeof r.error === 'string' && r.error.length > 0, 'error 应有内容');
});

// 6. write 新文件
test('write 新文件 → ok:true, bytes > 0', async () => {
  const p = tmpPath('write_new');
  // 确保不存在
  safeUnlink(p);
  const content = 'first write content';
  try {
    const r = await executeTool('write', { path: p, content });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert(typeof r.bytes === 'number' && r.bytes > 0, `bytes 应 > 0, got: ${r.bytes}`);
    assert(fs.existsSync(p), '文件应被创建');
    assert(fs.readFileSync(p, 'utf8') === content, '磁盘内容应一致');
  } finally {
    safeUnlink(p);
  }
});

// 7. write 覆盖已存在
test('write 覆盖已存在 → ok:true, 新内容覆盖', async () => {
  const p = tmpPath('write_overwrite');
  fs.writeFileSync(p, 'OLD CONTENT', 'utf8');
  const newContent = 'NEW OVERWRITTEN CONTENT';
  try {
    const r = await executeTool('write', { path: p, content: newContent });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    const onDisk = fs.readFileSync(p, 'utf8');
    assert(onDisk === newContent, `磁盘应被覆盖为新内容, got: ${onDisk}`);
    assert(!onDisk.includes('OLD'), '旧内容应已消失');
  } finally {
    safeUnlink(p);
  }
});

// 8. edit 唯一匹配
test('edit 唯一匹配 → ok:true, diff 字段', async () => {
  const p = tmpPath('edit_unique');
  fs.writeFileSync(p, 'alpha beta gamma', 'utf8');
  try {
    const r = await executeTool('edit', { path: p, oldText: 'beta', newText: 'BETA' });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert(typeof r.diff === 'string' && r.diff.length > 0, 'diff 字段应非空');
    assert(fs.readFileSync(p, 'utf8') === 'alpha BETA gamma', '文件应被替换');
  } finally {
    safeUnlink(p);
  }
});

// 9. edit 0 匹配
test('edit 0 匹配 → ok:false, error 含"找不到"', async () => {
  const p = tmpPath('edit_zero');
  fs.writeFileSync(p, 'hello', 'utf8');
  try {
    const r = await executeTool('edit', { path: p, oldText: 'absent-text-xyz', newText: 'whatever' });
    assert(r.ok === false, `expected ok:false, got ${JSON.stringify(r)}`);
    assert(typeof r.error === 'string' && r.error.includes('找不到'), `error 应含"找不到", got: ${r.error}`);
  } finally {
    safeUnlink(p);
  }
});

// 10. edit 多次匹配
test('edit 多次匹配 → ok:false, error 含"次"', async () => {
  const p = tmpPath('edit_multi');
  fs.writeFileSync(p, 'foo foo foo', 'utf8');
  try {
    const r = await executeTool('edit', { path: p, oldText: 'foo', newText: 'bar' });
    assert(r.ok === false, `expected ok:false, got ${JSON.stringify(r)}`);
    assert(typeof r.error === 'string' && r.error.includes('次'), `error 应含"次", got: ${r.error}`);
  } finally {
    safeUnlink(p);
  }
});

// 11. grep 找到
test('grep 找到 → ok:true, matches 非空, count 正确', async () => {
  const p = tmpPath('grep_hit');
  const lines = ['first line', 'second TARGET line', 'third line', 'another TARGET here'];
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  try {
    const r = await executeTool('grep', { path: p, pattern: 'TARGET' });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert(Array.isArray(r.matches) && r.matches.length > 0, 'matches 应非空');
    assert(r.count === 2, `count 应为 2, got: ${r.count}`);
    assert(r.matches[0].line === 2 && r.matches[1].line === 4, '行号应正确');
  } finally {
    safeUnlink(p);
  }
});

// 12. grep 没找到
test('grep 没找到 → ok:true, count=0', async () => {
  const p = tmpPath('grep_miss');
  fs.writeFileSync(p, 'nothing here\nat all', 'utf8');
  try {
    const r = await executeTool('grep', { path: p, pattern: 'NOT-PRESENT-XYZ' });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert(r.count === 0, `count 应为 0, got: ${r.count}`);
    assert(Array.isArray(r.matches) && r.matches.length === 0, 'matches 应为空数组');
  } finally {
    safeUnlink(p);
  }
});

// 13. ls 当前目录
test('ls 当前目录 → ok:true, items 含创建的文件', async () => {
  // 用一个非常独特的前缀确保不被其他文件污染
  const p = tmpPath('ls_visible');
  fs.writeFileSync(p, 'marker', 'utf8');
  try {
    const r = await executeTool('ls', { path: '.' });
    assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert(Array.isArray(r.items), 'items 应为数组');
    const base = path.basename(p);
    const found = r.items.some((it: any) => it.name === base);
    assert(found, `items 应含 ${base}, got: ${JSON.stringify(r.items.map((i: any) => i.name))}`);
  } finally {
    safeUnlink(p);
  }
});

// 14. formatReport(read) → 返回 content
test('formatReport(read) → 返回 content', async () => {
  const p = tmpPath('fmt_read');
  const body = 'format-read-payload';
  fs.writeFileSync(p, body, 'utf8');
  try {
    const r = await executeTool('read', { path: p });
    const report = formatReport(r);
    assert(report === body, `expected "${body}", got: ${JSON.stringify(report)}`);
  } finally {
    safeUnlink(p);
  }
});

// 15. formatReport(write) → "WROTE X bytes to ..."
test('formatReport(write) → "WROTE X bytes to ..."', async () => {
  const p = tmpPath('fmt_write');
  safeUnlink(p);
  const content = 'format-write-payload';
  try {
    const r = await executeTool('write', { path: p, content });
    const report = formatReport(r);
    assert(report.startsWith('WROTE '), `应 WROTE 开头, got: ${report}`);
    assert(report.includes('bytes to'), `应含 "bytes to", got: ${report}`);
    assert(report.endsWith(p), `应以路径结尾, got: ${report}`);
    assert(report.includes(String(r.bytes)), `应含字节数 ${r.bytes}, got: ${report}`);
  } finally {
    safeUnlink(p);
  }
});

// 16. formatReport(error) → "ERROR: ..."
test('formatReport(error) → "ERROR: ..."', () => {
  const errResult = { ok: false, error: 'something blew up' };
  const report = formatReport(errResult);
  assert(report.startsWith('ERROR: '), `应 ERROR: 开头, got: ${report}`);
  assert(report.includes('something blew up'), `应含原始 error, got: ${report}`);
});

// ─── 入口 ─────────────────────────────────────────────────────

export async function runToolTests(): Promise<{ pass: number; fail: number; errors: string[] }> {
  registerCleanup();
  pass = 0;
  fail = 0;
  errors.length = 0;
  await runAll();
  return { pass, fail, errors };
}

// 允许 `tsx test/unit/tools.tsx` 直接跑
if (import.meta.url === `file://${process.argv[1]}`) {
  runToolTests().then((r) => {
    console.log(`\n  TOTAL: ${r.pass} pass, ${r.fail} fail`);
    if (r.errors.length) {
      console.log('\n  errors:');
      r.errors.forEach((e) => console.log(`    - ${e}`));
    }
    process.exit(r.fail === 0 ? 0 : 1);
  });
}
