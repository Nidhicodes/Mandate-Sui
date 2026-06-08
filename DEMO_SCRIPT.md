# Demo Video — Spoken Script (read this naturally, ~4:20)

---

## OPENING (show the landing page)

"Hey — this is Mandate Memory. The idea is pretty simple. AI agents are going to manage money on-chain. That's happening. But right now there's nothing stopping an agent from blowing past its limits except code that the agent itself controls. And there's no way to verify *why* it made a decision after the fact.

So I built a system where the agent's budget is enforced by a Move object on Sui — not by Python, not by a config file, by the chain itself. And every reasoning cycle gets stored on Walrus before any trade happens, so you have a cryptographic audit trail. Let me show you."

---

## RUN THE AGENT (click "Run Agent Cycle")

"Alright, I'm going to run the agent. This kicks off a six-phase reasoning loop. There are actually two AI agents working together here — a Strategist and a Risk Officer — both running on Llama 3.3 70B through Groq.

*(steps start appearing one by one)*

So first it perceives — pulls live price data for SUI, DEEP, and WAL tokens. You can see the prices right there, and whether they came from CoinGecko live or an estimate.

Now the Strategist is analyzing — forming a market view. This is real LLM output, it's different every time you run it.

Next it sets a target allocation. And this is where the mandate matters — see those caps? 30% max in any single token, 60% max across the whole cluster. Those aren't guidelines the agent is *trying* to follow. Those are hard constraints that the Move contract will literally revert if the agent tries to break.

It plans out the trades — sells before buys to free up cash.

Now the Risk Officer steps in. This is a separate agent with a completely different system prompt. Its job is to independently review each trade and veto anything it doesn't like. You can see it approved all three here.

And then — this is the key part for the Walrus track — the commit phase."

---

## SHOW THE WALRUS PROOF (point to the commit section, then click the link)

"See this blob ID? This is a real Walrus testnet blob. The entire reasoning chain — all six phases, the market analysis, the target allocation, the Risk Officer's verdict — all of it was just stored on Walrus. And the SHA-256 hash of that blob is what gets committed on-chain.

Let me click this — *(click 'View on Walrus' link)* — and here it is. Raw JSON from the Walrus aggregator. You can see the full reasoning chain, the timestamps, the target allocation. This was stored *before* any trade executed.

So anyone — a user, an auditor, a regulator — can verify: fetch the blob from Walrus, hash it, compare to the on-chain commitment. If they match, you know the reasoning wasn't fabricated after the fact. That's the whole point."

---

## EXECUTE ON-CHAIN (switch back to dashboard, click "Execute On-Chain")

"Now let's actually execute. *(click the button)* This isn't simulated — this is building a real Programmable Transaction Block and submitting it to Sui testnet.

What's happening in that PTB is two calls in one atomic transaction. First, `mandate::authorize` — this checks every cap and returns what we call a hot-potato receipt. It's a Move struct with no `drop` ability, which means the transaction literally cannot succeed unless the vault consumes it. You can't skip the enforcement. Move's type system won't let you.

Second call is `vault::execute_buy` — it takes that receipt, checks position limits and cluster concentration, and if everything passes, it transfers real SUI from the vault.

*(results appear with tx digest)*

And there it is — a real transaction digest. Let me open it on SuiScan. *(click the link)*

You can see the `ComplianceReceipt` event right here. Real gas paid. Real tokens moved. And if I check the mandate object — the `cumulative_used` counter went up. That budget is finite and enforced on-chain. The agent can't spend more than the mandate allows, period."

---

## SHOW THE MEMORY PANEL (switch back, point to left panel)

"Every cycle gets added to this Walrus Memory panel. Each one is clickable — you can view any past reasoning chain on Walrus. The agent actually references its prior decisions to avoid unnecessary churn. It remembers what it thought last cycle and only trades if something materially changed.

So you end up with this chain: the agent reasons, Walrus stores it, the hash is committed on-chain, the trade executes through the mandate enforcement, and a compliance receipt is emitted. Every step is verifiable. Every step is linked."

---

## CLOSE (back to the hero section or architecture)

"That's Mandate Memory. The agent can reason freely — it's a real LLM, it makes its own calls. But it cannot overspend, it cannot break its concentration limits, and it cannot erase its reasoning. The Move contract enforces. Walrus proves. Thanks for watching."

---

## TIMING GUIDE

| Section | Target | What's on screen |
|---------|--------|-----------------|
| Opening | 0:00–0:30 | Landing page hero |
| Run Agent | 0:30–2:00 | Reasoning chain appearing step by step |
| Walrus Proof | 2:00–2:50 | Walrus blob JSON in new tab |
| Execute | 2:50–3:50 | Execute button → tx results → SuiScan |
| Memory + Close | 3:50–4:20 | Memory panel → final hero shot |

---

## BEFORE YOU HIT RECORD

1. Start the agent backend: `cd agent && npx tsx src/server.ts`
2. Start the frontend: `cd frontend && npx next dev`
3. Open browser at `localhost:3000`, zoom to 110%
4. Run one cycle beforehand to confirm Walrus + LLM are working
5. Reset the vault (`curl -X POST localhost:3002/api/reset`)
6. Pre-open a SuiScan tab with a previous tx so you can show it loads fast
7. Pre-load one Walrus blob URL in another tab as backup

## DELIVERY TIPS

- Speak like you're showing a friend your project, not presenting to a boardroom
- Don't read — know the flow and improvise the exact words
- Pause for a beat when the reasoning steps appear (let the viewer read them)
- When you click the Walrus link, say "here it is" and let the JSON speak for itself for 3 seconds
- The SuiScan moment should feel like a mic drop — "real gas, real tokens, there's the receipt"
- End cleanly. Don't trail off. "Thanks for watching" then stop recording.
