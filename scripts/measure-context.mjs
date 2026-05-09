#!/usr/bin/env node
/**
 * measure-context.mjs — 测量 nanoPencil 实际发送给 LLM 的上下文大小
 *
 * 原理：monkey-patch OpenAI SDK 的 fetch，拦截所有 HTTP 请求，
 * 记录每次请求的 payload 大小和 token 数（从响应 usage 字段获取）。
 *
 * 用法：
 *   NANOPENCIL_CODING_AGENT_DIR=/tmp/xxx node scripts/measure-context.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ── 拦截 fetch ──────────────────────────────────────────────────────────────
const requests = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async function patchedFetch(url, options) {
  const urlStr = typeof url === "string" ? url : url?.url || String(url);
  
  // 只拦截发往 minimax 的请求
  if (urlStr.includes("minimaxi.com") || urlStr.includes("minimax")) {
    const body = options?.body;
    let parsed = null;
    let bodySize = 0;
    
    if (body) {
      const bodyStr = typeof body === "string" ? body : body.toString();
      bodySize = Buffer.byteLength(bodyStr, "utf-8");
      try {
        parsed = JSON.parse(bodyStr);
      } catch {}
    }

    const reqInfo = {
      index: requests.length + 1,
      url: urlStr,
      method: options?.method || "POST",
      bodyBytes: bodySize,
      model: parsed?.model,
      stream: parsed?.stream,
      messageCount: parsed?.messages?.length,
      toolCount: parsed?.tools?.length || 0,
      // 计算各部分大小
      systemPromptChars: 0,
      userMessageChars: 0,
      assistantMessageChars: 0,
      toolResultChars: 0,
      toolDefinitionChars: 0,
    };

    if (parsed?.messages) {
      for (const msg of parsed.messages) {
        const content = typeof msg.content === "string" 
          ? msg.content 
          : JSON.stringify(msg.content || "");
        const len = content.length;
        
        switch (msg.role) {
          case "system":
            reqInfo.systemPromptChars += len;
            break;
          case "user":
            reqInfo.userMessageChars += len;
            break;
          case "assistant":
            reqInfo.assistantMessageChars += len;
            break;
          case "tool":
            reqInfo.toolResultChars += len;
            break;
        }
      }
    }

    if (parsed?.tools) {
      reqInfo.toolDefinitionChars = JSON.stringify(parsed.tools).length;
    }

    requests.push(reqInfo);
    
    console.error(`\n[MEASURE] ═══ HTTP Request #${reqInfo.index} ═══`);
    console.error(`[MEASURE]   URL: ${urlStr}`);
    console.error(`[MEASURE]   Body size: ${(bodySize / 1024).toFixed(1)} KB`);
    console.error(`[MEASURE]   Messages: ${reqInfo.messageCount}`);
    console.error(`[MEASURE]   Tools defined: ${reqInfo.toolCount}`);
    console.error(`[MEASURE]   System prompt: ${reqInfo.systemPromptChars} chars`);
    console.error(`[MEASURE]   User messages: ${reqInfo.userMessageChars} chars`);
    console.error(`[MEASURE]   Assistant messages: ${reqInfo.assistantMessageChars} chars`);
    console.error(`[MEASURE]   Tool results: ${reqInfo.toolResultChars} chars`);
    console.error(`[MEASURE]   Tool definitions: ${reqInfo.toolDefinitionChars} chars`);
    console.error(`[MEASURE]   Total content chars: ${reqInfo.systemPromptChars + reqInfo.userMessageChars + reqInfo.assistantMessageChars + reqInfo.toolResultChars + reqInfo.toolDefinitionChars}`);
  }

  // 调用原始 fetch
  const response = await originalFetch(url, options);
  
  // 拦截响应以获取 usage（非 streaming 情况）
  if ((urlStr.includes("minimaxi.com") || urlStr.includes("minimax")) && requests.length > 0) {
    const lastReq = requests[requests.length - 1];
    // Clone response to read body without consuming it
    const cloned = response.clone();
    try {
      const text = await cloned.text();
      // 对于 streaming 响应，找最后一个包含 usage 的 chunk
      const lines = text.split("\n");
      for (const line of lines.reverse()) {
        if (line.includes('"usage"')) {
          const cleaned = line.replace(/^data:\s*/, "");
          try {
            const chunk = JSON.parse(cleaned);
            if (chunk.usage) {
              lastReq.usage = chunk.usage;
              console.error(`[MEASURE]   Usage: input=${chunk.usage.prompt_tokens}, output=${chunk.usage.completion_tokens}, total=${chunk.usage.total_tokens}`);
              break;
            }
          } catch {}
        }
      }
    } catch {}
  }

  return response;
};

