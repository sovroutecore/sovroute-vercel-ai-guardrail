/**
 * SovRoute x Vercel AI SDK — Bitcoin & EVM Pre-Flight Security Guardrail
 *
 * Connects Vercel AI SDK (generateText + multi-step tool calls) to SovRoute's
 * Remote Streamable HTTP MCP server (https://node.sovroute.com/mcp).
 */

import { generateText, jsonSchema, tool, type CoreTool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

const SOVROUTE_MCP_URL =
  process.env.SOVROUTE_MCP_URL || 'https://node.sovroute.com/mcp';

const SYSTEM_INSTRUCTIONS = `You are the SovRoute Pre-Flight Bitcoin & EVM Security Guardrail.
Always verify live blockchain conditions using the connected SovRoute MCP tools; never guess or invent numbers.
Available SovRoute MCP tools:
- get_bitcoin_smart_fees: real-time Bitcoin Core fee projections (sat/vB).
- get_mempool_entropy: live unconfirmed transactions, backlog size, fee pool, and congestion level.
- verify_block_header: synchronized Bitcoin Core v31.1 block height, hash, previous block hash, and merkle root.
- get_next_block_xray: candidate block miner template, cutoff fee rate, and queue ranking for a txid.
- check_rbf_fraud_shield: 0-conf RBF double-spend detection, BIP-125 signaling, and ancestor depth.
- inspect_eip7702_authorization: inspects Pectra authorization_list for drainer bytecode or replay risks.

Workflow:
1. Always call get_bitcoin_smart_fees and get_mempool_entropy.
2. Call verify_block_header to confirm chain synchronization.
3. If a Bitcoin txid is provided, call check_rbf_fraud_shield and get_next_block_xray.
4. If a delegate_address is provided, call inspect_eip7702_authorization with executionChainId=1 and authorizationList=[{"chainId": 1, "address": delegate_address, "nonce": 0}].
5. Output a concise structured Markdown Pre-Flight Security Report covering Network Fees, Mempool State, Candidate Block X-Ray, 0-Conf RBF Risk, EIP-7702 Check (if applicable), and end with:
FINAL VERDICT: APPROVE, HOLD, or REJECT.`;

function getMcpHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (process.env.SOVROUTE_PAYMENT_SIGNATURE?.trim()) {
    headers['Payment-Signature'] = process.env.SOVROUTE_PAYMENT_SIGNATURE.trim();
  }
  if (process.env.SOVROUTE_L402_TOKEN?.trim()) {
    headers['Authorization'] = `L402 ${process.env.SOVROUTE_L402_TOKEN.trim()}`;
  }
  if (process.env.MCP_DEMO_BYPASS_KEY?.trim()) {
    headers['X-SovRoute-Demo-Key'] = process.env.MCP_DEMO_BYPASS_KEY.trim();
  }
  return headers;
}

function parseMcpPayload(rawText: string): any {
  for (const line of rawText.split('\n')) {
    if (line.startsWith('data:')) {
      return JSON.parse(line.slice(5).trim());
    }
  }
  return JSON.parse(rawText);
}

async function mcpRpc(
  reqId: number,
  method: string,
  params: Record<string, unknown> = {}
): Promise<any> {
  const res = await fetch(SOVROUTE_MCP_URL, {
    method: 'POST',
    headers: getMcpHeaders(),
    body: JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`SovRoute MCP HTTP ${res.status}: ${errorText}`);
  }
  const text = await res.text();
  return parseMcpPayload(text);
}

async function fetchLiveMempoolTxid(): Promise<string> {
  const endpoints = [
    'https://mempool.emzy.de/api/mempool/recent',
    'https://blockstream.info/api/mempool/recent',
    'https://mempool.space/api/mempool/recent',
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = (await res.json()) as Array<{ txid: string }>;
        if (Array.isArray(data) && data.length > 0 && data[0].txid) {
          return data[0].txid;
        }
      }
    } catch {
      continue;
    }
  }
  throw new Error('Failed to retrieve recent transaction from mempool explorers');
}

export async function verifyMcpConnection(txid?: string): Promise<void> {
  console.log(`[SovRoute MCP] Connecting to ${SOVROUTE_MCP_URL} ...`);
  const init = await mcpRpc(1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'sovroute-vercel-ai-verifier', version: '1.0.0' },
  });
  console.log('[SovRoute MCP] Handshake OK:', init?.result?.serverInfo?.name || 'Sovereign Node Engine');

  const listRes = await mcpRpc(2, 'tools/list');
  const tools = (listRes?.result?.tools || []) as Array<{ name: string; description: string }>;
  console.log(`[SovRoute MCP] Discovered ${tools.length} tools:`, tools.map((t) => t.name));

  const feeRes = await mcpRpc(3, 'tools/call', {
    name: 'get_bitcoin_smart_fees',
    arguments: {},
  });
  console.log('\n[SovRoute MCP] get_bitcoin_smart_fees output:');
  console.log(feeRes?.result?.content?.[0]?.text);

  const blockRes = await mcpRpc(4, 'tools/call', {
    name: 'verify_block_header',
    arguments: {},
  });
  console.log('\n[SovRoute MCP] verify_block_header output:');
  console.log(blockRes?.result?.content?.[0]?.text);

  if (txid) {
    const rbfRes = await mcpRpc(5, 'tools/call', {
      name: 'check_rbf_fraud_shield',
      arguments: { txid },
    });
    console.log(`\n[SovRoute MCP] check_rbf_fraud_shield(${txid}) output:`);
    console.log(rbfRes?.result?.content?.[0]?.text);
  }
}

