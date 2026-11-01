(function attachCryptoPulseFormatters(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    root.CryptoPulseFormatters = api;
  }
})(globalThis, function createFormatters() {
  const standardPriceFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const subEuroPriceFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 5
  });
  const timestampFormats = {
    short: new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Brussels"
    }),
    medium: new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Brussels"
    }),
    time: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels"
    })
  };

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

  function formatTimestamp(value, style = "short") {
    if (!Object.prototype.hasOwnProperty.call(timestampFormats, style)) {
      throw new RangeError("Unsupported timestamp format.");
    }
    const formatter = timestampFormats[style];
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
      return "—";
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? formatter.format(date) : "—";
  }

  return { formatPrice, formatTimestamp };
});
