# SovRoute × Vercel AI SDK — Bitcoin & EVM Pre-Flight Security Guardrail

Production integration connecting **Vercel AI SDK (`ai`)** agents to **SovRoute**'s sovereign Bitcoin Core v31.1 & EVM forensics MCP server (`https://node.sovroute.com/mcp`) over **Streamable HTTP**.

## Why This Matters
Autonomous payment agents, Next.js dApps, and treasury bots shouldn't guess Bitcoin fee rates, mempool congestion, 0-conf Replace-By-Fee (RBF) fraud risks, or malicious EVM EIP-7702 delegations. SovRoute acts as a **deterministic pre-flight guardrail** exposing **7 read-only & zero-broadcast tools**:

1. **Live Fee & Mempool Oracle** (`get_bitcoin_smart_fees`, `get_mempool_entropy`, `verify_block_header`)
2. **Next-Block Miner Template X-Ray** (`get_next_block_xray`)
3. **0-Conf RBF Double-Spend Shield** (`check_rbf_fraud_shield`)
4. **Zero-Broadcast Consensus Simulator** (`simulate_raw_transaction`)
5. **EIP-7702 AuthTx Drainer Shield** (`inspect_eip7702_authorization`)

## Quickstart

```bash
git clone https://github.com/sovroutecore/sovroute-vercel-ai-guardrail.git
cd sovroute-vercel-ai-guardrail
npm install
cp .env.example .env
```

### 1. Smoke-Test MCP Connection (No LLM Key Required)
Verify connection to SovRoute's Remote Streamable HTTP MCP server:
```bash
npm run verify
```

### 2. Run Vercel AI SDK Security Guardrail
Configure your OpenAI API key (or any OpenAI-compatible provider such as OpenRouter or local endpoint) in `.env`:

```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://openrouter.ai/api/v1  # Optional: for OpenRouter or custom endpoint
LLM_MODEL=nvidia/nemotron-3.5-lightning:free     # Or gpt-4o, deepseek-v4.1, etc.
```

Run a live pre-flight audit against the freshest unconfirmed Bitcoin transaction from mempool:
```bash
npx tsx src/index.ts --live-sample --delegate-address 0x000000000000000000000000000000000000dEaD
```

Or audit a specific Bitcoin transaction ID:
```bash
npx tsx src/index.ts --txid 5b99afdf5342215ddad4ea382ff3aa933fcc231d64a0340b10785f9a3e4254d8
```

## Next.js Server Action / API Route Snippet

```typescript
import { generateText, jsonSchema, tool } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(req: Request) {
  const { txid } = await req.json();

  // Load SovRoute MCP tools from https://node.sovroute.com/mcp
  const tools = await loadSovRouteVercelTools();

  const { text } = await generateText({
    model: openai('gpt-4o'),
    system: 'You are SovRoute Pre-Flight Security Guardrail. Halt unsafe transactions.',
    maxSteps: 5,
    tools,
    prompt: `Audit Bitcoin transaction: ${txid}`,
  });

  return Response.json({ report: text });
}
```

## Sample Pre-Flight Security Report

```markdown
=== SOVROUTE x VERCEL AI SDK PRE-FLIGHT SECURITY REPORT ===

# Pre-Flight Security Report

## Network Fees
- Fastest Fee Rate: 1.92 sat/vB
- Half Hour: 1.44 sat/vB
- Hour: 1.22 sat/vB
- Economic: 1.11 sat/vB

## Mempool State
- Unconfirmed Transactions: 52,410
- Total Mempool Size (vsize): 30,680,000 bytes
- Congestion Level: HIGH

## Chain Tip Verification
- Chain Tip Height: 976,612
- Best Block Hash: 00000000000000000001dbbf12ae1f60cee52ae8735784deb716cf4be213b781
- Node Synchronization: 100% Synced (Bare-metal Bitcoin Core v31.1)

## Candidate Block X-Ray
- Block Height: 976,613
- Cutoff Fee Rate: 1.85 sat/vB
- Queue Status: GUARANTEED_NEXT_BLOCK

## 0-Conf RBF Double-Spend Risk
- BIP-125 Replaceable: Yes
- Conflicting Spends: None
- Risk Level: HIGH_RISK_RBF_ENABLED
- Recommendation: Do not accept 0-confirmation payment. Wait for 1 on-chain block confirmation.

## EIP-7702 Delegation Check
- Target Address: 0x000000000000000000000000000000000000dEaD
- Risk Level: SUSPICIOUS_UNVERIFIED
- Details: Burn/dead address delegation detected with zero prior transaction history.

FINAL VERDICT: HOLD
```

## Multi-Rail Payment
SovRoute MCP includes **15 free evaluation calls per 24 hours per IP**. For high-throughput production agents, requests settle via:
- **Lightning Network (L402):** 1–5 satoshis per call
- **Base L2 (x402 v2):** $0.001–$0.005 USDC per call to `0x488cbDad29E60d8Bae53FFF4c4252C9711dF9784`

## License
MIT
