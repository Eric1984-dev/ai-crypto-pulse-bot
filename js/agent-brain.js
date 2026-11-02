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
      signalCount: 16,
      signalDuration: 3.2
    }),
    ANALYZING: Object.freeze({
      status: "ANALYZING",
      color: "#ed9cff",
      signalCount: 36,
      signalDuration: 1.25
    }),
    IDLE: Object.freeze({
      status: "IDLE",
      color: "#8f76a1",
      signalCount: 3,
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
      signalCount: 8,
      signalDuration: 2.4
    }),
    UNKNOWN: Object.freeze({
      status: "UNKNOWN",
      color: "#75808d",
      signalCount: 0,
      signalDuration: 0
    })
  });

  const tracePaths = createTracePaths();
  const signalRoutes = Object.freeze(tracePaths.slice(0, 32));

  function createTracePaths() {
    const paths = [];
    for (let index = 0; index < 16; index += 1) {
      const y = 18 + index * 20.4;
      const bendY = y + ((index % 3) - 1) * 13;
      const firstElbow = 75 + ((index * 41) % 122);
      const secondElbow = 244 + ((index * 29) % 120);
      paths.push(`M0 ${y}H${firstElbow}V${bendY}H${secondElbow}V${y}H420`);
      paths.push(`M1000 ${y}H${1000 - firstElbow}V${bendY}H${1000 - secondElbow}V${y}H580`);
    }

    for (let index = 0; index < 8; index += 1) {
      const x = 132 + index * 105;
      const y = 44 + (index % 4) * 67;
      const direction = index % 2 === 0 ? 1 : -1;
      paths.push(`M${x} 0V${y}H${x + 34 * direction}V${y + 46}`);
    }

    paths.push("M0 94H122V72H256V88H300");
    paths.push("M0 286H116V306H276V278H414");
    paths.push("M1000 94H878V72H744V88H700");
    paths.push("M1000 286H884V306H724V278H586");
    return Object.freeze(paths);
  }

  function mapAgentStatus(status) {
    const key = typeof status === "string" ? status.trim().toUpperCase() : "";
    return statusMap[key] || statusMap.UNKNOWN;
  }

  function renderComponent({ x, y, width, height, pins = 5, primary = false }) {
    const pinPaths = [];
    for (let index = 0; index < pins; index += 1) {
      const pinX = x + 7 + (index * (width - 14)) / Math.max(1, pins - 1);
      pinPaths.push(`M${pinX} ${y - 5}v5m0 ${height}v5`);
    }
    const sidePinCount = Math.max(3, Math.floor(pins / 2));
    for (let index = 0; index < sidePinCount; index += 1) {
      const pinY = y + 7 + (index * (height - 14)) / (sidePinCount - 1);
      pinPaths.push(`M${x - 5} ${pinY}h5m${width} 0h5`);
    }
    const componentClass = primary
      ? "circuit-component circuit-component--primary"
      : "circuit-component";
    return `<g class="${componentClass}">
      <path class="circuit-pin" d="${pinPaths.join("")}"/>
      <rect class="circuit-chip" x="${x}" y="${y}" width="${width}" height="${height}" rx="4"/>
      <rect class="circuit-chip-inner" x="${x + 5}" y="${y + 5}" width="${width - 10}" height="${height - 10}" rx="2"/>
      <path class="circuit-chip-mark" d="M${x + 10} ${y + height - 8}h${width - 20}"/>
      <circle class="circuit-chip-led" cx="${x + width - 9}" cy="${y + 9}" r="1.7"/>
    </g>`;
  }

  function renderVia(x, y, index) {
    return `<g class="circuit-via">
      <circle class="circuit-via-ring" cx="${x}" cy="${y}" r="${index % 3 === 0 ? 4 : 3}"/>
      <circle class="circuit-via-core" cx="${x}" cy="${y}" r="${index % 3 === 0 ? 1.6 : 1.1}"/>
    </g>`;
  }

  function renderSignalGroup(status, config) {
    const statusClass = status.toLowerCase();
    const signals = [];
    for (let index = 0; index < config.signalCount; index += 1) {
      const duration = config.signalDuration + (index % 4) * 0.13;
      const startOffset = (index % 9) * 0.31;
      const route = signalRoutes[(index * 7 + 3) % signalRoutes.length];
      signals.push(`<circle class="circuit-neuron circuit-neuron--${statusClass}" r="${index % 5 === 0 ? 3.8 : 2.9}" fill="${config.color}">
        <animateMotion dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite" path="${route}"/>
      </circle>`);
    }
    return `<g class="circuit-flow circuit-flow--${statusClass}" aria-hidden="true">${signals.join("")}</g>`;
  }

  function createCircuitMarkup() {
    const traces = tracePaths.map((path, index) => {
      const colorClass = index % 4 === 0 ? "circuit-trace--lavender" : "circuit-trace--violet";
      return `<path class="circuit-trace ${colorClass}" d="${path}"/>`;
    }).join("");
    const glowTraces = tracePaths.map((path) => `<path d="${path}"/>`).join("");
    const vias = [];
    for (let index = 0; index < 16; index += 1) {
      const y = 18 + index * 20.4;
      const x = 74 + ((index * 41) % 122);
      vias.push(renderVia(x, y, index));
      vias.push(renderVia(1000 - x, y, index + 1));
    }
    const components = [
      { x: 432, y: 127, width: 136, height: 106, pins: 11, primary: true },
      { x: 285, y: 75, width: 70, height: 36, pins: 5 },
      { x: 645, y: 75, width: 70, height: 36, pins: 5 },
      { x: 285, y: 266, width: 84, height: 34, pins: 6 },
      { x: 631, y: 266, width: 84, height: 34, pins: 6 },
      { x: 54, y: 148, width: 76, height: 50, pins: 5 },
      { x: 870, y: 148, width: 76, height: 50, pins: 5 },
      { x: 381, y: 46, width: 54, height: 28, pins: 4 },
      { x: 565, y: 46, width: 54, height: 28, pins: 4 },
      { x: 381, y: 296, width: 54, height: 28, pins: 4 },
      { x: 565, y: 296, width: 54, height: 28, pins: 4 }
    ].map(renderComponent).join("");
    const signals = Object.entries(statusMap)
      .map(([status, config]) => renderSignalGroup(status, config))
      .join("");

    return `<svg class="agent-circuit-art" viewBox="0 0 1000 360" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="circuit-board-light">
          <stop offset="0" stop-color="#281936"/>
          <stop offset="1" stop-color="#0b0810"/>
        </radialGradient>
        <filter id="circuit-line-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4"/>
        </filter>
        <filter id="circuit-neuron-glow" x="-250%" y="-250%" width="600%" height="600%">
          <feGaussianBlur stdDeviation="7" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <pattern id="circuit-board-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="#76508d" stroke-opacity=".2" stroke-width=".6"/>
          <circle cx="0" cy="0" r="1" fill="#a16bbc" fill-opacity=".3"/>
        </pattern>
      </defs>
      <rect class="circuit-board-background" width="1000" height="360" rx="14" fill="url(#circuit-board-light)"/>
      <rect class="circuit-board-grid" x="8" y="8" width="984" height="344" rx="10" fill="url(#circuit-board-grid)"/>
      <rect class="circuit-board-frame" x="8" y="8" width="984" height="344" rx="10"/>
      <g class="circuit-trace-glow" filter="url(#circuit-line-glow)">${glowTraces}</g>
      <g class="circuit-traces">${traces}</g>
      <g class="circuit-vias">${vias.join("")}</g>
      <g class="circuit-ports">
        <path d="M8 32h18m-18 7h12M992 32h-18m18 7h-12M8 321h20m-20 7h13M992 321h-20m20 7h-13"/>
      </g>
      <g class="circuit-components">${components}</g>
      <g class="circuit-board-markings">
        <path d="M403 118h18m160 124h16M405 242h18m158-124h16M145 116h28m654 0h28M145 244h28m654 0h28"/>
        <circle cx="24" cy="24" r="3"/><circle cx="976" cy="24" r="3"/>
        <circle cx="24" cy="336" r="3"/><circle cx="976" cy="336" r="3"/>
      </g>
      <g class="circuit-flows">${signals}</g>
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
