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

- `POST /api/broker/quote` — rank workers + clearing price
- `POST /api/broker/evaluate` — accept / counter / ask requester / next

Set `MARKET_MAKER_URL=http://localhost:3000` on the agent. Keep `IMESSAGE_LIVE=false` here.