async function loadSovRouteVercelTools(): Promise<Record<string, CoreTool>> {
  await mcpRpc(1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'sovroute-vercel-ai-agent', version: '1.0.0' },
  });

  const listRes = await mcpRpc(2, 'tools/list');
  const tools = (listRes?.result?.tools || []) as Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;

  const vercelTools: Record<string, CoreTool> = {};
  let reqCounter = 10;

  for (const t of tools) {
    const schema =
      t.inputSchema && typeof t.inputSchema === 'object' && Object.keys(t.inputSchema).length > 0
        ? (t.inputSchema as any)
        : { type: 'object', properties: {} };

    vercelTools[t.name] = tool({
      description: t.description,
      parameters: jsonSchema(schema),
      execute: async (args: any) => {
        reqCounter += 1;
        process.stdout.write(`[MCP] Calling ${t.name}... `);
        const callRes = await mcpRpc(reqCounter, 'tools/call', {
          name: t.name,
          arguments: args || {},
        });
        const rawContent = callRes?.result?.content?.[0]?.text;
        process.stdout.write(`OK\n`);
        if (!rawContent) return callRes?.result || { error: 'No content' };
        try {
          return JSON.parse(rawContent);
        } catch {
          return rawContent;
        }
      },
    });
  }

  return vercelTools;
}

export async function runVercelAiAudit(
  txid?: string,
  delegateAddress?: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY is required in .env. Use --verify-mcp for key-free testing.');
    process.exit(1);
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const modelName = process.env.LLM_MODEL?.trim() || 'nvidia/nemotron-3.5-lightning:free';

  const openaiProvider = createOpenAI({ apiKey, baseURL, compatibility: 'compatible' });
  const model = openaiProvider(modelName, { parallelToolCalls: false });

  console.log(`[Vercel AI SDK] Connecting to SovRoute Streamable HTTP MCP (${SOVROUTE_MCP_URL})...`);
  const tools = await loadSovRouteVercelTools();
  console.log(`[Vercel AI SDK] Loaded ${Object.keys(tools).length} MCP tools into Vercel AI agent runtime.`);

  const targets = [
    txid ? `Bitcoin Transaction ID (txid): ${txid}` : 'Audit live Bitcoin mainnet fee & mempool state.',
  ];
  if (delegateAddress) {
    targets.push(`EIP-7702 Delegate Address (chainId 1): ${delegateAddress}`);
  }

  console.log(`[Vercel AI SDK] Initiating multi-step guardrail evaluation with model: ${modelName}...\n`);

  const { text, steps } = await generateText({
    model,
    system: SYSTEM_INSTRUCTIONS,
    maxSteps: 6,
    tools,
    prompt: `Execute a SovRoute Pre-Flight Security Audit for the following targets:\n${targets.join('\n')}`,
  });

  console.log(`[Vercel AI SDK] Agent completed in ${steps.length} steps with ${steps.flatMap((s) => s.toolCalls).length} tool calls.\n`);
  console.log('=== SOVROUTE x VERCEL AI SDK PRE-FLIGHT SECURITY REPORT ===\n');
  console.log(text);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verifyMcp = args.includes('--verify-mcp');
  const liveSample = args.includes('--live-sample');

  let txid: string | undefined;
  const txidIdx = args.indexOf('--txid');
  if (txidIdx !== -1 && args[txidIdx + 1]) {
    txid = args[txidIdx + 1];
  }

  let delegateAddress: string | undefined;
  const delIdx = args.indexOf('--delegate-address');
  if (delIdx !== -1 && args[delIdx + 1]) {
    delegateAddress = args[delIdx + 1];
  }

  if (liveSample && !txid) {
    try {
      txid = await fetchLiveMempoolTxid();
      console.log(`[Mainnet Sample] Selected unconfirmed TXID: ${txid}`);
    } catch (err: any) {
      console.warn(`[Mainnet Sample] Warning: ${err.message}`);
    }
  }

  if (verifyMcp) {
    await verifyMcpConnection(txid);
    return;
  }

  await runVercelAiAudit(txid, delegateAddress);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
