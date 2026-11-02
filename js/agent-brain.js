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
      color: "#5b9cff",
      signalCount: 12,
      signalDuration: 3.2
    }),
    ANALYZING: Object.freeze({
      status: "ANALYZING",
      color: "#a8d0ff",
      signalCount: 32,
      signalDuration: 2.6
    }),
    IDLE: Object.freeze({
      status: "IDLE",
      color: "#7188a6",
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
  const circuitNodes = Object.freeze([
    Object.freeze({ x: 596, y: 183 }),
    Object.freeze({ x: 493, y: 258 }),
    Object.freeze({ x: 339, y: 271 }),
    Object.freeze({ x: 912, y: 271 }),
    Object.freeze({ x: 760, y: 276 }),
    Object.freeze({ x: 626, y: 331 }),
    Object.freeze({ x: 261, y: 372 }),
    Object.freeze({ x: 993, y: 370 }),
    Object.freeze({ x: 212, y: 507 }),
    Object.freeze({ x: 1041, y: 507 }),
    Object.freeze({ x: 367, y: 592 }),
    Object.freeze({ x: 885, y: 592 }),
    Object.freeze({ x: 218, y: 702 }),
    Object.freeze({ x: 1032, y: 702 }),
    Object.freeze({ x: 334, y: 782 }),
    Object.freeze({ x: 918, y: 780 }),
    Object.freeze({ x: 626, y: 862 }),
    Object.freeze({ x: 455, y: 922 }),
    Object.freeze({ x: 796, y: 922 }),
    Object.freeze({ x: 351, y: 992 }),
    Object.freeze({ x: 901, y: 992 }),
    Object.freeze({ x: 625, y: 1039 }),
    Object.freeze({ x: 804, y: 154 }),
    Object.freeze({ x: 655, y: 165 })
  ]);

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
      "M790 620H1116",
      "M548 430V358L472 282H421L344 205H303L246 148V111",
      "M598 430V293L548 243H496L425 172V111",
      "M655 430V293L706 242V166L742 130V104",
      "M705 430V357L764 298H832L889 241H943L1023 151V111",
      "M524 747V827L456 895H410L331 974H281L212 1043V1100",
      "M598 747V858L548 908V975L492 1031V1105",
      "M655 747V852L710 907V980L765 1034V1104",
      "M730 747V827L802 899H847L925 977H1012L1088 1053V1110",
      "M462 474H354L300 420H226L180 374H126",
      "M462 542H335L284 491H225L179 445H104",
      "M462 594H320L270 642H218L168 692H104",
      "M462 671H320L270 621H214L162 570H104",
      "M790 474H899L953 420H1028L1074 374H1128",
      "M790 542H917L968 491H1027L1073 445H1150",
      "M790 594H932L982 642H1034L1084 692H1150",
      "M790 671H932L982 621H1040L1092 570H1150"
    ]);
  }

  function mapAgentStatus(status) {
    const key = typeof status === "string" ? status.trim().toUpperCase() : "";
    return statusMap[key] || statusMap.UNKNOWN;
  }

  function getRouteEndPoint(route) {
    let x = 0;
    let y = 0;
    const commands = route.match(/[MLHV][^MLHV]+/g) || [];
    for (const command of commands) {
      const values = command.slice(1).trim().split(/\s+/).map(Number);
      if (command[0] === "M" || command[0] === "L") {
        [x, y] = values;
      } else if (command[0] === "H") {
        x = values[0];
      } else if (command[0] === "V") {
        y = values[0];
      }
    }
    return { x, y };
  }

  function renderSignalGroup(status, config) {
    const statusClass = status.toLowerCase();
    const signals = [];
    const nodePulses = status === "ANALYZING" ? circuitNodes.map((node, index) => {
      const duration = config.signalDuration + (index % 4) * 0.13;
      const startOffset = (index % 9) * 0.31;
      return `<circle class="circuit-neuron-node" cx="${node.x}" cy="${node.y}" r="14" fill="${config.color}" filter="url(#circuit-neuron-glow)">
        <animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.84;0.9;1" dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite"/>
      </circle>`;
    }) : [];
    for (let index = 0; index < config.signalCount; index += 1) {
      const duration = config.signalDuration + (index % 4) * 0.13;
      const startOffset = (index % 9) * 0.31;
      const routeIndex = (index * 7 + 3) % signalRoutes.length;
      const route = signalRoutes[routeIndex];
      const endPoint = getRouteEndPoint(route);
      signals.push(`<g class="circuit-neuron-track" mask="url(#circuit-neuron-route-${routeIndex})">
        <circle class="circuit-neuron-terminal" cx="${endPoint.x}" cy="${endPoint.y}" r="14" fill="${config.color}" filter="url(#circuit-neuron-glow)">
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.84;0.9;0.98;1" dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite"/>
        </circle>
        <g class="circuit-neuron circuit-neuron--${statusClass}">
          <circle class="circuit-neuron-halo" r="${index % 5 === 0 ? 22 : 18}" fill="${config.color}"/>
          <circle class="circuit-neuron-core" r="${index % 5 === 0 ? 8 : 6}"/>
          <animateMotion dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite" path="${route}"/>
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.88;1" dur="${duration.toFixed(2)}s" begin="-${startOffset.toFixed(2)}s" repeatCount="indefinite"/>
        </g>
      </g>`);
    }
    return `<g class="circuit-flow circuit-flow--${statusClass}" aria-hidden="true">${nodePulses.join("")}${signals.join("")}</g>`;
  }

  function createRouteMasks() {
    return signalRoutes.map((route, index) => `
        <mask id="circuit-neuron-route-${index}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254" mask-type="luminance">
          <rect x="0" y="0" width="1254" height="1254" fill="black"/>
          <path d="${route}" fill="none" stroke="white" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
        </mask>`).join("");
  }

  function createCircuitMarkup() {
    const signals = Object.entries(statusMap)
      .map(([status, config]) => renderSignalGroup(status, config))
      .join("");

    return `<svg class="agent-circuit-art" viewBox="0 0 1254 1254" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <filter id="circuit-neuron-glow" x="-250%" y="-250%" width="600%" height="600%">
          <feGaussianBlur stdDeviation="10" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="circuit-chip-analyzing-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur"/>
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
        ${createRouteMasks()}
      </defs>
      <image class="circuit-board-image" href="/assets/agent-circuit-board.png" x="0" y="0" width="1254" height="1254" preserveAspectRatio="xMidYMid meet"/>
      <rect class="circuit-chip-analyzing-glow" x="456" y="418" width="342" height="336" rx="28" fill="none" stroke="#74ff9f" stroke-width="14" filter="url(#circuit-chip-analyzing-glow)"/>
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
