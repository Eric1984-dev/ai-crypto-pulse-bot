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
    Object.freeze({ x: 448, y: 429 }),
    Object.freeze({ x: 448, y: 840 }),
    Object.freeze({ x: 367, y: 609 }),
    Object.freeze({ x: 745, y: 366 }),
    Object.freeze({ x: 887, y: 606 }),
    Object.freeze({ x: 642, y: 364 }),
    Object.freeze({ x: 814, y: 430 }),
    Object.freeze({ x: 822, y: 822 }),
    Object.freeze({ x: 365, y: 645 }),
    Object.freeze({ x: 637, y: 889 }),
    Object.freeze({ x: 536, y: 351 }),
    Object.freeze({ x: 746, y: 880 }),
    Object.freeze({ x: 495, y: 877 }),
    Object.freeze({ x: 893, y: 653 }),
    Object.freeze({ x: 879, y: 554 }),
    Object.freeze({ x: 584, y: 348 }),
    Object.freeze({ x: 708, y: 906 }),
    Object.freeze({ x: 476, y: 367 }),
    Object.freeze({ x: 800, y: 868 }),
    Object.freeze({ x: 460, y: 878 }),
    Object.freeze({ x: 663, y: 343 }),
    Object.freeze({ x: 371, y: 533 }),
    Object.freeze({ x: 359, y: 676 }),
    Object.freeze({ x: 599, y: 914 })
  ]);

  function createSignalRoutes() {
    return Object.freeze([
      "M448 429L342 323L252 323L159 230L65 230L10 175",
      "M448 840L446 838L334 949L249 949L10 1188",
      "M367 609L353 594L334 609L231 610L146 524L10 524",
      "M745 366L740 360L768 332L768 240L835 171L835 10",
      "M887 606L895 598L926 628L1043 628L1195 476L1243 476",
      "M642 364L621 343L628 336L629 10",
      "M814 430L971 278L1085 278L1243 120",
      "M822 822L926 926L1010 927L1155 1072L1243 1072",
      "M365 645L355 636L340 644L300 645L162 645L154 642L149 645L10 645",
      "M637 889L617 909L628 921L629 1243",
      "M536 351L522 337L524 325L495 295L495 227L385 115L386 10",
      "M746 880L742 892L756 905L756 927L889 1061L907 1057L971 1121L988 1117L1013 1121L1134 1243",
      "M495 877L484 889L495 906L495 936L383 1046L331 1046L133 1243",
      "M893 653L910 648L922 660L1127 660L1182 605L1243 605",
      "M879 554L898 535L905 538L914 530L969 475L1094 476L1171 405L1243 405",
      "M584 348L577 340L577 318L538 279L539 152L478 89L478 10",
      "M708 906L703 920L709 926L710 955L865 1109L888 1111L1019 1243",
      "M476 367L458 349L457 289L318 151L318 56L272 10",
      "M800 868L800 915L879 994L969 994L1216 1243",
      "M460 878L459 921L376 1004L315 1004L246 1073L187 1074L18 1243",
      "M663 343L661 315L700 276L700 223L656 179L656 10",
      "M371 533L351 513L339 524L332 524L241 434L157 432L61 338L10 338",
      "M359 676L186 675L154 705L10 705",
      "M599 914L593 926L598 942L598 978L552 1024L552 1100L494 1160L481 1160L449 1192L448 1243",
      "M663 915L656 927L661 942L661 983L709 1031L709 1108L789 1188L790 1243",
      "M397 471L389 465L380 471L332 471L263 403L171 403L17 249L10 250",
      "M820 391L963 249L1076 249L1243 82",
      "M333 724L326 716L309 724L239 724L98 865L10 865",
      "M926 704L933 698L944 704L1016 704L1140 828L1166 828L1170 824L1174 828L1243 828",
      "M696 310L725 278L724 156L790 89L790 10",
      "M349 816L340 813L331 819L255 894L178 896L59 1012L10 1012",
      "M835 304L939 202L1045 202L1236 10"
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
