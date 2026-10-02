// GET /api/exchange?min=1000000
// Transfer BTC/ETH besar yang masuk/keluar exchange, via Whale Alert API.
// Butuh env var WHALE_ALERT_KEY di Vercel (Settings > Environment Variables).
export default async function handler(req, res) {
  const key = process.env.WHALE_ALERT_KEY;
  if (!key) return res.status(500).json({ error: "WHALE_ALERT_KEY belum diisi di Vercel" });
  const min = Number(req.query.min || 1000000);
  const start = Math.floor(Date.now() / 1000) - 3500;
  const url = `https://api.whale-alert.io/v1/transactions?api_key=${key}&min_value=${min}&start=${start}&limit=100`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    const list = (d.transactions || [])
      .filter((t) => ["btc", "eth"].includes(t.symbol))
      .map((t) => ({
        symbol: t.symbol.toUpperCase(),
        amount: t.amount,
        usd: t.amount_usd,
        from: t.from.owner || t.from.owner_type,
        to: t.to.owner || t.to.owner_type,
        // inflow = ke exchange (potensi jual), outflow = keluar exchange (potensi tahan)
        direction: t.to.owner_type === "exchange" && t.from.owner_type !== "exchange" ? "inflow"
          : t.from.owner_type === "exchange" && t.to.owner_type !== "exchange" ? "outflow" : "other",
        hash: t.hash,
        time: new Date(t.timestamp * 1000).toISOString(),
      }))
      .sort((a, b) => new Date(b.time) - new Date(a.time));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(list);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
