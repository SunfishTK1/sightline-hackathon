# market-maker

Matching, outreach, and price/time brokering for Gotchu. Personal agents own intake and completion; this package owns the market.

```bash
cd market-maker
cp .env.example .env.local   # Railway Postgres + iMessage keys
npm install
npm run schema
npm run seed
npm run dev
```

Internal board: [http://localhost:3000](http://localhost:3000)

Broker API (personal agent is the only SMS sender):

- `POST /api/broker/quote` — rank workers + prime price (max P(deal)) + walk/bus/drive quote
- `POST /api/broker/evaluate` — accept / counter / ask requester / next; closed deals write `market_comps`

Set `MARKET_MAKER_URL=http://localhost:3000` on the agent. Keep `IMESSAGE_LIVE=false` here.

Ethics: run Gotchu on `:3001` and set `ETHICS_BASE_URL=http://127.0.0.1:3001`. Quote and evaluate call `/api/ethics/review` and `/api/ethics/arbitrate`. `voice-mcp` calls review/amendment on intake and edits. Do not copy Daphne's deny-list.
