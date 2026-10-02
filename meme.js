// GET /api/meme?min=10000
// Memindai pool trending di beberapa chain, lalu ambil trade BUY besar. Tanpa API key.
const NETWORKS = ["solana", "eth", "base", "bsc"];
const GT = "https://api.geckoterminal.com/api/v2";

async function j(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}

export default async function handler(req, res) {
  const min = Number(req.query.min || 10000);
  const out = [];
  try {
    for (const net of NETWORKS) {
      let pools = [];
      try {
        pools = (await j(`${GT}/networks/${net}/trending_pools`)).data.slice(0, 6);
      } catch (e) { continue; }
      await Promise.all(pools.map(async (p) => {
        try {
          const trades = (await j(`${GT}/networks/${net}/pools/${p.attributes.address}/trades`)).data;
          for (const t of trades) {
            const a = t.attributes;
            const usd = Number(a.volume_in_usd);
            if (a.kind === "buy" && usd >= min) {
              out.push({
                chain: net,
                token: p.attributes.name,
                pool: p.attributes.address,
                usd,
                wallet: a.tx_from_address,
                tx: a.tx_hash,
                time: a.block_timestamp,
              });
            }
          }
        } catch (e) {}
      }));
    }
    out.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(out.slice(0, 100));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
