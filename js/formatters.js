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
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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
    const price = numericValue(value);
    if (price === null) {
      return "—";
    }
    return price < 1
      ? subEuroPriceFormat.format(price)
      : standardPriceFormat.format(price);
  }

  function formatCurrency(value) {
    const amount = numericValue(value);
    return amount === null ? "—" : currencyFormat.format(amount);
  }

  function formatSignedCurrency(value) {
    const amount = numericValue(value);
    if (amount === null) {
      return "—";
    }
    return amount > 0 ? `+${currencyFormat.format(amount)}` : currencyFormat.format(amount);
  }

  function formatTradeValueDetails(trade) {
    if (!trade || typeof trade !== "object") {
      return [];
    }
    const side = typeof trade.side === "string" ? trade.side.toUpperCase() : "";
    const price = numericValue(trade.price);
    const quantity = numericValue(trade.quantity);
    const fees = numericValue(trade.fees);
    const grossAmount = price !== null && quantity !== null
      ? finiteAmount(price * quantity)
      : null;

    if (side === "BUY") {
      const totalCost = grossAmount !== null && fees !== null
        ? finiteAmount(grossAmount + fees)
        : null;
      return [
        `Invested Amount: ${formatCurrency(grossAmount)}`,
        `Fees: ${formatCurrency(fees)}`,
        `Total Cost: ${formatCurrency(totalCost)}`
      ];
    }
    if (side === "SELL") {
      const netProceeds = grossAmount !== null && fees !== null
        ? finiteAmount(grossAmount - fees)
        : null;
      return [
        `Gross Proceeds: ${formatCurrency(grossAmount)}`,
        `Fees: ${formatCurrency(fees)}`,
        `Net Proceeds: ${formatCurrency(netProceeds)}`,
        `Realized P&L: ${formatSignedCurrency(trade.realized_pnl)}`
      ];
    }
    return [];
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

  function numericValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) ? amount : null;
  }

  function finiteAmount(value) {
    return Number.isFinite(value) ? value : null;
  }

  return {
    formatCurrency,
    formatPrice,
    formatSignedCurrency,
    formatTimestamp,
    formatTradeValueDetails
  };
});