// ── 设置临时 agent 目录 ─────────────────────────────────────────────────────
const tmpDir = process.env.NANOPENCIL_CODING_AGENT_DIR || join(projectRoot, "scripts", ".measure-tmp");
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

if (!existsSync(join(tmpDir, "models.json"))) {
  writeFileSync(join(tmpDir, "models.json"), JSON.stringify({
    providers: {
      "minimax-coding": {
        baseUrl: "https://api.minimaxi.com/v1",
        api: "openai-completions",
        models: [{
          id: "MiniMax-M2.5",
          name: "MiniMax M2.5",
          input: ["text"],
          contextWindow: 204800,
          maxTokens: 65536,
        }],
      },
    },
  }, null, 2));
}

if (!existsSync(join(tmpDir, "auth.json"))) {
  const srcAuth = join(homedir(), ".nanopencil", "agent", "auth.json");
  if (existsSync(srcAuth)) cpSync(srcAuth, join(tmpDir, "auth.json"));
}

if (!existsSync(join(tmpDir, "settings.json"))) {
  writeFileSync(join(tmpDir, "settings.json"), "{}");
}

process.env.NANOPENCIL_CODING_AGENT_DIR = tmpDir;

// ── 运行 nanoPencil ─────────────────────────────────────────────────────────
process.argv = [
  process.argv[0],
  process.argv[1],
  "--print",
  "--provider", "minimax-coding",
  "--model", "MiniMax-M2.5",
  "--no-extensions",
  "--no-skills",
  "--disable-soul",
  "--no-session",
  // 传入额外的 CLI 参数（如 --no-tools）
  ...(process.env.MEASURE_EXTRA_ARGS ? process.env.MEASURE_EXTRA_ARGS.split(" ") : []),
  "读 README.md 然后告诉我这个项目是做什么的",
];

// 在退出时打印汇总
process.on("exit", () => {
  console.error("\n\n[MEASURE] ═══════════════════════════════════════════");
  console.error("[MEASURE]   汇总");
  console.error("[MEASURE] ═══════════════════════════════════════════");
  console.error(`[MEASURE]   总 HTTP 请求数: ${requests.length}`);
  
  let totalInput = 0;
  let totalOutput = 0;
  for (const req of requests) {
    totalInput += req.usage?.prompt_tokens || 0;
    totalOutput += req.usage?.completion_tokens || 0;
  }
  
  console.error(`[MEASURE]   总 input tokens: ${totalInput}`);
  console.error(`[MEASURE]   总 output tokens: ${totalOutput}`);
  console.error(`[MEASURE]   总 tokens: ${totalInput + totalOutput}`);
  console.error(`[MEASURE]   预估调用次数 (÷44): ~${Math.ceil((totalInput + totalOutput) / 44)}`);
  console.error("[MEASURE] ═══════════════════════════════════════════");
  
  // 写入详细报告
  const reportPath = join(projectRoot, "scripts", ".measure-report.json");
  writeFileSync(reportPath, JSON.stringify(requests, null, 2));
  console.error(`[MEASURE]   详细报告: ${reportPath}`);
});

// 动态导入 main
const { main } = await import("../dist/main.js");
await main(process.argv.slice(2));
