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
      color: "#65dc92",
      signalCount: 12,
      signalDuration: 3.2
    }),
    ANALYZING: Object.freeze({
      status: "ANALYZING",
      color: "#9dffbd",
      signalCount: 24,
      signalDuration: 1.25
    }),
    IDLE: Object.freeze({
      status: "IDLE",
      color: "#67866f",
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
    return Object.freeze([
      "M626 430V109",
      "M570 430V127",
      "M680 430V123",
      "M520 430V128",
      "M626 747V1140",
      "M570 747V903",
      "M680 747V902",
      "M550 747V899",
      "M462 445H115",
      "M462 510H115",
      "M462 568H120",
      "M462 620H136",
      "M790 445H1139",
      "M790 510H1159",
      "M790 568H1134",
      "M790 620H1116"
    ]);
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
        <circle class="circuit-neuron-halo" r="${index % 5 === 0 ? 22 : 18}" fill="${config.color}"/>
        <circle class="circuit-neuron-core" r="${index % 5 === 0 ? 8 : 6}"/>
        <animateMotion dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite" path="${route}"/>
        <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.72;1" dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite"/>
      </g>`);
    }
    return `<g class="circuit-flow circuit-flow--${statusClass}" aria-hidden="true">${signals.join("")}</g>`;
  }

  function createCircuitMarkup() {
    const signals = Object.entries(statusMap)
      .map(([status, config]) => renderSignalGroup(status, config))
      .join("");

    return `<svg class="agent-circuit-art" viewBox="0 0 1254 1254" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <filter id="circuit-neuron-glow" x="-250%" y="-250%" width="600%" height="600%">
          <feGaussianBlur stdDeviation="7" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="circuit-chip-analyzing-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="circuit-trace-mask-filter" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="1 0 1 0 0 1 0 1 0 0 1 0 1 0 0 0 0 0 1 0"/>
          <feComponentTransfer>
            <feFuncR type="linear" slope="2.2" intercept="-0.25"/>
            <feFuncG type="linear" slope="2.2" intercept="-0.25"/>
            <feFuncB type="linear" slope="2.2" intercept="-0.25"/>
          </feComponentTransfer>
        </filter>
        <mask id="circuit-trace-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254" mask-type="luminance">
          <image href="/assets/agent-circuit-board.png" x="0" y="0" width="1254" height="1254" filter="url(#circuit-trace-mask-filter)"/>
        </mask>
      </defs>
      <image class="circuit-board-image" href="/assets/agent-circuit-board.png" x="0" y="0" width="1254" height="1254" preserveAspectRatio="xMidYMid meet"/>
      <rect class="circuit-chip-analyzing-glow" x="456" y="418" width="342" height="336" rx="28" fill="none" stroke="#74ff9f" stroke-width="10" filter="url(#circuit-chip-analyzing-glow)"/>
      <g class="circuit-flows" mask="url(#circuit-trace-mask)">${signals}</g>
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
