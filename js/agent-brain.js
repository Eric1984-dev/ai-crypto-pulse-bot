(function attachAgentBrain(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.CryptoPulseAgentBrain = api;
  }
})(globalThis, function createAgentBrainApi() {
  const statusMap = Object.freeze({
    ACTIVE: Object.freeze({
      status: "ACTIVE",
      color: "#c780f0",
      signalCount: 12,
      signalDuration: 3.2
    }),
    ANALYZING: Object.freeze({
      status: "ANALYZING",
      color: "#ed9cff",
      signalCount: 24,
      signalDuration: 1.25
    }),
    IDLE: Object.freeze({
      status: "IDLE",
      color: "#8f76a1",
      signalCount: 2,
      signalDuration: 7.5
    }),
    STOPPED: Object.freeze({
      status: "STOPPED",
      color: "#75808d",
      signalCount: 0,
      signalDuration: 0
    }),
    ERROR: Object.freeze({
      status: "ERROR",
      color: "#ff6478",
      signalCount: 6,
      signalDuration: 2.4
    }),
    UNKNOWN: Object.freeze({
      status: "UNKNOWN",
      color: "#75808d",
      signalCount: 0,
      signalDuration: 0
    })
  });

  const signalRoutes = createSignalRoutes();

  function createSignalRoutes() {
    const routes = [];
    for (let index = 0; index < 12; index += 1) {
      const pin = 382 + index * 21.5;
      const edge = 36 + index * 84;
      const topElbow = 280 + (index % 4) * 22;
      const sideElbow = 280 + ((index + 2) % 4) * 22;
      routes.push(`M${pin} 370V${topElbow}H${edge}V36`);
      routes.push(`M${pin} 630V${1000 - topElbow}H${1000 - edge}V964`);
      routes.push(`M370 ${pin}H${sideElbow}V${edge}H36`);
      routes.push(`M630 ${pin}H${1000 - sideElbow}V${1000 - edge}H964`);
    }

    routes.push(
      "M370 370H340V310H270V240H200V170H120",
      "M630 370H660V310H730V240H800V170H880",
      "M370 630H340V690H270V760H200V830H120",
      "M630 630H660V690H730V760H800V830H880"
    );
    return Object.freeze(routes);
  }

  function mapAgentStatus(status) {
    const key = typeof status === "string" ? status.trim().toUpperCase() : "";
    return statusMap[key] || statusMap.UNKNOWN;
  }

  function renderSignalGroup(status, config) {
    const statusClass = status.toLowerCase();
    const signals = [];
    for (let index = 0; index < config.signalCount; index += 1) {
      const duration = config.signalDuration + (index % 4) * 0.13;
      const startOffset = (index % 9) * 0.31;
      const route = signalRoutes[(index * 7 + 3) % signalRoutes.length];
      signals.push(`<g class="circuit-neuron circuit-neuron--${statusClass}">
        <circle class="circuit-neuron-halo" r="${index % 5 === 0 ? 11 : 8}" fill="${config.color}"/>
        <circle class="circuit-neuron-core" r="${index % 5 === 0 ? 3.2 : 2.4}"/>
        <animateMotion dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite" path="${route}"/>
      </g>`);
    }
    return `<g class="circuit-flow circuit-flow--${statusClass}" aria-hidden="true">${signals.join("")}</g>`;
  }

  function createCircuitMarkup() {
    const signals = Object.entries(statusMap)
      .map(([status, config]) => renderSignalGroup(status, config))
      .join("");

    return `<svg class="agent-circuit-art" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <filter id="circuit-neuron-glow" x="-250%" y="-250%" width="600%" height="600%">
          <feGaussianBlur stdDeviation="7" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <clipPath id="circuit-board-clip">
          <rect x="22" y="22" width="956" height="956" rx="76"/>
        </clipPath>
      </defs>
      <image class="circuit-board-image" href="/assets/agent-circuit-board.png" x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid meet"/>
      <g class="circuit-flows" clip-path="url(#circuit-board-clip)">${signals}</g>
    </svg>`;
  }

  function createUnavailableCircuit() {
    return {
      available: false,
      isAvailable() {
        return false;
      },
      setStatus() {},
      dispose() {}
    };
  }

  function createAgentBrain({ container, stateElement = container, initialStatus = null } = {}) {
    if (!container || typeof container !== "object") {
      return createUnavailableCircuit();
    }

    let disposed = false;
    container.innerHTML = createCircuitMarkup();

    function setStatus(status) {
      if (disposed) {
        throw new Error("Cannot update a disposed Agent Status visualization.");
      }
      const config = mapAgentStatus(status);
      if (stateElement && stateElement.dataset) {
        stateElement.dataset.state = config.status.toLowerCase();
      }
      if (typeof container.setAttribute === "function") {
        container.setAttribute("aria-label", `Agent circuit visualization; status ${config.status}`);
      }
      return config;
    }

    setStatus(initialStatus);
    return {
      available: true,
      isAvailable() {
        return !disposed;
      },
      setStatus,
      dispose() {
        if (disposed) {
          return;
        }
        container.innerHTML = "";
        disposed = true;
      }
    };
  }

  return Object.freeze({
    createAgentBrain,
    mapAgentStatus,
    statusMap,
    signalRoutes
  });
});
