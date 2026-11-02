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
  const microPriceFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  });
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const quantityFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 8 });
  const integerQuantityFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const compactQuantityFormat = new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 2
  });
  const percentFormat = new Intl.NumberFormat("en-GB", {
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

  function createMarketSymbol(documentRef, symbol) {
    const text = typeof symbol === "string" ? symbol.trim() : "";
    const element = documentRef.createElement("span");
    element.textContent = text || "—";
    if (text) {
      element.className = "market-symbol";
    }
    return element;
  }

  function setMarketSymbolText(documentRef, element, text, symbol) {
    const value = typeof text === "string" ? text : String(text ?? "");
    const market = typeof symbol === "string" ? symbol.trim() : "";
    setHighlightedText(documentRef, element, value, market
      ? [{ text: market, className: "market-symbol" }]
      : []);
  }

  function setTradeActionText(documentRef, element, text, action) {
    const side = normalizeTradeSide(action);
    setHighlightedText(documentRef, element, text, side
      ? [{ text: side, className: `trade-action-${side.toLowerCase()}` }]
      : []);
  }

  function setMarketAndTradeText(documentRef, element, text, symbol, action) {
    const markers = [];
    const side = normalizeTradeSide(action);
    const market = typeof symbol === "string" ? symbol.trim() : "";
    if (side) {
      markers.push({
        text: side,
        className: `trade-action-${side.toLowerCase()}`
      });
    }
    if (market) {
      markers.push({ text: market, className: "market-symbol" });
    }
    setHighlightedText(documentRef, element, text, markers);
  }

  function createTradeActionLabel(documentRef, action) {
    const element = documentRef.createElement("span");
    const side = normalizeTradeSide(action);
    element.textContent = typeof action === "string" ? action.toUpperCase() : "—";
    if (side) {
      element.className = `trade-action-${side.toLowerCase()}`;
    }
    return element;
  }

  function setHighlightedText(documentRef, element, text, markers) {
    const value = typeof text === "string" ? text : String(text ?? "");
    const matches = markers.map((marker) => {
      const markerText = typeof marker.text === "string" ? marker.text : "";
      const index = markerText
        ? value.toUpperCase().indexOf(markerText.toUpperCase())
        : -1;
      return index < 0
        ? null
        : { ...marker, index, value: value.slice(index, index + markerText.length) };
    }).filter(Boolean).sort((left, right) => left.index - right.index);

    if (!matches.length) {
      element.textContent = value;
      return;
    }
    if (typeof element.replaceChildren === "function") {
      element.replaceChildren();
    } else {
      element.textContent = "";
    }

    let position = 0;
    for (const match of matches) {
      if (match.index < position) {
        continue;
      }
      element.append(value.slice(position, match.index));
      const highlighted = documentRef.createElement("span");
      highlighted.className = match.className;
      highlighted.textContent = match.value;
      element.append(highlighted);
      position = match.index + match.value.length;
    }
    element.append(value.slice(position));
  }

  function normalizeTradeSide(action) {
    const side = typeof action === "string" ? action.toUpperCase() : "";
    return side === "BUY" || side === "SELL" ? side : "";
  }

  function formatPrice(value) {
    const price = numericValue(value);
    if (price === null) {
      return "—";
    }
    if (price < 0.001) {
      return microPriceFormat.format(price);
    }
    return price < 1 ? subEuroPriceFormat.format(price) : standardPriceFormat.format(price);
  }

  function formatQuantity(value) {
    const quantity = numericValue(value);
    if (quantity === null) {
      return "—";
    }
    const absoluteQuantity = Math.abs(quantity);
    if (absoluteQuantity >= 1_000_000) {
      return compactQuantityFormat.format(quantity).replace(/([a-z])$/, (suffix) => suffix.toUpperCase());
    }
    return absoluteQuantity >= 1
      ? integerQuantityFormat.format(quantity)
      : quantityFormat.format(quantity);
  }

  function formatCurrency(value) {
    const amount = numericValue(value);
    return amount === null ? "—" : currencyFormat.format(amount);
  }

  function setValueTone(element, value) {
    if (!element || !element.dataset) {
      return;
    }
    const amount = numericValue(value);
    const tone = amount === null || amount === 0
      ? ""
      : amount < 0 ? "negative" : "positive";
    if (tone) {
      element.dataset.valueTone = tone;
    } else {
      delete element.dataset.valueTone;
    }
    const card = typeof element.closest === "function"
      ? element.closest(".metric-card")
      : null;
    if (card && card.dataset) {
      if (tone) {
        card.dataset.valueTone = tone;
      } else {
        delete card.dataset.valueTone;
      }
    }
  }

  function formatSignedCurrency(value) {
    const amount = numericValue(value);
    if (amount === null) {
      return "—";
    }
    return amount > 0 ? `+${currencyFormat.format(amount)}` : currencyFormat.format(amount);
  }

  function formatSignedPercent(value) {
    const percentage = numericValue(value);
    if (percentage === null) {
      return "—";
    }
    const formattedPercentage = `${percentFormat.format(percentage)}%`;
    return percentage > 0 ? `+${formattedPercentage}` : formattedPercentage;
  }

  function getOpenPositionMetrics(position) {
    if (!position || typeof position !== "object") {
      return null;
    }
    const amount = numericValue(position.amount);
    const entryPrice = numericValue(position.entry_price);
    const currentPrice = numericValue(
      position.current_market_price === undefined
        ? position.current_price
        : position.current_market_price
    );
    if (amount === null || amount <= 0 || entryPrice === null || entryPrice <= 0
      || currentPrice === null || currentPrice <= 0) {
      return null;
    }
    const costBasis = finiteAmount(entryPrice * amount);
    const unrealizedPnl = finiteAmount((currentPrice - entryPrice) * amount);
    if (costBasis === null || costBasis <= 0 || unrealizedPnl === null) {
      return null;
    }
    return {
      currentPrice,
      unrealizedPnl,
      unrealizedPnlPercent: unrealizedPnl / costBasis * 100
    };
  }

  function getClosedTradeMetrics(trade) {
    if (!trade || typeof trade !== "object" || String(trade.side).toUpperCase() !== "SELL") {
      return null;
    }
    const price = numericValue(trade.price);
    const quantity = numericValue(trade.quantity);
    const fees = numericValue(trade.fees);
    const realizedPnl = numericValue(trade.realized_pnl);
    if (price === null || price <= 0 || quantity === null || quantity <= 0
      || fees === null || fees < 0 || realizedPnl === null) {
      return null;
    }
    const grossProceeds = finiteAmount(price * quantity);
    const entryCostBasis = grossProceeds === null
      ? null
      : finiteAmount(grossProceeds - fees - realizedPnl);
    if (entryCostBasis === null || entryCostBasis <= 0) {
      return null;
    }
    return {
      entryPrice: entryCostBasis / quantity,
      exitPrice: price,
      realizedPnl,
      realizedPnlPercent: realizedPnl / entryCostBasis * 100
    };
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
    createMarketSymbol,
    formatCurrency,
    formatPrice,
    formatQuantity,
    formatSignedPercent,
    formatSignedCurrency,
    setValueTone,
    formatTimestamp,
    formatTradeValueDetails,
    getClosedTradeMetrics,
    getOpenPositionMetrics,
    setMarketSymbolText,
    setTradeActionText,
    setMarketAndTradeText,
    createTradeActionLabel
  };
});
