// GET /api/exchange?min=500000
// Transfer ETH & BTC besar dari/ke wallet exchange. Gratis:
//  - ETH: Etherscan API v2 (butuh env ETHERSCAN_KEY, key gratis di etherscan.io/apis)
//  - BTC: mempool.space (tanpa key)
// Catatan: hanya memantau alamat yang terdaftar di bawah. Tambah alamat lain lewat
// env EXTRA_EXCHANGES, contoh: {"eth":{"0xabc...":"Coinbase"},"btc":{"bc1q...":"OKX"}}

const ETH = {
  "0x28C6c06298d514Db089934071355E5743bf21d60": "Binance 14",
  "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549": "Binance 15",
  "0x631Fc1EA2270e98fbD9D92658eCe0F5a269Aa161": "Binance Hot Wallet",
};
const BTC = {
  "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo": "Binance Cold Wallet 1",
  "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6": "Binance Cold Wallet 2",
  "bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2": "Robinhood Cold Wallet",
  "bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97": "Bitfinex Cold Wallet",
};
try {
  const x = JSON.parse(process.env.EXTRA_EXCHANGES || "{}");
  Object.assign(ETH, x.eth || {});
  Object.assign(BTC, x.btc || {});
} catch (e) {}

const short = (s) => (s ? s.slice(0, 6) + "…" + s.slice(-4) : "-");
const lc = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
const ethL = lc(ETH);
const dir = (toEx, fromEx) => (toEx && !fromEx ? "inflow" : fromEx && !toEx ? "outflow" : "other");

async function j(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url.split("?")[0] + " -> " + r.status);
  return r.json();
}

async function getEth(minUsd, errors) {
  const key = process.env.ETHERSCAN_KEY;
  if (!key) { errors.push("ETHERSCAN_KEY belum diisi di Vercel (ETH dilewati)"); return []; }
  const out = [];
  try {
    const price = (await j("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")).ethereum.usd;
    for (const addr of Object.keys(ETH)) {
      const d = await j(`https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${addr}&page=1&offset=1000&sort=desc&apikey=${key}`);
      if (!Array.isArray(d.result)) { errors.push("Etherscan: " + (d.result || d.message)); continue; }
      for (const t of d.result) {
        const amount = Number(t.value) / 1e18;
        const usd = amount * price;
        if (usd < minUsd || t.isError === "1") continue;
        const toEx = ethL[(t.to || "").toLowerCase()], fromEx = ethL[(t.from || "").toLowerCase()];
        out.push({ symbol: "ETH", amount, usd, from: fromEx || short(t.from), to: toEx || short(t.to),
          direction: dir(!!toEx, !!fromEx), hash: t.hash, time: new Date(t.timeStamp * 1000).toISOString() });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) { errors.push("ETH: " + e.message); }
  return out;
}

async function getBtc(minUsd, errors) {
  const out = [];
  try {
    const price = (await j("https://mempool.space/api/v1/prices")).USD;
    for (const addr of Object.keys(BTC)) {
      const txs = await j(`https://mempool.space/api/address/${addr}/txs`);
      for (const t of txs) {
        const ins = t.vin.map((v) => v.prevout && v.prevout.scriptpubkey_address).filter(Boolean);
        const outs = t.vout.filter((v) => v.scriptpubkey_address);
        const toEx = outs.some((v) => BTC[v.scriptpubkey_address]);
        const fromEx = ins.some((a) => BTC[a]);
        const dest = outs.filter((v) => BTC[v.scriptpubkey_address]);
        const sats = fromEx ? outs.filter((v) => !BTC[v.scriptpubkey_address]).reduce((s, v) => s + v.value, 0)
                            : dest.reduce((s, v) => s + v.value, 0);
        const amount = sats / 1e8, usd = amount * price;
        if (usd < minUsd) continue;
        out.push({ symbol: "BTC", amount, usd,
          from: fromEx ? BTC[ins.find((a) => BTC[a])] : short(ins[0]),
          to: toEx ? BTC[dest[0].scriptpubkey_address] : short(outs[0] && outs[0].scriptpubkey_address),
          direction: dir(toEx, fromEx), hash: t.txid,
          time: new Date((t.status.block_time || Date.now() / 1000) * 1000).toISOString() });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) { errors.push("BTC: " + e.message); }
  return out;
}

export default async function handler(req, res) {
  const min = Number(req.query.min || 500000);
  const errors = [];
  const [eth, btc] = await Promise.all([getEth(min, errors), getBtc(min, errors)]);
  const seen = new Set();
  const list = [...eth, ...btc]
    .filter((x) => (seen.has(x.hash) ? false : seen.add(x.hash)))
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 100);
  if (!list.length && errors.length) return res.status(500).json({ error: errors.join(" | ") });
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  res.status(200).json(list);
}
