(function attachCryptoPulseFormatters(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    root.CryptoPulseFormatters = api;
  }
})(globalThis, function createFormatters() {
  const standardPriceFormat = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const subEuroPriceFormat = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 5
  });

  function formatPrice(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    const price = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(price)) {
      return "—";
    }
    return price < 1
      ? subEuroPriceFormat.format(price)
      : standardPriceFormat.format(price);
  }

  return { formatPrice };
});
