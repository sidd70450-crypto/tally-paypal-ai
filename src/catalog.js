export const SHOP_NAME = "Ember & Oak Coffee";

export const catalog = [
  { sku: "EO-ETH-12", name: "Ethiopia Yirgacheffe, 12oz", price: 19.0, tags: ["light roast", "floral", "citrus", "pour over", "single origin"], emoji: "🌸" },
  { sku: "EO-COL-12", name: "Colombia Huila, 12oz", price: 17.0, tags: ["medium roast", "chocolate", "caramel", "everyday", "single origin"], emoji: "🍫" },
  { sku: "EO-SUM-12", name: "Sumatra Dark, 12oz", price: 18.0, tags: ["dark roast", "earthy", "bold", "french press"], emoji: "🌋" },
  { sku: "EO-DEC-12", name: "Swiss Water Decaf, 12oz", price: 18.5, tags: ["decaf", "medium roast", "smooth", "evening"], emoji: "🌙" },
  { sku: "EO-ESP-2LB", name: "House Espresso Blend, 2lb", price: 42.0, tags: ["espresso", "blend", "crema", "bulk", "office"], emoji: "☕" },
  { sku: "EO-SAMPLER", name: "Origin Sampler (4 x 4oz)", price: 29.0, tags: ["gift", "sampler", "variety", "tasting"], emoji: "🎁" },
  { sku: "EO-V60", name: "Ceramic V60 Dripper", price: 24.0, tags: ["gear", "pour over", "brewing", "gift"], emoji: "🫖" },
  { sku: "EO-GRINDER", name: "Hand Burr Grinder", price: 65.0, tags: ["gear", "grinder", "burr", "gift", "premium"], emoji: "⚙️" },
  { sku: "EO-MUG", name: "Stoneware Mug, Ember Glaze", price: 16.0, tags: ["mug", "gift", "ceramic", "handmade"], emoji: "🍵" },
  { sku: "EO-COLD", name: "Cold Brew Pitcher Kit", price: 34.0, tags: ["cold brew", "summer", "gear", "kit"], emoji: "🧊" },
  { sku: "EO-SUB-3", name: "3-Month Subscription (12oz/mo)", price: 51.0, tags: ["subscription", "gift", "monthly", "rotating origin"], emoji: "📦" },
  { sku: "EO-FILTERS", name: "Paper Filters (100ct)", price: 7.0, tags: ["filters", "pour over", "accessory", "cheap"], emoji: "📄" },
];

export function searchCatalog(query = "", max_price) {
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  return catalog
    .map((p) => {
      const hay = `${p.name} ${p.tags.join(" ")}`.toLowerCase();
      const score = words.length ? words.filter((w) => hay.includes(w)).length : 1;
      return { ...p, score };
    })
    .filter((p) => (max_price ? p.price <= max_price : true))
    .filter((p) => p.score > 0 || !words.length)
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...p }) => p);
}
